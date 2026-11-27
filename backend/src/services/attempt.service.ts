import type { ClientSession } from "mongoose";
import { env } from "../config/env";
import { randomSeed } from "../lib/crypto";
import { isDuplicateKey, withTransaction } from "../lib/db";
import { assertCanEnter } from "../lib/exam-status";
import { sumScores } from "../lib/scoring";
import { computeDeadline, remainingSeconds } from "../lib/time";
import { Answer, Attempt, AttemptQuestion, Scratchpad } from "../models/attempt.model";
import { Announcement, Enrollment, Exam } from "../models/exam.model";
import { Question } from "../models/question.model";
import { scheduleAutoSubmit } from "../queues/jobs.queue";
import type { AuthUser } from "../types/express";
import { AppError, conflict, notFound, unprocessable } from "../utils/errors";
import { audit } from "./audit.service";
import { toAnnouncementDto } from "./enrollment.service";
import { finalizeAttempt, finalizeIfExpired } from "./finalize.service";
import { INTEGRITY_NOTICE, recordServerEvent } from "./integrity.service";
import { buildPaper, type PoolQuestion } from "./paper.service";
import { touchAttempt } from "./resilience.service";
import { purgeSandboxData } from "./exam.service";

type AttemptLean = NonNullable<Awaited<ReturnType<typeof loadOwnAttempt>>>;

// ---- access ---------------------------------------------------------------------------------------

/** Candidates own real attempts; examiners own only their sandbox attempts. Everything else is a 404. */
export async function loadOwnAttempt(user: AuthUser, attemptId: string) {
  const attempt = await Attempt.findOne({ _id: attemptId, candidateId: user.userId, isSandbox: user.role === "EXAMINER" }).lean();
  if (!attempt || (user.role !== "CANDIDATE" && user.role !== "EXAMINER")) throw notFound("Attempt");
  return attempt;
}

/**
 * Marks the attempt as seen (server clock) and returns the pre-update document, atomically verifying it is
 * still IN_PROGRESS. Expired attempts are finalized lazily and rejected with ATTEMPT_EXPIRED.
 */
export async function liveAttempt(user: AuthUser, attemptId: string, now: Date, opts: { ip?: string; epoch?: number; hadOfflineWrites?: boolean } = {}) {
  const prev = await Attempt.findOneAndUpdate(
    { _id: attemptId, candidateId: user.userId, isSandbox: user.role === "EXAMINER", status: "IN_PROGRESS" },
    { $set: { lastSeenAt: now, ...(opts.ip ? { lastIp: opts.ip } : {}) } },
    { new: false },
  ).lean();
  if (!prev) {
    const existing = await loadOwnAttempt(user, attemptId);
    throw new AppError(409, "ATTEMPT_NOT_ACTIVE", "This attempt is no longer active", { details: [{ field: "status", issue: existing.status }] });
  }
  if (opts.epoch !== undefined && opts.epoch < prev.sessionEpoch) {
    throw new AppError(409, "SESSION_SUPERSEDED", "This attempt was resumed on another device; this session is now read-only", { details: [{ field: "sessionEpoch", issue: String(prev.sessionEpoch) }] });
  }
  if (await finalizeIfExpired(prev, now)) throw new AppError(410, "ATTEMPT_EXPIRED", "Time is up; your attempt has been submitted", { details: [{ field: "serverTime", issue: now.toISOString() }] });
  const deadlineAt = await touchAttempt(prev, now, { hadOfflineWrites: opts.hadOfflineWrites });
  return { ...prev, deadlineAt };
}

export const epochFrom = (header: string | undefined) => {
  const n = header === undefined ? NaN : Number(header);
  return Number.isInteger(n) ? n : undefined;
};

// ---- DTOs -----------------------------------------------------------------------------------------

