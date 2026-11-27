import { Types } from "mongoose";
import type { Difficulty } from "../config/constants";
import { computeStatus } from "../lib/exam-status";
import { publish } from "../lib/sse";
import { buildSort, escapeRegex, pageMeta, pageParams } from "../lib/pagination";
import { shuffle } from "../lib/shuffle";
import { sumScores } from "../lib/scoring";
import { Attempt, AttemptQuestion, Answer, AnswerEvent, IntegrityEvent, Interruption, Scratchpad } from "../models/attempt.model";
import { Enrollment, Exam } from "../models/exam.model";
import { Category, Question } from "../models/question.model";
import { User } from "../models/user.model";
import { loadManagedExam } from "../policies/exam.policy";
import type { AutoSelectInput, CreateExamInput, ListExamsQuery, SetQuestionsInput, UpdateExamInput } from "../schemas/exam.schema";
import { validateExamTiming } from "../schemas/exam.schema";
import type { AuthUser } from "../types/express";
import { AppError, conflict, forbidden, unprocessable } from "../utils/errors";
import { audit } from "./audit.service";
import { finalizeAttempt } from "./finalize.service";

// ---- DTO ---------------------------------------------------------------------------------------

export function toExamDto(e: Record<string, any>, now = new Date()) {
  return {
    id: String(e._id),
    ownerId: String(e.ownerId),
    coExaminerIds: (e.coExaminerIds ?? []).map(String),
    title: e.title,
    instructions: e.instructions,
    status: computeStatus(e as never, now),
    baseStatus: e.status,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    durationMinutes: e.durationMinutes,
    totalMarks: e.totalMarks,
    passMarks: e.passMarks ?? null,
    shuffleQuestions: e.shuffleQuestions,
    shuffleOptions: e.shuffleOptions,
    negativeMarking: e.negativeMarking,
    multiSelectScheme: e.multiSelectScheme,
    maxAttempts: e.maxAttempts,
    lateEntryMinutes: e.lateEntryMinutes,
    hardWindow: e.hardWindow,
    flexibleStart: e.flexibleStart,
    fairnessMode: e.fairnessMode,
    fairnessEpsilon: e.fairnessEpsilon,
    showAnswersAfterPublish: e.showAnswersAfterPublish,
    integrityLevel: e.integrityLevel,
    disputeWindowHours: e.disputeWindowHours,
    resiliencePolicy: e.resiliencePolicy,
    questions: (e.questions ?? []).map((q: any) => ({ questionId: String(q.questionId), questionVersion: q.questionVersion, position: q.position, marks: q.marks, section: q.section })),
    blueprint: (e.blueprint ?? []).map((b: any) => ({ categoryId: String(b.categoryId), difficulty: b.difficulty, count: b.count, marksEach: b.marksEach })),
    moderation: e.moderation,
    publishedAt: e.publishedAt ?? null,
    resultsPublishedAt: e.resultsPublishedAt ?? null,
    closedAt: e.closedAt ?? null,
    version: e.version,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

const hasRealAttempts = async (examId: unknown) => Boolean(await Attempt.exists({ examId, isSandbox: false }));

async function assertExaminers(ids: string[]) {
  if (!ids.length) return;
  const found = await User.countDocuments({ _id: { $in: ids }, role: "EXAMINER", isActive: true });
  if (found !== new Set(ids).size) throw unprocessable("Co-examiners must be active examiners", "VALIDATION_FAILED", [{ field: "coExaminerIds", issue: "Unknown or non-examiner user" }]);
}

// ---- CRUD ---------------------------------------------------------------------------------------

export async function createExam(user: AuthUser, input: CreateExamInput) {
  await assertExaminers(input.coExaminerIds);
  const exam = await Exam.create({
    ...input,
    coExaminerIds: input.coExaminerIds.filter((id) => id !== user.userId),
    ownerId: user.userId,
    status: "DRAFT",
  });
  await audit({ action: "exam.create", entityType: "exam", entityId: exam._id, after: { title: exam.title } });
  return toExamDto(exam.toObject());
}

function statusFilter(status: string, now: Date): Record<string, unknown> {
  const live = { status: { $in: ["PUBLISHED", "ONGOING", "COMPLETED"] }, closedAt: null };
  switch (status) {
    case "DRAFT":
    case "ARCHIVED":
      return { status };
    case "PUBLISHED":
      return { ...live, startsAt: { $gt: now } };
    case "ONGOING":
      return { ...live, startsAt: { $lte: now }, endsAt: { $gte: now } };
    default:
      return { status: { $in: ["PUBLISHED", "ONGOING", "COMPLETED"] }, $or: [{ closedAt: { $ne: null } }, { endsAt: { $lt: now } }] };
  }
}

export async function listExams(user: AuthUser, query: ListExamsQuery) {
  const now = new Date();
  const p = pageParams(query);
  const filter: Record<string, unknown> = user.role === "ADMIN" ? {} : { $or: [{ ownerId: user.userId }, { coExaminerIds: user.userId }] };
  const and: Record<string, unknown>[] = [filter];
  if (query.status) and.push(statusFilter(query.status, now));
  if (user.role === "ADMIN" && query.ownerId) and.push({ ownerId: query.ownerId });
  if (query.q) and.push({ title: new RegExp(escapeRegex(query.q), "i") });
  const sort = buildSort(query.sort, ["createdAt", "startsAt", "endsAt", "title"], { createdAt: -1 });
  const [rows, total] = await Promise.all([
    Exam.find({ $and: and }).select("-questions -keyOverrides").sort(sort).skip(p.skip).limit(p.pageSize).lean(),
    Exam.countDocuments({ $and: and }),
  ]);
  return { rows: rows.map((r) => toExamDto(r, now)), meta: pageMeta(p, total) };
}

export async function getExam(user: AuthUser, id: string) {
  const exam = await loadManagedExam(user, id, "read");
  const [enrolled, attempts, inProgress] = await Promise.all([
    Enrollment.countDocuments({ examId: exam._id, status: "ENROLLED" }),
    Attempt.countDocuments({ examId: exam._id, isSandbox: false }),
    Attempt.countDocuments({ examId: exam._id, isSandbox: false, status: "IN_PROGRESS" }),
  ]);
  return { ...toExamDto(exam.toObject()), counts: { enrolled, attempts, inProgress }, keyOverrides: exam.keyOverrides.map((k) => ({ questionId: String(k.questionId), policy: k.policy, reason: k.reason, appliedAt: k.appliedAt })) };
}

const STRUCTURAL = [
  "startsAt", "durationMinutes", "totalMarks", "passMarks", "shuffleQuestions", "shuffleOptions", "negativeMarking", "multiSelectScheme",
  "maxAttempts", "lateEntryMinutes", "hardWindow", "flexibleStart", "fairnessMode", "fairnessEpsilon", "integrityLevel", "resiliencePolicy",
] as const;

export async function updateExam(user: AuthUser, id: string, input: UpdateExamInput, ifMatch?: number) {
  const exam = await loadManagedExam(user, id, "write");
  if (ifMatch !== undefined && ifMatch !== exam.version) throw new AppError(412, "VERSION_MISMATCH", "Exam was modified by someone else", { details: [{ issue: `current version is ${exam.version}` }] });
  const now = new Date();
  const status = computeStatus(exam, now);
  if (status === "ARCHIVED") throw conflict("Archived exams cannot be edited", "EXAM_LOCKED_FIELDS");

  const real = await hasRealAttempts(exam._id);
  const locked = real || status === "ONGOING" || status === "COMPLETED";
  const keys = Object.keys(input) as (keyof UpdateExamInput)[];
  if (locked) {
    const blocked = keys.filter((k) => (STRUCTURAL as readonly string[]).includes(k));
    if (blocked.length) {
      throw conflict("These fields cannot change once the exam has started or has attempts", "EXAM_LOCKED_FIELDS", blocked.map((f) => ({ field: f, issue: "Locked" })));
    }
    if (input.endsAt && input.endsAt.getTime() < exam.endsAt.getTime()) {
      throw conflict("After attempts exist the window can only be extended", "EXAM_LOCKED_FIELDS", [{ field: "endsAt", issue: "Can only be extended" }]);
    }
  }
  if (input.coExaminerIds) {
    if (String(exam.ownerId) !== user.userId) throw forbidden("Only the owner can change co-examiners");
    await assertExaminers(input.coExaminerIds);
  }

  const merged = {
    startsAt: input.startsAt ?? exam.startsAt,
    endsAt: input.endsAt ?? exam.endsAt,
    durationMinutes: input.durationMinutes ?? exam.durationMinutes,
    flexibleStart: input.flexibleStart ?? exam.flexibleStart,
    passMarks: input.passMarks ?? exam.passMarks,
    totalMarks: input.totalMarks ?? exam.totalMarks,
  };
  const issues: { field: string; issue: string }[] = [];
  validateExamTiming(merged, { addIssue: (i: any) => issues.push({ field: i.path.join("."), issue: i.message }) } as never);
  if (issues.length) throw unprocessable("Exam validation failed", "VALIDATION_FAILED", issues);

  const set: Record<string, unknown> = { ...input };
  if (input.coExaminerIds) set.coExaminerIds = input.coExaminerIds.filter((c) => c !== String(exam.ownerId));
  if (input.resiliencePolicy) {
    for (const [k, v] of Object.entries(input.resiliencePolicy)) set[`resiliencePolicy.${k}`] = v;
    delete set.resiliencePolicy;
  }

  if (exam.status === "PUBLISHED" && !real) {
    const trial = { ...exam.toObject(), ...(set as object) };
    const r = await evaluateReadiness(trial as never, { checkFuture: false });
    if (r.errors.length) throw unprocessable("Edit would leave the published exam invalid", "VALIDATION_FAILED", r.errors.map((e) => ({ field: e.key, issue: e.message })));
  }

  const filter: Record<string, unknown> = { _id: exam._id, version: exam.version };
  const updated = await Exam.findOneAndUpdate(filter, { $set: set, $inc: { version: 1 } }, { new: true });
  if (!updated) throw new AppError(412, "VERSION_MISMATCH", "Exam was modified concurrently");

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of keys) {
    before[k] = (exam as any)[k];
    after[k] = (updated as any)[k];
  }
  await audit({ action: exam.status === "DRAFT" ? "exam.update" : "exam.update_published", entityType: "exam", entityId: exam._id, before, after });
  if (exam.status !== "DRAFT") await publish(`exam:${id}`, { type: "exam_status", data: { examId: id, changed: keys, version: updated.version } });
  return toExamDto(updated.toObject());
}

export async function deleteExam(user: AuthUser, id: string) {
  const exam = await loadManagedExam(user, id, "write");
  if (exam.status !== "DRAFT") throw conflict("Only draft exams can be deleted", "EXAM_NOT_DRAFT");
  if (String(exam.ownerId) !== user.userId) throw forbidden("Only the owner can delete an exam");
  await purgeSandboxData({ examId: exam._id });
  await Enrollment.deleteMany({ examId: exam._id });
  await exam.deleteOne();
  await audit({ action: "exam.delete", entityType: "exam", entityId: exam._id, before: { title: exam.title } });
}

/** Deletes sandbox attempts and everything hanging off them. */
export async function purgeSandboxData(filter: Record<string, unknown>) {
  const ids = (await Attempt.find({ ...filter, isSandbox: true }).select("_id").lean()).map((a) => a._id);
  if (!ids.length) return 0;
  await Promise.all([
    AttemptQuestion.deleteMany({ attemptId: { $in: ids } }),
    Answer.deleteMany({ attemptId: { $in: ids } }),
    AnswerEvent.deleteMany({ attemptId: { $in: ids } }),
    IntegrityEvent.deleteMany({ attemptId: { $in: ids } }),
    Interruption.deleteMany({ attemptId: { $in: ids } }),
    Scratchpad.deleteMany({ attemptId: { $in: ids } }),
  ]);
  await Attempt.deleteMany({ _id: { $in: ids } });
  return ids.length;
}

// ---- questions on an exam ---------------------------------------------------------------------

export function effectiveTotalMarks(exam: { questions: Array<{ marks: number }>; blueprint?: Array<{ count: number; marksEach: number }> }) {
  if (exam.blueprint?.length) return sumScores(exam.blueprint.map((s) => s.count * s.marksEach));
  return sumScores(exam.questions.map((q) => q.marks));
}

async function assertDraftOrNoAttempts(exam: { _id: unknown; status: string; startsAt: Date; endsAt: Date }) {
  if (await hasRealAttempts(exam._id)) throw conflict("Questions are locked once attempts exist", "EXAM_LOCKED_FIELDS");
  if (["ONGOING", "COMPLETED", "ARCHIVED"].includes(computeStatus(exam, new Date()))) throw conflict("Questions are locked for this exam state", "EXAM_LOCKED_FIELDS");
}

export async function setExamQuestions(user: AuthUser, id: string, input: SetQuestionsInput) {
  const exam = await loadManagedExam(user, id, "write");
  await assertDraftOrNoAttempts(exam);
  const allowedOwners = [String(exam.ownerId), ...exam.coExaminerIds.map(String)];
  const qs = await Question.find({ _id: { $in: input.questions.map((q) => q.questionId) } }).lean();
  const byId = new Map(qs.map((q) => [String(q._id), q]));
  const issues: { field: string; issue: string }[] = [];
  input.questions.forEach((q, i) => {
    const doc = byId.get(q.questionId);
    if (!doc || !allowedOwners.includes(String(doc.ownerId))) issues.push({ field: `questions.${i}.questionId`, issue: "Question not found" });
    else if (doc.isArchived) issues.push({ field: `questions.${i}.questionId`, issue: "Question is archived" });
  });
  if (issues.length) throw unprocessable("Invalid question list", "VALIDATION_FAILED", issues);

  exam.questions = input.questions.map((q, i) => {
    const doc = byId.get(q.questionId)!;
    return { questionId: doc._id, questionVersion: doc.version, position: i, marks: q.marks ?? doc.defaultMarks, section: q.section ?? "" };
  }) as never;
  if (input.blueprint) exam.blueprint = input.blueprint.map((b) => ({ ...b, categoryId: new Types.ObjectId(b.categoryId) })) as never;
  if (input.syncTotalMarks) exam.totalMarks = effectiveTotalMarks({ questions: exam.questions, blueprint: exam.blueprint }) || exam.totalMarks;
  exam.version += 1;
  await exam.save();
  await audit({ action: "exam.set_questions", entityType: "exam", entityId: exam._id, after: { count: exam.questions.length, totalMarks: exam.totalMarks } });
  return toExamDto(exam.toObject());
}

async function descendantCategoryIds(rootId: string, ownerId: unknown) {
  const all = await Category.find({ ownerId }).select("_id parentId").lean();
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of all) if (c.parentId && ids.has(String(c.parentId)) && !ids.has(String(c._id))) (ids.add(String(c._id)), (grew = true));
  }
  return [...ids];
}

