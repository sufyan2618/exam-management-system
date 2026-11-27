import { parse } from "csv-parse/sync";
import { Types } from "mongoose";
import { z } from "zod";
import { BASE_DIFFICULTY_SCORE, CSV_ROW_CAP } from "../config/constants";
import { env } from "../config/env";
import { randomPassword } from "../lib/crypto";
import { isDuplicateKey, withTransaction } from "../lib/db";
import { logger } from "../lib/logger";
import { redis } from "../lib/redis";
import { csvSafe, sanitizeMarkdown, toCsv } from "../lib/sanitize";
import { sniffTextFile } from "../middlewares/upload.middleware";
import { Category, Question } from "../models/question.model";
import { ImportJob } from "../models/system.model";
import { User } from "../models/user.model";
import { enqueue } from "../queues/jobs.queue";
import { createQuestionBody } from "../schemas/question.schema";
import type { AuthUser } from "../types/express";
import { AppError, conflict, notFound, unprocessable } from "../utils/errors";
import { email as emailSchema, text } from "../utils/validators";
import { hashPassword } from "../utils/password";
import { audit } from "./audit.service";
import { buildOptions } from "./question.service";

export type ImportType = "CANDIDATES" | "QUESTIONS";
interface RowError {
  row: number;
  column: string;
  reason: string;
}
interface Parsed {
  rowNo: number;
  data: Record<string, any>;
}

export const importOptions = z
  .object({
    mode: z.enum(["dry-run", "commit"]).default("dry-run"),
    atomic: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
    autoCreateCategories: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  })
  .strict();
export type ImportOptions = z.infer<typeof importOptions>;

const norm = (h: string) => h.toLowerCase().replace(/[\s_-]+/g, "");
const MAX_ERRORS_STORED = 1000;
const PLACEHOLDER_CATEGORY = "000000000000000000000000";

// ---- parsing ----------------------------------------------------------------------------------------------

function parseFile(buf: Buffer, format: "CSV" | "JSON"): Parsed[] {
  sniffTextFile(buf, format);
  const raw = buf.toString("utf8").replace(/^\uFEFF/, "");
  let rows: Array<Record<string, any>>;
  let offset: number;
  try {
    if (format === "CSV") {
      rows = parse(raw, { columns: (h: string[]) => h.map(norm), skip_empty_lines: true, trim: true, bom: true, relax_quotes: false }) as Array<Record<string, any>>;
      offset = 2; // header is row 1
    } else {
      const json = JSON.parse(raw);
      rows = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : [];
      if (!rows.length && !Array.isArray(json)) throw new Error("Expected a JSON array (or { items: [] })");
      rows = rows.map((r) => (r && typeof r === "object" ? Object.fromEntries(Object.entries(r).map(([k, v]) => [norm(k), v])) : { __invalid: true }));
      offset = 1;
    }
  } catch (err) {
    throw new AppError(422, "VALIDATION_FAILED", `Could not parse the ${format} file: ${(err as Error).message}`);
  }
  if (!rows.length) throw unprocessable("The file contains no data rows");
  if (rows.length > CSV_ROW_CAP) throw new AppError(422, "VALIDATION_FAILED", `Too many rows (${rows.length}); the limit is ${CSV_ROW_CAP}`, { details: [{ field: "file", issue: `Maximum ${CSV_ROW_CAP} rows` }] });
  return rows.map((data, i) => ({ rowNo: i + offset, data }));
}

// ---- candidates ---------------------------------------------------------------------------------------------

const candidateRow = z.object({ email: emailSchema, fullName: text(2, 120), registrationNo: text(1, 60).optional() });

