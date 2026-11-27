import { z } from "zod";
import { DISPUTE_STATUSES, DISPUTE_TYPES, KEY_POLICIES } from "../config/constants";
import { paginationQuery } from "../lib/pagination";
import { objectId, text } from "../utils/validators";

const quarter = (n: number) => Math.abs(n * 4 - Math.round(n * 4)) < 1e-9;

export const createDisputeBody = z
  .object({
    type: z.enum(DISPUTE_TYPES),
    reason: text(20, 2000),
    attemptQuestionId: objectId.optional(),
    interruptionId: objectId.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.type === "GRADING_ERROR" || v.type === "AMBIGUOUS_QUESTION") && !v.attemptQuestionId) ctx.addIssue({ code: "custom", path: ["attemptQuestionId"], message: "Select the question you are disputing" });
  });

export const commentBody = z.object({ note: text(2, 2000) }).strict();

export const resolveBody = z
  .object({
    outcome: z.enum(["ACCEPT", "REJECT", "PARTIAL"]),
    note: text(5, 2000),
    newScore: z.number().min(0).max(10_000).refine(quarter, "Score must be in steps of 0.25").optional(),
    /** AMBIGUOUS_QUESTION: how to treat the question for everyone. */
    policy: z.enum(KEY_POLICIES).optional(),
    correctOptionIds: z.array(objectId).max(10).optional(),
    /** TECHNICAL_INCIDENT: grant the candidate one more attempt. */
    allowReattempt: z.boolean().optional(),
  })
  .strict();

export const disputeListQuery = z.object({ ...paginationQuery, status: z.enum(DISPUTE_STATUSES).optional() }).strict();
export const disputeAttemptParams = z.object({ attemptId: objectId }).strict();