export async function autoSelect(user: AuthUser, id: string, input: AutoSelectInput) {
  const exam = await loadManagedExam(user, id, "write");
  await assertDraftOrNoAttempts(exam);
  const picked: { questionId: Types.ObjectId; version: number; marks: number; section: string }[] = [];
  const used = new Set<string>(input.replace ? [] : exam.questions.map((q) => String(q.questionId)));
  const problems: { field: string; issue: string }[] = [];

  for (const [i, s] of input.slots.entries()) {
    const cats = await descendantCategoryIds(s.categoryId, exam.ownerId);
    const pool = await Question.find({ ownerId: exam.ownerId, categoryId: { $in: cats }, difficulty: s.difficulty as Difficulty, isArchived: false, _id: { $nin: [...used] } }).select("_id version").lean();
    const need = s.poolSize ?? s.count;
    if (need < s.count) problems.push({ field: `slots.${i}.poolSize`, issue: "poolSize must be >= count" });
    if (pool.length < need) {
      problems.push({ field: `slots.${i}`, issue: `Only ${pool.length} matching questions available, ${need} required` });
      continue;
    }
    for (const q of shuffle(pool, Math.random).slice(0, need)) {
      used.add(String(q._id));
      picked.push({ questionId: q._id as Types.ObjectId, version: q.version, marks: s.marksEach, section: String(i + 1) });
    }
  }
  if (problems.length) throw unprocessable("Not enough questions to satisfy the blueprint", "INSUFFICIENT_QUESTIONS", problems);

  const kept = input.replace ? [] : exam.questions.map((q) => ({ questionId: q.questionId, version: q.questionVersion, marks: q.marks, section: q.section }));
  exam.questions = [...kept, ...picked].map((q, i) => ({ questionId: q.questionId, questionVersion: q.version, position: i, marks: q.marks, section: q.section ?? "" })) as never;
  exam.blueprint = input.slots.map((s) => ({ categoryId: new Types.ObjectId(s.categoryId), difficulty: s.difficulty, count: s.count, marksEach: s.marksEach })) as never;
  if (input.syncTotalMarks) exam.totalMarks = effectiveTotalMarks({ questions: exam.questions, blueprint: exam.blueprint }) || exam.totalMarks;
  exam.version += 1;
  await exam.save();
  await audit({ action: "exam.auto_select", entityType: "exam", entityId: exam._id, after: { questions: exam.questions.length } });
  return toExamDto(exam.toObject());
}