async function validateCandidates(parsed: Parsed[]) {
  const errors: RowError[] = [];
  const valid: Array<Parsed & { row: z.infer<typeof candidateRow> }> = [];
  const seenEmail = new Map<string, number>();
  const seenReg = new Map<string, number>();
  const candidates: Array<{ rowNo: number; value: z.infer<typeof candidateRow> }> = [];
  for (const { rowNo, data } of parsed) {
    const res = candidateRow.safeParse({ email: String(data.email ?? ""), fullName: String(data.fullname ?? data.name ?? ""), registrationNo: data.registrationno ? String(data.registrationno) : undefined });
    if (!res.success) {
      for (const i of res.error.issues) errors.push({ row: rowNo, column: String(i.path[0] ?? ""), reason: i.message });
      continue;
    }
    candidates.push({ rowNo, value: res.data });
  }
  const [existingEmails, existingRegs] = await Promise.all([
    User.find({ email: { $in: candidates.map((c) => c.value.email) } }).select("email").lean(),
    User.find({ registrationNo: { $in: candidates.map((c) => c.value.registrationNo).filter(Boolean) as string[] } }).select("registrationNo").lean(),
  ]);
  const emailSet = new Set(existingEmails.map((u) => u.email));
  const regSet = new Set(existingRegs.map((u) => u.registrationNo));
  for (const c of candidates) {
    let ok = true;
    if (emailSet.has(c.value.email)) (errors.push({ row: c.rowNo, column: "email", reason: "A user with this email already exists" }), (ok = false));
    else if (seenEmail.has(c.value.email)) (errors.push({ row: c.rowNo, column: "email", reason: `Duplicate of row ${seenEmail.get(c.value.email)}` }), (ok = false));
    if (c.value.registrationNo) {
      if (regSet.has(c.value.registrationNo)) (errors.push({ row: c.rowNo, column: "registrationNo", reason: "Registration number already in use" }), (ok = false));
      else if (seenReg.has(c.value.registrationNo)) (errors.push({ row: c.rowNo, column: "registrationNo", reason: `Duplicate of row ${seenReg.get(c.value.registrationNo)}` }), (ok = false));
    }
    seenEmail.set(c.value.email, seenEmail.get(c.value.email) ?? c.rowNo);
    if (c.value.registrationNo) seenReg.set(c.value.registrationNo, seenReg.get(c.value.registrationNo) ?? c.rowNo);
    if (ok) valid.push({ rowNo: c.rowNo, data: {}, row: c.value });
  }
  return { errors, valid: valid.map((v) => ({ rowNo: v.rowNo, ...v.row })) };
}

// ---- questions ----------------------------------------------------------------------------------------------

const LETTERS = "ABCDEFGHIJ";
function toQuestionInput(data: Record<string, any>): Record<string, any> {
  const type = String(data.type ?? "").toUpperCase();
  let options: Array<{ text: string; isCorrect: boolean }> = [];
  if (Array.isArray(data.options)) {
    options = data.options.map((o: any) => ({ text: String(o?.text ?? ""), isCorrect: Boolean(o?.isCorrect) }));
  } else {
    const texts: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const v = data[`option${i}`];
      if (v !== undefined && String(v).trim() !== "") texts.push(String(v));
    }
    const correct = new Set(
      String(data.correct ?? "")
        .split(/[|;]/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .map((t) => (/^\d+$/.test(t) ? Number(t) - 1 : LETTERS.indexOf(t))),
    );
    options = texts.map((t, i) => ({ text: t, isCorrect: correct.has(i) }));
  }
  const tags = Array.isArray(data.tags) ? data.tags.map(String) : String(data.tags ?? "").split(/[|;]/).map((s) => s.trim()).filter(Boolean);
  const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
  return {
    type,
    difficulty: String(data.difficulty ?? "").toUpperCase(),
    stem: String(data.stem ?? data.question ?? ""),
    defaultMarks: num(data.defaultmarks ?? data.marks),
    explanation: data.explanation ? String(data.explanation) : undefined,
    rubric: data.rubric ? String(data.rubric) : undefined,
    maxWords: num(data.maxwords),
    options,
    tags,
  };
}

