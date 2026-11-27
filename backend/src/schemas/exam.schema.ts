import { z } from "zod";
import { DIFFICULTIES, ENROLLMENT_STATUSES, EXAM_STATUSES, FAIRNESS_MODES, INTEGRITY_LEVELS, MULTI_SCHEMES } from "../config/constants";
import { paginationQuery } from "../lib/pagination";
import { email, isoDate, marks, objectId, text } from "../utils/validators";

const resiliencePolicy = z
  .object({
    mode: z.enum(["NONE", "GRACE", "REVIEWED"]),
    maxCreditSeconds: z.number().int().min(0).max(3600),
    maxCredits: z.number().int().min(0).max(20),
    extendHardCap: z.boolean(),
  })
  .partial()
  .strict();

const examFields = {
  title: text(3, 200),
  instructions: text(0, 10_000),
  startsAt: isoDate,
  endsAt: isoDate,
  durationMinutes: z.number().int().min(1).max(600),
  totalMarks: marks,
  passMarks: z.number().min(0).max(10_000),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  negativeMarking: z.number().min(0).max(1),
  multiSelectScheme: z.enum(MULTI_SCHEMES),
  maxAttempts: z.number().int().min(1).max(10),
  lateEntryMinutes: z.number().int().min(0).max(600),
  hardWindow: z.boolean(),
  flexibleStart: z.boolean(),
  fairnessMode: z.enum(FAIRNESS_MODES),
  fairnessEpsilon: z.number().min(0.005).max(0.2),
  showAnswersAfterPublish: z.boolean(),
  integrityLevel: z.enum(INTEGRITY_LEVELS),
  disputeWindowHours: z.number().int().min(1).max(720),
  resiliencePolicy,
  coExaminerIds: z.array(objectId).max(5),
};

export function validateExamTiming(v: { startsAt?: Date; endsAt?: Date; durationMinutes?: number; flexibleStart?: boolean; passMarks?: number | null; totalMarks?: number }, ctx: z.RefinementCtx) {
  if (v.startsAt && v.endsAt) {
    if (v.endsAt <= v.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "endsAt must be after startsAt" });
    else if (v.durationMinutes && !v.flexibleStart && v.durationMinutes * 60_000 > v.endsAt.getTime() - v.startsAt.getTime()) {
      ctx.addIssue({ code: "custom", path: ["durationMinutes"], message: "Duration cannot exceed the exam window unless flexibleStart is enabled" });
    }
  }
  if (v.passMarks != null && v.totalMarks != null && v.passMarks > v.totalMarks) {
    ctx.addIssue({ code: "custom", path: ["passMarks"], message: "passMarks cannot exceed totalMarks" });
  }
}

export const createExamBody = z
  .object({
    ...examFields,
    instructions: examFields.instructions.default(""),
    passMarks: examFields.passMarks.optional(),
    shuffleQuestions: examFields.shuffleQuestions.default(false),
    shuffleOptions: examFields.shuffleOptions.default(false),
    negativeMarking: examFields.negativeMarking.default(0),
    multiSelectScheme: examFields.multiSelectScheme.default("ALL_OR_NOTHING"),
    maxAttempts: examFields.maxAttempts.default(1),
    lateEntryMinutes: examFields.lateEntryMinutes.default(15),
    hardWindow: examFields.hardWindow.default(true),
    flexibleStart: examFields.flexibleStart.default(false),
    fairnessMode: examFields.fairnessMode.default("OFF"),
    fairnessEpsilon: examFields.fairnessEpsilon.default(0.03),
    showAnswersAfterPublish: examFields.showAnswersAfterPublish.default(false),
    integrityLevel: examFields.integrityLevel.default("STANDARD"),
    disputeWindowHours: examFields.disputeWindowHours.default(72),
    resiliencePolicy: resiliencePolicy.optional(),
    coExaminerIds: examFields.coExaminerIds.default([]),
  })
  .strict()
  .superRefine(validateExamTiming);

export const updateExamBody = z
  .object(Object.fromEntries(Object.entries(examFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])) as { [K in keyof typeof examFields]: z.ZodOptional<(typeof examFields)[K]> })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

const slot = z
  .object({ categoryId: objectId, difficulty: z.enum(DIFFICULTIES), count: z.number().int().min(1).max(500), marksEach: marks })
  .strict();

export const setQuestionsBody = z
  .object({
    questions: z
      .array(z.object({ questionId: objectId, marks: marks.optional(), section: text(0, 60).optional() }).strict())
      .max(500),
    blueprint: z.array(slot).max(50).optional(),
    syncTotalMarks: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = v.questions.map((q) => q.questionId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["questions"], message: "Duplicate questions are not allowed" });
  });

export const autoSelectBody = z
  .object({
    slots: z
      .array(slot.extend({ poolSize: z.number().int().min(1).max(500).optional() }).strict())
      .min(1)
      .max(50),
    replace: z.boolean().default(true),
    syncTotalMarks: z.boolean().default(true),
  })
  .strict();

export const listExamsQuery = z
  .object({ ...paginationQuery, status: z.enum(EXAM_STATUSES).optional(), ownerId: objectId.optional() })
  .strict();

export const publishBody = z.object({ acknowledgeWarnings: z.boolean().default(false) }).strict();

export const enrollBody = z
  .object({ candidateIds: z.array(objectId).max(500).optional(), emails: z.array(email).max(500).optional() })
  .strict()
  .refine((v) => (v.candidateIds?.length ?? 0) + (v.emails?.length ?? 0) > 0, "Provide candidateIds or emails");

export const patchEnrollmentBody = z
  .object({
    extraTimeMinutes: z.number().int().min(0).max(600).optional(),
    extraAttempts: z.number().int().min(0).max(5).optional(),
    status: z.enum(ENROLLMENT_STATUSES.filter((s) => s !== "WITHDRAWN") as unknown as [string, ...string[]]).optional(),
    reason: text(3, 500),
  })
  .strict()
  .refine((v) => v.extraTimeMinutes !== undefined || v.extraAttempts !== undefined || v.status !== undefined, "Nothing to update");

export const examCandidateParams = z.object({ id: objectId, cid: objectId }).strict();

export const announcementBody = z.object({ message: text(1, 500), priority: z.enum(["NORMAL", "URGENT"]).default("NORMAL") }).strict();
export const announcementsQuery = z.object({ since: z.coerce.number().int().min(0).default(0) }).strict();
export const listEnrollmentsQuery = z.object({ ...paginationQuery, status: z.enum(ENROLLMENT_STATUSES).optional() }).strict();

export type CreateExamInput = z.infer<typeof createExamBody>;
export type UpdateExamInput = z.infer<typeof updateExamBody>;
export type SetQuestionsInput = z.infer<typeof setQuestionsBody>;
export type AutoSelectInput = z.infer<typeof autoSelectBody>;
export type ListExamsQuery = z.infer<typeof listExamsQuery>;