// ---- readiness / publish -----------------------------------------------------------------------

export interface Check {
  key: string;
  status: "PASS" | "FAIL" | "WARN";
  message: string;
}

export async function evaluateReadiness(exam: Record<string, any>, opts: { checkFuture: boolean }) {
  const checks: Check[] = [];
  const add = (key: string, ok: boolean, message: string, level: "FAIL" | "WARN" = "FAIL") => checks.push({ key, status: ok ? "PASS" : level, message });
  const now = new Date();

  const ids = (exam.questions ?? []).map((q: any) => q.questionId);
  const qs = await Question.find({ _id: { $in: ids } }).lean();
  const byId = new Map(qs.map((q) => [String(q._id), q]));

  add("questions.count", ids.length >= 1, ids.length ? `${ids.length} question(s) assigned` : "At least one question is required");
  const missing = ids.filter((id: unknown) => !byId.has(String(id)) || byId.get(String(id))!.isArchived);
  add("questions.available", missing.length === 0, missing.length ? `${missing.length} question(s) are missing or archived` : "All questions are available");
  const invalid = qs.filter((q) => q.type !== "WRITTEN" && (q.options.length < 2 || q.options.filter((o) => o.isCorrect).length < 1 || (q.type === "MCQ_SINGLE" && q.options.filter((o) => o.isCorrect).length !== 1)));
  add("questions.valid", invalid.length === 0, invalid.length ? `${invalid.length} MCQ(s) have an invalid answer key` : "All objective questions have valid keys");

  const blueprint = (exam.blueprint ?? []) as any[];
  if (blueprint.length) {
    const seen = new Set<string>();
    let dup = false;
    for (const s of blueprint) {
      const k = `${s.categoryId}:${s.difficulty}`;
      if (seen.has(k)) dup = true;
      seen.add(k);
    }
    add("blueprint.unique", !dup, dup ? "Blueprint slots must have unique category + difficulty" : "Blueprint slots are unique");
    for (const [i, s] of blueprint.entries()) {
      const pool = (exam.questions as any[]).filter((q) => {
        const d = byId.get(String(q.questionId));
        return d && String(d.categoryId) === String(s.categoryId) && d.difficulty === s.difficulty;
      });
      add(`blueprint.slot${i}.pool`, pool.length >= s.count, pool.length >= s.count ? `Slot ${i + 1}: pool of ${pool.length} for ${s.count} picks` : `Slot ${i + 1}: pool has ${pool.length} questions but ${s.count} are required`);
      add(`blueprint.slot${i}.marks`, pool.every((q) => q.marks === s.marksEach), `Slot ${i + 1}: every pooled question must carry ${s.marksEach} marks`);
    }
    const matched = new Set<string>();
    for (const q of exam.questions as any[]) {
      const d = byId.get(String(q.questionId));
      if (d && blueprint.some((s) => String(d.categoryId) === String(s.categoryId) && d.difficulty === s.difficulty)) matched.add(String(q.questionId));
    }
    add("blueprint.coverage", matched.size === ids.length, `${ids.length - matched.size} assigned question(s) match no blueprint slot and will never be used`, "WARN");
  } else {
    add("fairness.blueprint", exam.fairnessMode !== "BALANCED", "BALANCED fairness mode requires a blueprint (use auto-select or provide one)");
  }

  const eff = effectiveTotalMarks({ questions: exam.questions ?? [], blueprint });
  add("marks.total", eff === exam.totalMarks, eff === exam.totalMarks ? `Total marks ${exam.totalMarks} match assigned marks` : `Assigned marks sum to ${eff} but totalMarks is ${exam.totalMarks}`);
  add("marks.pass", exam.passMarks == null || exam.passMarks <= exam.totalMarks, "Pass marks must not exceed total marks");
  const windowOk = new Date(exam.endsAt) > new Date(exam.startsAt);
  add("schedule.window", windowOk, "endsAt must be after startsAt");
  add("schedule.duration", exam.flexibleStart || exam.durationMinutes * 60_000 <= new Date(exam.endsAt).getTime() - new Date(exam.startsAt).getTime(), "Duration must fit within the window (or enable flexibleStart)");
  if (opts.checkFuture) add("schedule.future", new Date(exam.startsAt).getTime() >= now.getTime() + 5 * 60_000, "Start time must be at least 5 minutes in the future");

  const written = qs.filter((q) => q.type === "WRITTEN").length;
  if (written) add("grading.manual", false, `${written} written question(s) require manual grading before results can be published`, "WARN");
  if (exam._id) {
    const enrolled = await Enrollment.countDocuments({ examId: exam._id, status: "ENROLLED" });
    add("enrollment.count", enrolled > 0, enrolled ? `${enrolled} candidate(s) enrolled` : "No candidates are enrolled yet", "WARN");
  }

  const errors = checks.filter((c) => c.status === "FAIL");
  const warnings = checks.filter((c) => c.status === "WARN");
  return { ready: errors.length === 0, errors, warnings, checklist: checks, effectiveTotalMarks: eff };
}

