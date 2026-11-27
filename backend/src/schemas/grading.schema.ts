import { z } from "zod";
import { KEY_POLICIES } from "../config/constants";
import { paginationQuery } from "../lib/pagination";
import { boolQuery, objectId, text } from "../utils/validators";

export const gradingQueueQuery = z
  .object({
    ...paginationQuery,
    status: z.enum(["UNGRADED", "GRADED", "ALL"]).default("UNGRADED"),
    questionId: objectId.optional(),
    /** Blind grading hides candidate identity (default on). */
    blind: boolQuery.optional(),
  })
  .strict();

const quarter = (n: number) => Math.abs(n * 4 - Math.round(n * 4)) < 1e-9;

export const gradeBody = z
  .object({
    score: z.number().min(0).max(10_000).refine(quarter, "Score must be in steps of 0.25"),
    feedback: z.string().trim().max(2000).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();

export const regradeBody = z.object({ questionId: objectId.optional(), reason: text(5, 1000) }).strict();

export const keyOverrideBody = z
  .object({
    policy: z.enum(KEY_POLICIES),
    correctOptionIds: z.array(objectId).max(10).default([]),
    reason: text(5, 1000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.policy === "ALTERNATE_KEY" && v.correctOptionIds.length === 0) ctx.addIssue({ code: "custom", path: ["correctOptionIds"], message: "ALTERNATE_KEY requires at least one correct option" });
  });

export const keyOverrideParams = z.object({ id: objectId, questionId: objectId }).strict();

export const moderationBody = z
  .object({
    mode: z.enum(["NONE", "ADDITIVE"]),
    offset: z.number().min(-1000).max(1000).refine(quarter, "Offset must be in steps of 0.25").default(0),
    note: text(5, 500),
  })
  .strict();

export const publishResultsBody = z
  .object({ candidateIds: z.array(objectId).max(5000).optional(), force: z.boolean().default(false), acknowledge: z.boolean().default(false) })
  .strict();
export const unpublishResultsBody = z.object({ candidateIds: z.array(objectId).max(5000).optional(), note: text(5, 500) }).strict();

export const resultsListQuery = z
  .object({ ...paginationQuery, sort: z.string().max(40).optional(), published: boolQuery.optional() })
  .strict();

export const attemptIdParams = z.object({ attemptId: objectId }).strict();
