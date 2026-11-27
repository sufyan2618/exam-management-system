import { z } from "zod";
import { CLIENT_EVENT_TYPES, MAX_ANSWER_TEXT } from "../config/constants";
import { boolQuery, objectId, text } from "../utils/validators";

export const startAttemptBody = z.object({ acknowledgeNotice: z.boolean().optional() }).strict();

const answerCore = {
  selectedOptionIds: z.array(objectId).max(10).default([]),
  textAnswer: z.string().max(MAX_ANSWER_TEXT).nullable().optional(),
  clientSeq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  clientSavedAt: z.coerce.date().optional(),
};

export const answerBody = z.object(answerCore).strict();
export const answerParams = z.object({ id: objectId, attemptQuestionId: objectId }).strict();

export const batchBody = z
  .object({ items: z.array(z.object({ attemptQuestionId: objectId, ...answerCore }).strict()).min(1).max(100) })
  .strict();

export const flagBody = z.object({ attemptQuestionId: objectId, marked: z.boolean() }).strict();
export const heartbeatBody = z.object({ cursor: z.number().int().min(0).optional() }).strict();

export const eventsBody = z
  .object({
    events: z
      .array(
        z
          .object({
            type: z.enum(CLIENT_EVENT_TYPES),
            occurredAt: z.coerce.date().optional(),
            meta: z.record(z.union([z.string().max(100), z.number(), z.boolean()])).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export const extendTimeBody = z.object({ minutes: z.number().int().min(1).max(240), reason: text(5, 500) }).strict();
export const forceSubmitBody = z.object({ reason: text(5, 500) }).strict();
export const interruptionParams = z.object({ id: objectId, iid: objectId }).strict();
export const reviewInterruptionBody = z
  .object({ approve: z.boolean(), creditSeconds: z.number().int().min(1).max(3600).optional(), kind: z.enum(["NETWORK", "DEVICE", "POWER", "UNKNOWN"]).optional(), note: text(3, 500) })
  .strict();
export const meExamsQuery = z.object({ bucket: z.enum(["available", "upcoming", "completed"]).optional() }).strict();
export const examIdParams = z.object({ examId: objectId }).strict();
export const reviewEventBody = z.object({ status: z.enum(["REVIEWED", "DISMISSED", "CONFIRMED"]), note: text(3, 1000) }).strict();
export const monitorListQuery = z
  .object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50), status: z.string().max(30).optional(), q: z.string().trim().max(100).optional(), onlyIncidents: boolQuery.optional() })
  .strict();
export const attemptEpochHeader = (v: string | undefined) => (v === undefined ? undefined : Number.isInteger(Number(v)) ? Number(v) : undefined);