async function validateQuestions(user: AuthUser, parsed: Parsed[], autoCreate: boolean) {
  const errors: RowError[] = [];
  const cats = await Category.find({ ownerId: user.userId }).select("nameLower").lean();
  const catMap = new Map(cats.map((c) => [c.nameLower, String(c._id)]));
  const newCats = new Set<string>();
  const valid: Array<{ rowNo: number; category: string; input: z.infer<typeof createQuestionBody>; stemKey: string }> = [];
  const seen = new Map<string, number>();
  for (const { rowNo, data } of parsed) {
    const category = String(data.category ?? "").trim();
    const rowErrors: RowError[] = [];
    if (!category) rowErrors.push({ row: rowNo, column: "category", reason: "Category is required" });
    else if (!catMap.has(category.toLowerCase()) && !autoCreate) rowErrors.push({ row: rowNo, column: "category", reason: `Unknown category "${category}" (enable autoCreateCategories to create it)` });
    const res = createQuestionBody.safeParse({ ...toQuestionInput(data), categoryId: PLACEHOLDER_CATEGORY });
    if (!res.success) for (const i of res.error.issues) rowErrors.push({ row: rowNo, column: i.path.join(".") || "row", reason: i.message });
    if (res.success) {
      const key = `${res.data.type}:${sanitizeMarkdown(res.data.stem).toLowerCase()}`;
      if (seen.has(key)) rowErrors.push({ row: rowNo, column: "stem", reason: `Duplicate of row ${seen.get(key)}` });
      seen.set(key, seen.get(key) ?? rowNo);
      if (!rowErrors.length) valid.push({ rowNo, category, input: res.data, stemKey: key });
    }
    errors.push(...rowErrors);
  }
  // duplicates against the existing bank
  if (valid.length) {
    const existing = await Question.find({ ownerId: user.userId, isArchived: false, stem: { $in: valid.map((v) => sanitizeMarkdown(v.input.stem)) } }).select("stem type").lean();
    const ex = new Set(existing.map((q) => `${q.type}:${q.stem.toLowerCase()}`));
    for (let i = valid.length - 1; i >= 0; i--) {
      if (ex.has(valid[i]!.stemKey)) {
        errors.push({ row: valid[i]!.rowNo, column: "stem", reason: "A question with the same text already exists in your bank" });
        valid.splice(i, 1);
      }
    }
  }
  for (const v of valid) if (!catMap.has(v.category.toLowerCase())) newCats.add(v.category);
  return { errors, valid, newCategories: [...newCats] };
}

// ---- job lifecycle ------------------------------------------------------------------------------------------

export function toImportDto(j: Record<string, any>) {
  const errors = (j.rowErrors ?? j.errors ?? []) as RowError[];
  return {
    id: String(j._id),
    type: j.type,
    format: j.format,
    mode: j.mode,
    status: j.status,
    atomic: j.atomic,
    autoCreateCategories: j.autoCreateCategories,
    totalRows: j.totalRows,
    validRows: j.validRows,
    errorRows: j.errorRows,
    appliedRows: j.appliedRows,
    errors: errors.slice(0, 200),
    errorsTruncated: errors.length > 200,
    failureReason: j.failureReason ?? null,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  };
}

export async function createImport(user: AuthUser, type: ImportType, file: { buffer: Buffer; originalname: string }, opts: ImportOptions) {
  const format = file.originalname.toLowerCase().endsWith(".json") ? "JSON" : "CSV";
  const parsed = parseFile(file.buffer, format);
  const job = await ImportJob.create({ type, format, mode: opts.mode === "commit" ? "COMMIT" : "DRY_RUN", status: "VALIDATING", atomic: opts.atomic, autoCreateCategories: opts.autoCreateCategories, totalRows: parsed.length, createdBy: user.userId });
  try {
    const result =
      type === "CANDIDATES"
        ? await (async () => {
            const r = await validateCandidates(parsed);
            return { errors: r.errors, rows: r.valid, newCategories: [] as string[] };
          })()
        : await (async () => {
            const r = await validateQuestions(user, parsed, opts.autoCreateCategories);
            return { errors: r.errors, rows: r.valid, newCategories: r.newCategories };
          })();
    const errorRows = new Set(result.errors.map((e) => e.row)).size;
    await ImportJob.updateOne(
      { _id: job._id },
      { $set: { status: "PREVIEW", validRows: result.rows.length, errorRows, rowErrors: result.errors.slice(0, MAX_ERRORS_STORED), rows: { rows: result.rows, newCategories: result.newCategories } } },
    );
  } catch (err) {
    await ImportJob.updateOne({ _id: job._id }, { $set: { status: "FAILED", failureReason: (err as Error).message } });
    throw err;
  }
  if (opts.mode === "commit") return commitImport(user, String(job._id));
  return toImportDto((await ImportJob.findById(job._id).lean())!);
}

async function ownJob(user: AuthUser, id: string, withRows = false) {
  const q = ImportJob.findOne(user.role === "ADMIN" && !withRows ? { _id: id } : { _id: id, createdBy: user.userId });
  if (withRows) q.select("+rows");
  const job = await q;
  if (!job) throw notFound("Import");
  return job;
}

export async function getImport(user: AuthUser, id: string) {
  return toImportDto((await ownJob(user, id)).toObject());
}