/** Explicit allow-list: never includes isCorrect, explanation, rubric or optionId. */
export async function toCandidateAttemptDto(attempt: AttemptLean, now: Date) {
  const exam = await Exam.findById(attempt.examId).select("title instructions durationMinutes integrityLevel negativeMarking multiSelectScheme").lean();
  const base = {
    id: String(attempt._id),
    examId: String(attempt.examId),
    examTitle: exam?.title,
    instructions: exam?.instructions,
    isSandbox: attempt.isSandbox,
    status: attempt.status,
    attemptNo: attempt.attemptNo,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    serverTime: now.toISOString(),
    remainingSeconds: attempt.status === "IN_PROGRESS" ? remainingSeconds(attempt.deadlineAt, now) : 0,
    sessionEpoch: attempt.sessionEpoch,
    durationMinutes: exam?.durationMinutes,
    totalMarks: attempt.markingSnapshot.totalMarks,
    markingRules: { negativeMarking: attempt.markingSnapshot.negativeMarking, multiSelectScheme: attempt.markingSnapshot.multiSelectScheme },
    integrityNotice: exam && exam.integrityLevel !== "OFF" ? { text: INTEGRITY_NOTICE, acknowledgedAt: attempt.noticeAckAt ?? null } : null,
    graceSeconds: env.GRACE_SECONDS,
  };
  if (attempt.status !== "IN_PROGRESS") {
    return { ...base, submittedAt: attempt.submittedAt ?? null, submitReason: attempt.submitReason ?? null, ...(attempt.isSandbox ? { totalScore: attempt.totalScore } : {}) };
  }
  const [aqs, answers] = await Promise.all([
    AttemptQuestion.find({ attemptId: attempt._id }).sort({ position: 1 }).select("position type stem marks maxWords section options._id options.label options.text").lean(),
    Answer.find({ attemptId: attempt._id }).select("attemptQuestionId selectedOptionIds textAnswer isMarkedForReview clientSeq savedAt").lean(),
  ]);
  return {
    ...base,
    questions: aqs.map((q) => ({
      id: String(q._id),
      position: q.position,
      type: q.type,
      stem: q.stem,
      marks: q.marks,
      maxWords: q.maxWords ?? null,
      section: q.section || null,
      options: q.type === "WRITTEN" ? [] : q.options.map((o) => ({ id: String(o._id), label: o.label, text: o.text })),
    })),
    answers: answers.map((a) => ({
      attemptQuestionId: String(a.attemptQuestionId),
      selectedOptionIds: (a.selectedOptionIds ?? []).map(String),
      textAnswer: a.textAnswer ?? null,
      isMarkedForReview: a.isMarkedForReview,
      clientSeq: a.clientSeq,
      savedAt: a.savedAt ?? null,
    })),
  };
}

// ---- start / resume ---------------------------------------------------------------------------------

async function buildAndCreate(opts: { exam: any; candidateId: string; enrollment: any | null; sandbox: boolean; noticeAck: boolean; ip?: string; now: Date; attemptNo: number }) {
  const { exam, now } = opts;
  const ids = exam.questions.map((q: any) => q.questionId);
  const docs = await Question.find({ _id: { $in: ids } }).lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const pool: PoolQuestion[] = exam.questions
    .map((eq: any) => {
      const d = byId.get(String(eq.questionId));
      return d ? { ...d, marks: eq.marks, position: eq.position, section: eq.section } : null;
    })
    .filter(Boolean) as PoolQuestion[];
  if (!pool.length) throw conflict("This exam has no questions", "EXAM_NOT_READY");

  const seed = randomSeed();
  const paper = buildPaper({
    pool,
    blueprint: exam.blueprint ?? [],
    shuffleQuestions: exam.shuffleQuestions,
    shuffleOptions: exam.shuffleOptions,
    fairnessMode: exam.fairnessMode,
    epsilon: exam.fairnessEpsilon,
    seed,
  });
  if (!paper.items.length) throw conflict("Paper generation produced no questions", "EXAM_NOT_READY");
  const totalMarks = sumScores(paper.items.map((i) => i.marks));

  const hardEndsAt = !opts.sandbox && exam.hardWindow ? exam.endsAt : undefined;
  const deadlineAt = computeDeadline({ startedAt: now, durationMinutes: exam.durationMinutes, extraMinutes: opts.enrollment?.extraTimeMinutes ?? 0, hardEndsAt });

  const attempt = await withTransaction(async (session: ClientSession) => {
    const [created] = await Attempt.create(
      [
        {
          enrollmentId: opts.enrollment?._id,
          examId: exam._id,
          candidateId: opts.candidateId,
          attemptNo: opts.attemptNo,
          isSandbox: opts.sandbox,
          startedAt: now,
          deadlineAt,
          hardEndsAt,
          paperSeed: seed,
          paperDifficultyIndex: paper.difficultyIndex,
          markingSnapshot: { multiSelectScheme: exam.multiSelectScheme, negativeMarking: exam.negativeMarking, totalMarks, passMarks: exam.passMarks },
          resilienceSnapshot: exam.resiliencePolicy,
          noticeAckAt: opts.noticeAck ? now : undefined,
          lastSeenAt: now,
          lastIp: opts.ip,
          sessionEpoch: 1,
        },
      ],
      { session },
    );
    await AttemptQuestion.insertMany(
      paper.items.map((it, i) => ({
        attemptId: created!._id,
        examId: exam._id,
        questionId: it.q._id,
        questionVersion: it.q.version,
        position: i,
        type: it.q.type,
        stem: it.q.stem,
        marks: it.marks,
        rubric: it.q.rubric ?? undefined,
        explanation: it.q.explanation ?? undefined,
        maxWords: it.q.maxWords ?? undefined,
        section: it.section,
        difficultyScore: it.q.difficultyScore ?? undefined,
        options: it.options,
      })),
      { session },
    );
    return created!;
  });
  await scheduleAutoSubmit(String(attempt._id), deadlineAt).catch(() => undefined);
  return attempt;
}

