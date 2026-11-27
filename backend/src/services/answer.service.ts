import { createHash } from "node:crypto";
import { MAX_ANSWER_TEXT } from "../config/constants";
import { isDuplicateKey } from "../lib/db";
import { autosaveCounter } from "../lib/metrics";
import { normalizeText } from "../lib/sanitize";
import { remainingSeconds, secondsBetween } from "../lib/time";
import { Answer, AnswerEvent, Attempt, AttemptQuestion } from "../models/attempt.model";
import type { AuthUser } from "../types/express";
import { AppError, notFound, unprocessable } from "../utils/errors";
import { liveAttempt, loadOwnAttempt } from "./attempt.service";

export interface AnswerInput {
  attemptQuestionId?: string;
  selectedOptionIds: string[];
  textAnswer?: string | null;
  clientSeq: number;
  clientSavedAt?: Date;
}

interface AqLite {
  _id: any;
  type: "MCQ_SINGLE" | "MCQ_MULTI" | "WRITTEN";
  maxWords?: number | null;
  questionId: any;
  options: Array<{ _id: any }>;
}

const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

function validateAnswer(aq: AqLite, input: AnswerInput) {
  const issues: { field: string; issue: string }[] = [];
  const selected = [...new Set(input.selectedOptionIds)];
  let text: string | null = null;

  if (aq.type === "WRITTEN") {
    if (selected.length) issues.push({ field: "selectedOptionIds", issue: "Written questions take a text answer" });
    text = input.textAnswer == null ? null : normalizeText(input.textAnswer);
    if (text !== null) {
      if (text.length > MAX_ANSWER_TEXT) issues.push({ field: "textAnswer", issue: `Must be at most ${MAX_ANSWER_TEXT} characters` });
      if (aq.maxWords && countWords(text) > aq.maxWords) issues.push({ field: "textAnswer", issue: `Exceeds the ${aq.maxWords}-word limit` });
    }
  } else {
    if (input.textAnswer) issues.push({ field: "textAnswer", issue: "Objective questions do not take text" });
    const valid = new Set(aq.options.map((o) => String(o._id)));
    if (selected.some((id) => !valid.has(id))) issues.push({ field: "selectedOptionIds", issue: "Contains an option that does not belong to this question" });
    if (aq.type === "MCQ_SINGLE" && selected.length > 1) issues.push({ field: "selectedOptionIds", issue: "Only one option may be selected" });
  }
  if (issues.length) throw unprocessable("Invalid answer", "VALIDATION_FAILED", issues);
  return { selected, text };
}

async function journal(attemptId: unknown, aqId: unknown, input: Partial<AnswerInput>, accepted: boolean, rejectReason?: string) {
  await AnswerEvent.create({
    attemptId,
    attemptQuestionId: aqId,
    clientSeq: input.clientSeq,
    payload: {
      selectedOptionIds: input.selectedOptionIds,
      textLength: input.textAnswer?.length ?? 0,
      textHash: input.textAnswer ? createHash("sha256").update(input.textAnswer).digest("hex").slice(0, 16) : undefined,
      clientSavedAt: input.clientSavedAt,
    },
    accepted,
    rejectReason,
  }).catch(() => undefined);
}

async function upsertAnswer(attempt: { _id: any; examId: any; candidateId: any; isSandbox: boolean }, aq: AqLite, v: { selected: string[]; text: string | null }, clientSeq: number, now: Date, timeSpent: number | undefined) {
  try {
    await Answer.findOneAndUpdate(
      { attemptQuestionId: aq._id, clientSeq: { $lt: clientSeq } },
      {
        $set: { selectedOptionIds: v.selected, textAnswer: v.text, clientSeq, savedAt: now, timeSpentSeconds: timeSpent },
        $setOnInsert: { attemptId: attempt._id, examId: attempt.examId, candidateId: attempt.candidateId, questionId: aq.questionId, isSandbox: attempt.isSandbox, type: aq.type, isMarkedForReview: false, gradeStatus: "UNGRADED", finalScore: null },
      },
      { upsert: true },
    );
    return "SAVED" as const;
  } catch (err) {
    if (isDuplicateKey(err)) return "STALE_IGNORED" as const; // an equal or newer save already exists
    throw err;
  }
}

const timeSpentFor = (prev: { lastAnswerAt?: Date | null; startedAt: Date }, now: Date) => Math.min(86_400, Math.max(0, secondsBetween(now, prev.lastAnswerAt ?? prev.startedAt)));