export async function commitImport(user: AuthUser, id: string) {
  const job = await ownJob(user, id);
  if (job.status !== "PREVIEW") throw conflict(`Import is ${job.status}; only a validated preview can be committed`, "CONFLICT");
  if (job.atomic && job.errorRows > 0) throw new AppError(422, "VALIDATION_FAILED", `${job.errorRows} row(s) have errors; fix them or re-upload with atomic=false to import only the valid rows`, { details: [{ field: "errorRows", issue: String(job.errorRows) }] });
  if (job.validRows === 0) throw unprocessable("There are no valid rows to import");
  const claimed = await ImportJob.findOneAndUpdate({ _id: id, status: "PREVIEW" }, { $set: { status: "APPLYING", mode: "COMMIT" } }, { new: true });
  if (!claimed) throw conflict("Import was already committed", "CONFLICT");
  if (env.IS_TEST) await processImportJob(id);
  else await enqueue("import.process", { jobId: id, userId: user.userId, role: user.role }, { jobId: `import-${id}` });
  return toImportDto((await ImportJob.findById(id).lean())!);
}

/** Worker entry point: applies a validated job. Safe against retries (guarded by the APPLYING state). */
export async function processImportJob(jobId: string) {
  const job = await ImportJob.findById(jobId).select("+rows");
  if (!job || job.status !== "APPLYING") return { skipped: true };
  const payload = job.rows as { rows: any[]; newCategories: string[] };
  try {
    const owner = (await User.findById(job.createdBy).select("role").lean()) ?? null;
    if (!owner) throw new Error("Importing user no longer exists");
    const applied = job.type === "CANDIDATES" ? await applyCandidates(job, payload.rows) : await applyQuestions(job, payload.rows, payload.newCategories);
    await ImportJob.updateOne({ _id: jobId }, { $set: { status: "DONE", appliedRows: applied.count, rowErrors: [...((job as any).rowErrors ?? []), ...applied.errors].slice(0, MAX_ERRORS_STORED), errorRows: job.errorRows + applied.errors.length }, $unset: { rows: 1 } });
    await audit({ action: `import.${job.type.toLowerCase()}`, entityType: "import", entityId: jobId, actor: { userId: String(job.createdBy) }, meta: { applied: applied.count, errors: applied.errors.length, atomic: job.atomic } });
    return { applied: applied.count };
  } catch (err) {
    logger.error("import failed", { jobId, error: (err as Error).message });
    await ImportJob.updateOne({ _id: jobId }, { $set: { status: "FAILED", failureReason: (err as Error).message, appliedRows: 0 } });
    return { failed: true };
  }
}

async function applyCandidates(job: { _id: unknown; atomic: boolean }, rows: Array<{ rowNo: number; email: string; fullName: string; registrationNo?: string }>) {
  const prepared: Array<{ rowNo: number; email: string; fullName: string; registrationNo?: string; password: string; passwordHash: string }> = [];
  for (let i = 0; i < rows.length; i += 8) {
    prepared.push(
      ...(await Promise.all(
        rows.slice(i, i + 8).map(async (r) => {
          const password = randomPassword();
          return { ...r, password, passwordHash: await hashPassword(password) };
        }),
      )),
    );
  }
  const toDoc = (p: (typeof prepared)[number]) => ({ email: p.email, fullName: p.fullName, registrationNo: p.registrationNo, role: "CANDIDATE" as const, passwordHash: p.passwordHash, mustChangePassword: true });
  const errors: RowError[] = [];
  const created: typeof prepared = [];
  if (job.atomic) {
    await withTransaction((session) => User.insertMany(prepared.map(toDoc), { session }));
    created.push(...prepared);
  } else {
    for (const p of prepared) {
      try {
        await User.create(toDoc(p));
        created.push(p);
      } catch (err) {
        errors.push({ row: p.rowNo, column: "email", reason: isDuplicateKey(err) ? "Duplicate email or registration number" : (err as Error).message });
      }
    }
  }
  // one-time credential sheet (downloaded once, then deleted)
  await redis.set(`import:creds:${String(job._id)}`, JSON.stringify(created.map((c) => ({ email: c.email, fullName: c.fullName, registrationNo: c.registrationNo ?? "", temporaryPassword: c.password }))), "EX", 3600);
  return { count: created.length, errors };
}