async function resume(attempt: { _id: unknown; examId: unknown; lastSeenAt?: Date | null; lastIp?: string | null }, ip: string | undefined, now: Date) {
  const concurrent = attempt.lastSeenAt && now.getTime() - attempt.lastSeenAt.getTime() < 30_000;
  const updated = await Attempt.findOneAndUpdate({ _id: attempt._id, status: "IN_PROGRESS" }, { $inc: { sessionEpoch: 1 }, $set: { lastIp: ip, lastSeenAt: now } }, { new: true }).lean();
  if (!updated) return null;
  if (concurrent) await recordServerEvent(updated, "MULTI_SESSION", { epoch: updated.sessionEpoch }, now);
  if (attempt.lastIp && ip && attempt.lastIp !== ip) await recordServerEvent(updated, "IP_CHANGE", {}, now);
  return updated;
}

export async function startAttempt(user: AuthUser, examId: string, input: { acknowledgeNotice?: boolean }, ip?: string) {
  const now = new Date();
  const exam = await Exam.findById(examId).lean();
  if (!exam || exam.status === "DRAFT") throw notFound("Exam");
  const enrollment = await Enrollment.findOne({ examId, candidateId: user.userId }).lean();

  const findActive = () => (enrollment ? Attempt.findOne({ enrollmentId: enrollment._id, status: "IN_PROGRESS", isSandbox: false }).lean() : null);
  let active = await findActive();
  if (active && (await finalizeIfExpired(active, now))) active = null;
  if (active) {
    const resumed = await resume(active, ip, now);
    if (resumed) return { attempt: resumed, resumed: true };
  }

  const attemptsUsed = enrollment ? await Attempt.countDocuments({ enrollmentId: enrollment._id, isSandbox: false, status: { $ne: "VOID" } }) : 0;
  assertCanEnter(exam as never, enrollment, attemptsUsed, now);
  if (exam.integrityLevel !== "OFF" && !input.acknowledgeNotice) {
    throw unprocessable("You must acknowledge the integrity notice before starting", "NOTICE_REQUIRED", [{ field: "acknowledgeNotice", issue: INTEGRITY_NOTICE }]);
  }

  try {
    const attempt = await buildAndCreate({ exam, candidateId: user.userId, enrollment, sandbox: false, noticeAck: Boolean(input.acknowledgeNotice), ip, now, attemptNo: attemptsUsed + 1 });
    return { attempt: attempt.toObject(), resumed: false };
  } catch (err) {
    if (isDuplicateKey(err)) {
      // concurrent start: return the attempt that won the race
      const winner = await findActive();
      if (winner) {
        const resumed = await resume(winner, ip, now);
        if (resumed) return { attempt: resumed, resumed: true };
      }
      throw conflict("Another start request is in progress", "ATTEMPT_ALREADY_ACTIVE");
    }
    throw err;
  }
}

export async function startSandboxAttempt(user: AuthUser, examId: string, ip?: string) {
  const now = new Date();
  const exam = await Exam.findById(examId).lean();
  if (!exam || user.role !== "EXAMINER" || (String(exam.ownerId) !== user.userId && !(exam.coExaminerIds ?? []).some((c) => String(c) === user.userId))) throw notFound("Exam");
  if (exam.status === "ARCHIVED") throw conflict("Exam is archived", "EXAM_WINDOW_CLOSED");
  const findActive = () => Attempt.findOne({ examId, candidateId: user.userId, isSandbox: true, status: "IN_PROGRESS" }).lean();
  const active = await findActive();
  if (active && !(await finalizeIfExpired(active, now))) {
    const resumed = await resume(active, ip, now);
    if (resumed) return { attempt: resumed, resumed: true };
  }
  try {
    const attempt = await buildAndCreate({ exam, candidateId: user.userId, enrollment: null, sandbox: true, noticeAck: true, ip, now, attemptNo: 0 });
    return { attempt: attempt.toObject(), resumed: false };
  } catch (err) {
    if (isDuplicateKey(err)) {
      const winner = await findActive();
      if (winner) return { attempt: winner, resumed: true };
    }
    throw err;
  }
}