export async function previewExam(user: AuthUser, id: string) {
  const exam = await loadManagedExam(user, id, "read");
  const [readiness, questions] = await Promise.all([
    evaluateReadiness(exam.toObject(), { checkFuture: exam.status === "DRAFT" }),
    Question.find({ _id: { $in: exam.questions.map((q) => q.questionId) } }).select("stem type difficulty categoryId").lean(),
  ]);
  const qMap = new Map(questions.map((q) => [String(q._id), q]));
  return {
    exam: toExamDto(exam.toObject()),
    readiness,
    questions: exam.questions.map((q) => ({ questionId: String(q.questionId), position: q.position, marks: q.marks, type: qMap.get(String(q.questionId))?.type, difficulty: qMap.get(String(q.questionId))?.difficulty, stem: qMap.get(String(q.questionId))?.stem?.slice(0, 200) })),
  };
}

export async function publishExam(user: AuthUser, id: string, acknowledgeWarnings: boolean) {
  const exam = await loadManagedExam(user, id, "write");
  if (exam.status !== "DRAFT") throw conflict("Exam is already published", "EXAM_ALREADY_PUBLISHED");
  const readiness = await evaluateReadiness(exam.toObject(), { checkFuture: true });
  if (!readiness.ready) throw unprocessable("Exam is not ready to publish", "EXAM_NOT_READY", readiness.errors.map((e) => ({ field: e.key, issue: e.message })));
  // Warnings never block publishing; they are returned so the UI can surface them.
  void acknowledgeWarnings;
  const published = await Exam.findOneAndUpdate(
    { _id: exam._id, status: "DRAFT", version: exam.version },
    { $set: { status: "PUBLISHED", publishedAt: new Date() }, $inc: { version: 1 } },
    { new: true },
  );
  if (!published) throw conflict("Exam was changed or already published; reload and retry", "EXAM_ALREADY_PUBLISHED");
  await audit({ action: "exam.publish", entityType: "exam", entityId: exam._id, after: { startsAt: exam.startsAt } });
  return { exam: toExamDto(published.toObject()), warnings: readiness.warnings };
}