async function applyQuestions(job: { atomic: boolean; createdBy: unknown }, rows: Array<{ rowNo: number; category: string; input: z.infer<typeof createQuestionBody> }>, newCategories: string[]) {
  const ownerId = job.createdBy;
  const errors: RowError[] = [];
  const run = async (session?: import("mongoose").ClientSession) => {
    const cats = await Category.find({ ownerId }).select("nameLower").session(session ?? null).lean();
    const catMap = new Map(cats.map((c) => [c.nameLower, c._id as Types.ObjectId]));
    for (const name of newCategories) {
      if (catMap.has(name.toLowerCase())) continue;
      const [c] = await Category.create([{ name, nameLower: name.toLowerCase(), ownerId }], { session });
      catMap.set(name.toLowerCase(), c!._id as Types.ObjectId);
    }
    const docs = rows.map((r) => {
      const _id = new Types.ObjectId();
      return {
        rowNo: r.rowNo,
        doc: {
          _id,
          rootId: _id,
          ownerId,
          categoryId: catMap.get(r.category.toLowerCase()),
          type: r.input.type,
          stem: sanitizeMarkdown(r.input.stem),
          difficulty: r.input.difficulty,
          difficultyScore: BASE_DIFFICULTY_SCORE[r.input.difficulty],
          defaultMarks: r.input.defaultMarks,
          explanation: r.input.explanation ? sanitizeMarkdown(r.input.explanation) : undefined,
          rubric: r.input.rubric ? sanitizeMarkdown(r.input.rubric) : undefined,
          maxWords: r.input.maxWords,
          tags: r.input.tags,
          options: buildOptions(r.input.options),
        },
      };
    });
    if (session) {
      await Question.insertMany(docs.map((d) => d.doc), { session });
      return docs.length;
    }
    let ok = 0;
    for (const d of docs) {
      try {
        await Question.create(d.doc);
        ok++;
      } catch (err) {
        errors.push({ row: d.rowNo, column: "row", reason: (err as Error).message });
      }
    }
    return ok;
  };
  const count = job.atomic ? await withTransaction((s) => run(s)) : await run();
  return { count, errors };
}

// ---- downloads ----------------------------------------------------------------------------------------------

export async function importErrorsCsv(user: AuthUser, id: string) {
  const job = await ownJob(user, id);
  return toCsv([["row", "column", "reason"], ...(((job as any).rowErrors ?? []) as RowError[]).map((e) => [e.row, e.column, e.reason])]);
}

/** One-time credential sheet: deleted on first read (GETDEL), so passwords cannot be fetched twice. */
export async function importCredentialsCsv(user: AuthUser, id: string) {
  const job = await ownJob(user, id);
  if (job.type !== "CANDIDATES") throw conflict("Only candidate imports have credentials", "CONFLICT");
  const raw = await redis.getdel(`import:creds:${id}`);
  if (!raw) throw new AppError(410, "GONE", "The credential sheet has expired or was already downloaded");
  const rows = JSON.parse(raw) as Array<{ email: string; fullName: string; registrationNo: string; temporaryPassword: string }>;
  await audit({ action: "import.credentials_download", entityType: "import", entityId: id, meta: { rows: rows.length } });
  return toCsv([["email", "fullName", "registrationNo", "temporaryPassword"], ...rows.map((r) => [r.email, r.fullName, r.registrationNo, r.temporaryPassword])]);
}

export function importTemplate(type: ImportType) {
  if (type === "CANDIDATES") return toCsv([["email", "fullName", "registrationNo"], ["jane.doe@example.com", "Jane Doe", "REG-0001"], ["john.roe@example.com", "John Roe", "REG-0002"]]);
  return toCsv([
    ["type", "category", "difficulty", "marks", "stem", "option1", "option2", "option3", "option4", "correct", "explanation", "rubric", "maxWords", "tags"],
    ["MCQ_SINGLE", "Networks", "EASY", "1", "Which layer routes packets?", "Physical", "Network", "Transport", "Application", "2", "Routing is a network-layer function", "", "", "networking|osi"],
    ["MCQ_MULTI", "Networks", "MEDIUM", "2", "Select the transport protocols", "TCP", "UDP", "HTTP", "IP", "1|2", "", "", "", "networking"],
    ["WRITTEN", "Networks", "HARD", "5", "Explain the TCP three-way handshake", "", "", "", "", "", "", "SYN, SYN-ACK, ACK with sequence numbers", "200", "networking"],
  ]);
}

export async function listImports(user: AuthUser) {
  const rows = await ImportJob.find(user.role === "ADMIN" ? {} : { createdBy: user.userId }).sort({ createdAt: -1 }).limit(50).lean();
  return rows.map(toImportDto);
}

void csvSafe;