/** Discards the examiner's sandbox attempts so the preview can start fresh. */
export async function resetSandbox(user: AuthUser, examId: string) {
  const exam = await Exam.findById(examId).select("ownerId coExaminerIds").lean();
  if (!exam || user.role !== "EXAMINER" || (String(exam.ownerId) !== user.userId && !(exam.coExaminerIds ?? []).some((c) => String(c) === user.userId))) throw notFound("Exam");
  const removed = await purgeSandboxData({ examId, candidateId: user.userId });
  return { removed };
}

// ---- read / progress / submit ---------------------------------------------------------------------

export async function getAttempt(user: AuthUser, attemptId: string, ip?: string) {
  const now = new Date();
  let attempt = await loadOwnAttempt(user, attemptId);
  if (attempt.status === "IN_PROGRESS") {
    if (await finalizeIfExpired(attempt, now)) attempt = await loadOwnAttempt(user, attemptId);
    else {
      const live = await liveAttempt(user, attemptId, now, { ip });
      attempt = { ...attempt, deadlineAt: live.deadlineAt };
    }
  }
  return toCandidateAttemptDto(attempt, now);
}

export async function attemptProgress(user: AuthUser, attemptId: string) {
  const now = new Date();
  const attempt = await loadOwnAttempt(user, attemptId);
  const [aqs, answers] = await Promise.all([
    AttemptQuestion.find({ attemptId }).sort({ position: 1 }).select("position").lean(),
    Answer.find({ attemptId }).select("attemptQuestionId selectedOptionIds textAnswer isMarkedForReview").lean(),
  ]);
  const aMap = new Map(answers.map((a) => [String(a.attemptQuestionId), a]));
  const items = aqs.map((q) => {
    const a = aMap.get(String(q._id));
    const answered = Boolean(a && (a.selectedOptionIds?.length || a.textAnswer?.trim()));
    const marked = Boolean(a?.isMarkedForReview);
    return { attemptQuestionId: String(q._id), position: q.position, state: answered && marked ? "ANSWERED_MARKED" : answered ? "ANSWERED" : marked ? "MARKED" : "UNANSWERED" };
  });
  return {
    total: items.length,
    answered: items.filter((i) => i.state.startsWith("ANSWERED")).length,
    unanswered: items.filter((i) => i.state === "UNANSWERED" || i.state === "MARKED").length,
    marked: items.filter((i) => i.state.endsWith("MARKED")).length,
    items,
    serverTime: now.toISOString(),
    remainingSeconds: attempt.status === "IN_PROGRESS" ? remainingSeconds(attempt.deadlineAt, now) : 0,
    status: attempt.status,
  };
}

export async function setReviewFlag(user: AuthUser, attemptId: string, input: { attemptQuestionId: string; marked: boolean }, epoch?: number) {
  const now = new Date();
  const attempt = await liveAttempt(user, attemptId, now, { epoch });
  const aq = await AttemptQuestion.findOne({ _id: input.attemptQuestionId, attemptId }).select("questionId type").lean();
  if (!aq) throw notFound("Question");
  await Answer.updateOne(
    { attemptQuestionId: aq._id },
    {
      $set: { isMarkedForReview: input.marked },
      $setOnInsert: { attemptId: attempt._id, examId: attempt.examId, candidateId: attempt.candidateId, questionId: aq.questionId, isSandbox: attempt.isSandbox, type: aq.type, clientSeq: 0, selectedOptionIds: [] },
    },
    { upsert: true },
  );
  return { attemptQuestionId: input.attemptQuestionId, marked: input.marked, serverTime: now.toISOString(), remainingSeconds: remainingSeconds(attempt.deadlineAt, now) };
}

export async function submitAttempt(user: AuthUser, attemptId: string, epoch?: number) {
  const now = new Date();
  const attempt = await loadOwnAttempt(user, attemptId);
  if (attempt.status === "IN_PROGRESS") {
    if (epoch !== undefined && epoch < attempt.sessionEpoch) throw new AppError(409, "SESSION_SUPERSEDED", "This session is read-only");
    const late = now.getTime() > attempt.deadlineAt.getTime() + env.GRACE_SECONDS * 1000;
    await finalizeAttempt(attemptId, late ? "TIMEOUT" : "MANUAL");
  }
  const final = await loadOwnAttempt(user, attemptId);
  return {
    attemptId,
    status: final.status,
    submittedAt: final.submittedAt ?? null,
    submitReason: final.submitReason ?? null,
    alreadySubmitted: attempt.status !== "IN_PROGRESS",
    serverTime: now.toISOString(),
    ...(final.isSandbox ? { totalScore: final.totalScore, totalMarks: final.markingSnapshot.totalMarks } : {}),
  };
}