export async function unpublishExam(user: AuthUser, id: string) {
  const exam = await loadManagedExam(user, id, "write");
  if (exam.status === "DRAFT") throw conflict("Exam is not published", "EXAM_NOT_PUBLISHED");
  if (await hasRealAttempts(exam._id)) throw conflict("Cannot unpublish: attempts exist", "EXAM_LOCKED_FIELDS");
  const updated = await Exam.findOneAndUpdate({ _id: exam._id, status: { $in: ["PUBLISHED", "ONGOING", "COMPLETED"] } }, { $set: { status: "DRAFT" }, $unset: { publishedAt: 1, closedAt: 1 }, $inc: { version: 1 } }, { new: true });
  await audit({ action: "exam.unpublish", entityType: "exam", entityId: exam._id });
  return toExamDto(updated!.toObject());
}

export async function closeExam(user: AuthUser, id: string) {
  const exam = await loadManagedExam(user, id, "write");
  const now = new Date();
  const status = computeStatus(exam, now);
  if (status === "DRAFT" || status === "ARCHIVED") throw conflict("Exam is not live", "EXAM_NOT_PUBLISHED");
  if (status === "PUBLISHED") throw conflict("Exam has not started; unpublish instead", "EXAM_NOT_AVAILABLE");
  const active = await Attempt.find({ examId: exam._id, status: "IN_PROGRESS" }).select("_id").lean();
  exam.closedAt = now;
  if (exam.endsAt > now) exam.endsAt = now;
  exam.version += 1;
  await exam.save();
  let finalized = 0;
  for (const a of active) {
    const r = await finalizeAttempt(String(a._id), "EXAMINER", { actorId: user.userId });
    if (r.finalizedNow) finalized++;
  }
  await Exam.updateOne({ _id: exam._id }, { $set: { status: "COMPLETED" } });
  await publish(`exam:${id}`, { type: "exam_status", data: { examId: id, status: "COMPLETED" } });
  await audit({ action: "exam.close", entityType: "exam", entityId: exam._id, meta: { finalizedAttempts: finalized } });
  return { exam: toExamDto((await Exam.findById(exam._id).lean())!), finalizedAttempts: finalized };
}

export async function archiveExam(user: AuthUser, id: string) {
  const exam = await loadManagedExam(user, id, "write");
  if (computeStatus(exam, new Date()) !== "COMPLETED") throw conflict("Only completed exams can be archived", "EXAM_NOT_COMPLETED");
  if (await Attempt.exists({ examId: exam._id, status: "IN_PROGRESS" })) throw conflict("Active attempts remain", "ATTEMPT_ALREADY_ACTIVE");
  exam.status = "ARCHIVED";
  await exam.save();
  await audit({ action: "exam.archive", entityType: "exam", entityId: exam._id });
  return toExamDto(exam.toObject());
}