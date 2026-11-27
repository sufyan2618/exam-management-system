import { z } from "zod";
import { DIFFICULTIES, QUESTION_TYPES } from "../config/constants";
import { paginationQuery } from "../lib/pagination";
import { boolQuery, marks, objectId, text } from "../utils/validators";

export const categoryBody = z.object({ name: text(1, 100), parentId: objectId.nullable().optional() }).strict();
export const categoryPatchBody = z
  .object({ name: text(1, 100).optional(), parentId: objectId.nullable().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

const optionInput = z.object({ text: text(1, 1000), isCorrect: z.boolean() }).strict();
const tags = z.array(text(1, 40)).max(20).transform((a) => [...new Set(a.map((t) => t.toLowerCase()))]);

/** Cross-field rules shared by create and (merged) update. */
export function validateQuestionShape(
  v: { type: (typeof QUESTION_TYPES)[number]; options?: Array<{ text: string; isCorrect: boolean }>; maxWords?: number | null },
  ctx: z.RefinementCtx,
) {
  const opts = v.options ?? [];
  if (v.type === "WRITTEN") {
    if (opts.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Written questions cannot have options" });
    return;
  }
  if (v.maxWords) ctx.addIssue({ code: "custom", path: ["maxWords"], message: "maxWords applies to written questions only" });
  if (opts.length < 2 || opts.length > 10) ctx.addIssue({ code: "custom", path: ["options"], message: "Provide between 2 and 10 options" });
  const seen = new Set<string>();
  for (const [i, o] of opts.entries()) {
    const k = o.text.toLowerCase();
    if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["options", i, "text"], message: "Option text must be unique" });
    seen.add(k);
  }
  const correct = opts.filter((o) => o.isCorrect).length;
  if (v.type === "MCQ_SINGLE" && correct !== 1) ctx.addIssue({ code: "custom", path: ["options"], message: "Single-answer questions need exactly 1 correct option" });
  if (v.type === "MCQ_MULTI" && correct < 1) ctx.addIssue({ code: "custom", path: ["options"], message: "Multiple-select questions need at least 1 correct option" });
}

export const createQuestionBody = z
  .object({
    type: z.enum(QUESTION_TYPES),
    categoryId: objectId,
    difficulty: z.enum(DIFFICULTIES),
    stem: text(3, 10_000),
    defaultMarks: marks,
    explanation: text(0, 5000).optional(),
    rubric: text(0, 5000).optional(),
    maxWords: z.number().int().min(1).max(5000).optional(),
    options: z.array(optionInput).max(10).default([]),
    tags: tags.default([]),
  })
  .strict()
  .superRefine(validateQuestionShape);

export const updateQuestionBody = z
  .object({
    categoryId: objectId.optional(),
    difficulty: z.enum(DIFFICULTIES).optional(),
    stem: text(3, 10_000).optional(),
    defaultMarks: marks.optional(),
    explanation: text(0, 5000).optional(),
    rubric: text(0, 5000).optional(),
    maxWords: z.number().int().min(1).max(5000).nullable().optional(),
    options: z.array(optionInput).max(10).optional(),
    tags: tags.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const listQuestionsQuery = z
  .object({
    ...paginationQuery,
    categoryId: objectId.optional(),
    difficulty: z.enum(DIFFICULTIES).optional(),
    type: z.enum(QUESTION_TYPES).optional(),
    tags: z.string().max(200).optional(),
    archived: boolQuery.optional(),
    ownerId: objectId.optional(),
  })
  .strict();

export type CreateQuestionInput = z.infer<typeof createQuestionBody>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionBody>;
export type ListQuestionsQuery = z.infer<typeof listQuestionsQuery>;