export async function heartbeat(user: AuthUser, attemptId: string, input: { cursor?: number }, ip?: string, epoch?: number) {
  const now = new Date();
  const attempt = await loadOwnAttempt(user, attemptId);
  const active = attempt.status === "IN_PROGRESS" && !(await finalizeIfExpired(attempt, now));
  let deadlineAt = attempt.deadlineAt;
  let status = attempt.status;
  if (active) {
    const live = await liveAttempt(user, attemptId, now, { ip, epoch });
    deadlineAt = live.deadlineAt;
  } else if (attempt.status === "IN_PROGRESS") {
    status = (await loadOwnAttempt(user, attemptId)).status;
  }
  const fresh = await Attempt.findById(attemptId).select("sessionEpoch creditedSeconds").lean();
  const announcements = input.cursor !== undefined ? (await Announcement.find({ examId: attempt.examId, seq: { $gt: input.cursor } }).sort({ seq: 1 }).limit(50).lean()).map(toAnnouncementDto) : [];
  const exam = await Exam.findById(attempt.examId).select("announcementSeq").lean();
  return {
    active: active || false,
    status,
    serverTime: now.toISOString(),
    deadlineAt,
    remainingSeconds: active ? remainingSeconds(deadlineAt, now) : 0,
    sessionEpoch: fresh?.sessionEpoch ?? attempt.sessionEpoch,
    creditedSeconds: fresh?.creditedSeconds ?? 0,
    announcements,
    announcementCursor: exam?.announcementSeq ?? 0,
  };
}

export async function acknowledgeNotice(user: AuthUser, attemptId: string) {
  const res = await Attempt.updateOne({ _id: attemptId, candidateId: user.userId }, { $set: { noticeAckAt: new Date() } });
  if (!res.matchedCount) throw notFound("Attempt");
  return { acknowledged: true };
}

// ---- examiner time controls ---------------------------------------------------------------------------

export async function extendTime(examiner: AuthUser, attemptId: string, input: { minutes: number; reason: string }) {
  const { loadAttemptForExaminer } = await import("./monitoring.service");
  const attempt = await loadAttemptForExaminer(examiner, attemptId, true);
  if (attempt.status !== "IN_PROGRESS") throw conflict("Attempt is not active", "ATTEMPT_NOT_ACTIVE");
  const next = new Date(attempt.deadlineAt.getTime() + input.minutes * 60_000);
  const updated = await Attempt.findOneAndUpdate({ _id: attemptId, status: "IN_PROGRESS" }, { $set: { deadlineAt: next }, $inc: { extraSeconds: input.minutes * 60 } }, { new: true }).lean();
  if (!updated) throw conflict("Attempt is not active", "ATTEMPT_NOT_ACTIVE");
  await scheduleAutoSubmit(attemptId, next).catch(() => undefined);
  const { publish } = await import("../lib/sse");
  await publish(`attempt:${attemptId}`, { type: "time_extended", data: { seconds: input.minutes * 60, deadlineAt: next.toISOString(), reason: "EXAMINER" } });
  await audit({ action: "attempt.extend_time", entityType: "attempt", entityId: attemptId, before: { deadlineAt: attempt.deadlineAt }, after: { deadlineAt: next }, meta: { minutes: input.minutes, reason: input.reason } });
  return { attemptId, deadlineAt: next, extendedMinutes: input.minutes };
}

export async function forceSubmit(examiner: AuthUser, attemptId: string, input: { reason: string }) {
  const { loadAttemptForExaminer } = await import("./monitoring.service");
  const attempt = await loadAttemptForExaminer(examiner, attemptId, true);
  if (attempt.status !== "IN_PROGRESS") throw conflict("Attempt is not active", "ATTEMPT_NOT_ACTIVE");
  const out = await finalizeAttempt(attemptId, "EXAMINER", { actorId: examiner.userId });
  await audit({ action: "attempt.force_submit_reason", entityType: "attempt", entityId: attemptId, meta: { reason: input.reason } });
  return { attemptId, status: out.attempt.status };
}