export async function saveAnswer(user: AuthUser, attemptId: string, aqId: string, input: AnswerInput, epoch?: number) {
  const now = new Date();
  let attempt;
  try {
    attempt = await liveAttempt(user, attemptId, now, { epoch });
  } catch (err) {
    const code = (err as AppError).code;
    if (code === "ATTEMPT_EXPIRED" || code === "ATTEMPT_NOT_ACTIVE") {
      autosaveCounter.inc({ outcome: "rejected" });
      await journal(attemptId, aqId, { ...input, attemptQuestionId: aqId }, false, code);
    }
    throw err;
  }

  const aq = await AttemptQuestion.findOne({ _id: aqId, attemptId }).select("type maxWords questionId options._id").lean();
  if (!aq) throw notFound("Question");
  const v = validateAnswer(aq as never, input);
  const timeSpent = timeSpentFor(attempt, now);
  const [outcome] = await Promise.all([
    upsertAnswer(attempt, aq as never, v, input.clientSeq, now, timeSpent),
    Attempt.updateOne({ _id: attemptId }, { $set: { lastAnswerAt: now } }),
  ]);
  autosaveCounter.inc({ outcome: outcome === "SAVED" ? "saved" : "stale" });
  await journal(attemptId, aqId, input, outcome === "SAVED", outcome === "SAVED" ? undefined : "STALE");
  return {
    saved: outcome === "SAVED",
    status: outcome,
    serverTime: now.toISOString(),
    savedAt: outcome === "SAVED" ? now.toISOString() : null,
    remainingSeconds: remainingSeconds(attempt.deadlineAt, now),
    deadlineAt: attempt.deadlineAt,
    clientSeq: input.clientSeq,
  };
}

/** Flushes a queue of offline answers, applied in `clientSeq` order; stale items are ignored, invalid ones reported. */
export async function saveBatch(user: AuthUser, attemptId: string, items: Required<Pick<AnswerInput, "attemptQuestionId">>[] & AnswerInput[], epoch?: number) {
  const now = new Date();
  const ordered = [...items].sort((a, b) => a.clientSeq - b.clientSeq);
  const offline = ordered.some((i) => i.clientSavedAt && now.getTime() - i.clientSavedAt.getTime() > 5_000);
  let attempt;
  try {
    attempt = await liveAttempt(user, attemptId, now, { epoch, hadOfflineWrites: offline });
  } catch (err) {
    const code = (err as AppError).code;
    if (code === "ATTEMPT_EXPIRED" || code === "ATTEMPT_NOT_ACTIVE") {
      await Promise.all(ordered.map((i) => journal(attemptId, i.attemptQuestionId, i, false, code)));
      autosaveCounter.inc({ outcome: "rejected" }, ordered.length);
    }
    throw err;
  }

  const aqs = await AttemptQuestion.find({ attemptId, _id: { $in: ordered.map((i) => i.attemptQuestionId) } }).select("type maxWords questionId options._id").lean();
  const aqMap = new Map(aqs.map((a) => [String(a._id), a]));
  const results: Array<{ attemptQuestionId: string; clientSeq: number; status: "SAVED" | "STALE_IGNORED" | "REJECTED"; error?: string }> = [];
  let timeSpent = timeSpentFor(attempt, now);
  for (const item of ordered) {
    const aq = aqMap.get(item.attemptQuestionId);
    if (!aq) {
      results.push({ attemptQuestionId: item.attemptQuestionId, clientSeq: item.clientSeq, status: "REJECTED", error: "Unknown question" });
      continue;
    }
    try {
      const v = validateAnswer(aq as never, item);
      const status = await upsertAnswer(attempt, aq as never, v, item.clientSeq, now, timeSpent);
      timeSpent = 0;
      results.push({ attemptQuestionId: item.attemptQuestionId, clientSeq: item.clientSeq, status });
      await journal(attemptId, item.attemptQuestionId, item, status === "SAVED", status === "SAVED" ? undefined : "STALE");
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      results.push({ attemptQuestionId: item.attemptQuestionId, clientSeq: item.clientSeq, status: "REJECTED", error: err.details.map((d) => d.issue).join("; ") || err.message });
      await journal(attemptId, item.attemptQuestionId, item, false, "INVALID");
    }
  }
  await Attempt.updateOne({ _id: attemptId }, { $set: { lastAnswerAt: now } });
  autosaveCounter.inc({ outcome: "saved" }, results.filter((r) => r.status === "SAVED").length);
  return { results, saved: results.filter((r) => r.status === "SAVED").length, serverTime: now.toISOString(), remainingSeconds: remainingSeconds(attempt.deadlineAt, now), deadlineAt: attempt.deadlineAt };
}


