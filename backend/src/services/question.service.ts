import { Types } from "mongoose";
import { z } from "zod";
import { BASE_DIFFICULTY_SCORE } from "../config/constants";
import { buildSort, escapeRegex, pageMeta, pageParams } from "../lib/pagination";
import { sanitizeMarkdown } from "../lib/sanitize";
import { AttemptQuestion } from "../models/attempt.model";
import { Exam } from "../models/exam.model";
import { Category, Question, type QuestionDoc } from "../models/question.model";
import type { AuthUser } from "../types/express";
import type {
  CreateQuestionInput,
  ListQuestionsQuery,
  UpdateQuestionInput,
} from "../schemas/question.schema";
import { validateQuestionShape } from "../schemas/question.schema";
import { AppError, conflict, notFound, unprocessable } from "../utils/errors";
import { audit } from "./audit.service";
import type { categoryBody, categoryPatchBody } from "../schemas/question.schema";

// ---- categories -------------------------------------------------------------------------------

const ownerFilter = (user: AuthUser) => (user.role === "ADMIN" ? {} : { ownerId: user.userId });

export async function listCategories(user: AuthUser) {
  const rows = await Category.find(ownerFilter(user)).sort({ nameLower: 1 }).lean();
  const counts = await Question.aggregate([
    { $match: { isArchived: false, ...(user.role === "ADMIN" ? {} : { ownerId: new Types.ObjectId(user.userId) }) } },
    { $group: { _id: "$categoryId", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.count as number]));
  const nodes = rows.map((c) => ({ id: String(c._id), name: c.name, parentId: c.parentId ? String(c.parentId) : null, questionCount: countMap.get(String(c._id)) ?? 0, children: [] as unknown[] }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots: typeof nodes = [];
  for (const n of nodes) {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  return { flat: nodes.map(({ children: _c, ...rest }) => rest), tree: roots };
}

async function assertOwnCategory(user: AuthUser, id: string) {
  const cat = await Category.findOne({ _id: id, ...ownerFilter(user) });
  if (!cat) throw notFound("Category");
  return cat;
}

export async function createCategory(user: AuthUser, input: z.infer<typeof categoryBody>) {
  if (input.parentId) await assertOwnCategory(user, input.parentId);
  const nameLower = input.name.toLowerCase();
  if (await Category.exists({ ownerId: user.userId, nameLower })) throw conflict("A category with this name already exists", "CONFLICT", [{ field: "name", issue: "Already exists" }]);
  const cat = await Category.create({ name: input.name, nameLower, parentId: input.parentId ?? null, ownerId: user.userId });
  await audit({ action: "category.create", entityType: "category", entityId: cat._id, after: { name: cat.name, parentId: cat.parentId ? String(cat.parentId) : null } });
  return { id: String(cat._id), name: cat.name, parentId: cat.parentId ? String(cat.parentId) : null };
}

export async function updateCategory(user: AuthUser, id: string, input: z.infer<typeof categoryPatchBody>) {
  const cat = await assertOwnCategory(user, id);
  const before = { name: cat.name, parentId: cat.parentId ? String(cat.parentId) : null };
  if (input.parentId !== undefined) {
    if (input.parentId === id) throw unprocessable("A category cannot be its own parent");
    if (input.parentId) {
      await assertOwnCategory(user, input.parentId);
      // walk up from the proposed parent to make sure we do not create a cycle
      let cursor: string | null = input.parentId;
      for (let i = 0; cursor && i < 50; i++) {
        if (cursor === id) throw unprocessable("This move would create a cycle");
        const p: { parentId?: unknown } | null = await Category.findById(cursor).select("parentId").lean();
        cursor = p?.parentId ? String(p.parentId) : null;
      }
    }
    cat.parentId = (input.parentId ?? null) as never;
  }
  if (input.name !== undefined) {
    const nameLower = input.name.toLowerCase();
    if (nameLower !== cat.nameLower && (await Category.exists({ ownerId: cat.ownerId, nameLower, _id: { $ne: cat._id } }))) {
      throw conflict("A category with this name already exists", "CONFLICT");
    }
    cat.name = input.name;
    cat.nameLower = nameLower;
  }
  await cat.save();
  await audit({ action: "category.update", entityType: "category", entityId: cat._id, before, after: { name: cat.name, parentId: cat.parentId ? String(cat.parentId) : null } });
  return { id: String(cat._id), name: cat.name, parentId: cat.parentId ? String(cat.parentId) : null };
}

export async function deleteCategory(user: AuthUser, id: string) {
  const cat = await assertOwnCategory(user, id);
  const [questions, children] = await Promise.all([Question.exists({ categoryId: id }), Category.exists({ parentId: id })]);
  if (questions || children) throw conflict("Category still has questions or sub-categories", "CATEGORY_NOT_EMPTY");
  await cat.deleteOne();
  await audit({ action: "category.delete", entityType: "category", entityId: id, before: { name: cat.name } });
}

// ---- questions --------------------------------------------------------------------------------

const LABELS = "ABCDEFGHIJ";

export function toQuestionDto(q: Record<string, any>) {
  return {
    id: String(q._id),
    type: q.type,
    categoryId: String(q.categoryId),
    difficulty: q.difficulty,
    difficultyScore: q.difficultyScore,
    stem: q.stem,
    defaultMarks: q.defaultMarks,
    explanation: q.explanation ?? null,
    rubric: q.rubric ?? null,
    maxWords: q.maxWords ?? null,
    tags: q.tags ?? [],
    options: (q.options ?? []).map((o: any) => ({ id: String(o._id), label: o.label, text: o.text, isCorrect: o.isCorrect, position: o.position })),
    version: q.version,
    isArchived: q.isArchived,
    ambiguityFlag: q.ambiguityFlag,
    ownerId: String(q.ownerId),
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

export const buildOptions = (opts: Array<{ text: string; isCorrect: boolean }>) =>
  opts.map((o, i) => ({ label: LABELS[i] as string, text: sanitizeMarkdown(o.text), isCorrect: o.isCorrect, position: i }));

export async function loadQuestion(user: AuthUser, id: string): Promise<QuestionDoc> {
  const q = await Question.findOne({ _id: id, ...ownerFilter(user) });
  if (!q) throw notFound("Question");
  return q;
}

export async function listQuestions(user: AuthUser, query: ListQuestionsQuery) {
  const p = pageParams(query);
  const filter: Record<string, unknown> = { ...ownerFilter(user), isArchived: query.archived ?? false };
  if (user.role === "ADMIN" && query.ownerId) filter.ownerId = query.ownerId;
  if (query.categoryId) filter.categoryId = query.categoryId;
  if (query.difficulty) filter.difficulty = query.difficulty;
  if (query.type) filter.type = query.type;
  if (query.tags) filter.tags = { $in: query.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) };
  if (query.q) filter.stem = new RegExp(escapeRegex(query.q), "i");
  const sort = buildSort(query.sort, ["createdAt", "updatedAt", "difficultyScore", "defaultMarks"], { createdAt: -1 });
  const [rows, total] = await Promise.all([
    Question.find(filter).sort(sort).skip(p.skip).limit(p.pageSize).lean(),
    Question.countDocuments(filter),
  ]);
  return { rows: rows.map(toQuestionDto), meta: pageMeta(p, total) };
}

export async function createQuestion(user: AuthUser, input: CreateQuestionInput) {
  await assertOwnCategory(user, input.categoryId);
  const q = await Question.create({
    ownerId: user.userId,
    categoryId: input.categoryId,
    type: input.type,
    stem: sanitizeMarkdown(input.stem),
    difficulty: input.difficulty,
    difficultyScore: BASE_DIFFICULTY_SCORE[input.difficulty],
    defaultMarks: input.defaultMarks,
    explanation: input.explanation ? sanitizeMarkdown(input.explanation) : undefined,
    rubric: input.rubric ? sanitizeMarkdown(input.rubric) : undefined,
    maxWords: input.maxWords,
    tags: input.tags,
    options: buildOptions(input.options),
  });
  q.rootId = q._id as never;
  await q.save();
  await audit({ action: "question.create", entityType: "question", entityId: q._id, after: { type: q.type, categoryId: String(q.categoryId), version: q.version } });
  return toQuestionDto(q.toObject());
}

export async function isQuestionUsed(id: string) {
  const [exam, snap] = await Promise.all([Exam.exists({ "questions.questionId": id }), AttemptQuestion.exists({ questionId: id })]);
  return Boolean(exam || snap);
}

async function isLockedByPublishedExam(id: string) {
  const [exam, snap] = await Promise.all([Exam.exists({ "questions.questionId": id, status: { $ne: "DRAFT" } }), AttemptQuestion.exists({ questionId: id })]);
  return Boolean(exam || snap);
}

export async function updateQuestion(user: AuthUser, id: string, input: UpdateQuestionInput, ifMatch?: number) {
  const q = await loadQuestion(user, id);
  if (ifMatch !== undefined && ifMatch !== q.version) throw new AppError(412, "VERSION_MISMATCH", "Question was modified by someone else", { details: [{ issue: `current version is ${q.version}` }] });
  if (input.categoryId) await assertOwnCategory(user, input.categoryId);

  // cross-field validation against the merged state
  const mergedOptions = input.options ?? q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect }));
  const mergedMaxWords = input.maxWords === undefined ? q.maxWords : input.maxWords;
  const issues: { field: string; issue: string }[] = [];
  validateQuestionShape({ type: q.type, options: mergedOptions, maxWords: q.type === "WRITTEN" ? undefined : mergedMaxWords }, {
    addIssue: (i: any) => issues.push({ field: (i.path ?? []).join("."), issue: i.message }),
  } as never);
  if (issues.length) throw unprocessable("Question validation failed", "VALIDATION_FAILED", issues);

  const apply = (target: Record<string, any>) => {
    if (input.categoryId) target.categoryId = input.categoryId;
    if (input.difficulty) {
      target.difficulty = input.difficulty;
      target.difficultyScore = BASE_DIFFICULTY_SCORE[input.difficulty];
      target.calibrationCount = 0;
    }
    if (input.stem !== undefined) target.stem = sanitizeMarkdown(input.stem);
    if (input.defaultMarks !== undefined) target.defaultMarks = input.defaultMarks;
    if (input.explanation !== undefined) target.explanation = sanitizeMarkdown(input.explanation);
    if (input.rubric !== undefined) target.rubric = sanitizeMarkdown(input.rubric);
    if (input.maxWords !== undefined) target.maxWords = input.maxWords ?? undefined;
    if (input.tags) target.tags = input.tags;
    if (input.options) target.options = buildOptions(input.options);
  };

  if (await isLockedByPublishedExam(id)) {
    // Published/used questions are immutable: edits fork a new version, old one stays frozen for existing exams.
    const base = q.toObject();
    const { _id, createdAt, updatedAt, __v, ...rest } = base as Record<string, any>;
    rest.options = (rest.options ?? []).map((o: any) => ({ label: o.label, text: o.text, isCorrect: o.isCorrect, position: o.position }));
    apply(rest);
    rest.version = q.version + 1;
    rest.rootId = q.rootId ?? q._id;
    rest.isArchived = false;
    const fork = await Question.create(rest);
    q.isArchived = true;
    await q.save();
    await Exam.updateMany(
      { status: "DRAFT", "questions.questionId": q._id },
      { $set: { "questions.$[e].questionId": fork._id, "questions.$[e].questionVersion": fork.version } },
      { arrayFilters: [{ "e.questionId": q._id }] },
    );
    await audit({ action: "question.fork", entityType: "question", entityId: fork._id, meta: { previousId: id, version: fork.version } });
    return { question: toQuestionDto(fork.toObject()), newVersionCreated: true };
  }

  const before = { stem: q.stem, version: q.version };
  apply(q as unknown as Record<string, any>);
  q.version += 1;
  await q.save();
  await audit({ action: "question.update", entityType: "question", entityId: q._id, before, after: { version: q.version } });
  return { question: toQuestionDto(q.toObject()), newVersionCreated: false };
}

export async function deleteQuestion(user: AuthUser, id: string) {
  const q = await loadQuestion(user, id);
  if (await isQuestionUsed(id)) {
    q.isArchived = true;
    await q.save();
    await audit({ action: "question.archive", entityType: "question", entityId: q._id, before: { isArchived: false }, after: { isArchived: true } });
    return { archived: true };
  }
  await q.deleteOne();
  await audit({ action: "question.delete", entityType: "question", entityId: id, before: { version: q.version } });
  return { archived: false };
}

export async function duplicateQuestion(user: AuthUser, id: string) {
  const q = await loadQuestion(user, id);
  const { _id, createdAt, updatedAt, __v, rootId, ...rest } = q.toObject() as Record<string, any>;
  const copy = await Question.create({
    ...rest,
    options: (rest.options ?? []).map((o: any) => ({ label: o.label, text: o.text, isCorrect: o.isCorrect, position: o.position })),
    version: 1,
    isArchived: false,
    ambiguityFlag: false,
    calibrationCount: 0,
  });
  copy.rootId = copy._id as never;
  await copy.save();
  await audit({ action: "question.duplicate", entityType: "question", entityId: copy._id, meta: { sourceId: id } });
  return toQuestionDto(copy.toObject());
}
