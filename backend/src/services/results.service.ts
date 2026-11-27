import type { ClientSession } from "mongoose";
import { env } from "../config/env";
import { generateVerificationCode, hmacSha256, normalizeCode, formatCode, safeEqual } from "../lib/crypto";
import { clamp, gradeLabel, round2 } from "../lib/scoring";
import { pageMeta, pageParams, buildSort } from "../lib/pagination";
import { maskName } from "../lib/sanitize";
import { withTransaction } from "../lib/db";
import { Answer, Attempt, AttemptQuestion } from "../models/attempt.model";
import { Exam } from "../models/exam.model";
import { Result, VerificationCode } from "../models/result.model";
import { User } from "../models/user.model";
import { loadManagedExam } from "../policies/exam.policy";
import type { AuthUser } from "../types/express";
import { AppError, conflict, notFound } from "../utils/errors";
import { enqueue } from "../queues/jobs.queue";
import { audit } from "./audit.service";
import { notify } from "./notification.service";
import { computeStatus } from "../lib/exam-status";

interface AttemptForResult {
  _id: unknown;
  examId: unknown;
  candidateId: unknown;
  totalScore: number;
  gradingState: string;
  markingSnapshot: { totalMarks: number; passMarks?: number | null };
}

const signCode = (code: string, attemptId: unknown, score: number, issuedAt: Date) =>
  hmacSha256(env.REPORT_HMAC_SECRET, `${code}|${attemptId}|${score}|${issuedAt.toISOString()}`);

async function issueVerification(result: { _id: unknown; attemptId: unknown; examId: unknown; candidateId: unknown; totalScore: number; percentage: number; currentCode?: string | null }, session?: ClientSession) {
  const code = generateVerificationCode();
  const issuedAt = new Date();
  await VerificationCode.create(
    [{ code, resultId: result._id, attemptId: result.attemptId, examId: result.examId, candidateId: result.candidateId, score: result.totalScore, percentage: result.percentage, issuedAt, hash: signCode(code, result.attemptId, result.totalScore, issuedAt) }],
    { session },
  );
  if (result.currentCode) {
    await VerificationCode.updateOne({ code: result.currentCode }, { $set: { status: "SUPERSEDED", supersededByCode: code } }, { session });
  }
  return code;
}

/** Creates or refreshes the Result row for an attempt; supersedes the verification code if a published score changes. */
export async function syncResult(attempt: AttemptForResult, session?: ClientSession) {
  const exam = await Exam.findById(attempt.examId).select("moderation").session(session ?? null).lean();
  const offset = exam?.moderation?.mode === "ADDITIVE" ? (exam.moderation.offset ?? 0) : 0;
  const totalMarks = attempt.markingSnapshot.totalMarks;
  const passMarks = attempt.markingSnapshot.passMarks ?? null;
  const total = round2(clamp(attempt.totalScore + offset, 0, totalMarks));
  const percentage = totalMarks ? round2((total / totalMarks) * 100) : 0;
  const fields = {
    rawScore: attempt.totalScore,
    moderationOffset: offset,
    totalScore: total,
    totalMarks,
    percentage,
    passed: passMarks === null ? undefined : total >= passMarks,
    gradeLabel: gradeLabel(percentage),
    gradingComplete: attempt.gradingState === "COMPLETE",
  };

  const existing = await Result.findOne({ attemptId: attempt._id }).session(session ?? null);
  if (!existing) {
    await Result.create([{ attemptId: attempt._id, examId: attempt.examId, candidateId: attempt.candidateId, ...fields }], { session });
    return;
  }
  const scoreChanged = existing.totalScore !== total;
  const old = existing.totalScore;
  Object.assign(existing, fields);
  if (existing.isPublished && scoreChanged) {
    const code = await issueVerification({ _id: existing._id, attemptId: existing.attemptId, examId: existing.examId, candidateId: existing.candidateId, totalScore: total, percentage, currentCode: existing.currentCode }, session);
    existing.history.push({ at: new Date(), oldScore: old, newScore: total, reason: "SCORE_CHANGED", code } as never);
    existing.currentCode = code;
    void notify(String(existing.candidateId), "result_updated", { examId: String(existing.examId), attemptId: String(existing.attemptId), oldScore: old, newScore: total }).catch(() => undefined);
  }
  await existing.save({ session });
}

/** Competition ranking over each candidate's best fully-graded attempt. */
export async function recomputeRanks(examId: unknown) {
  const results = await Result.find({ examId, gradingComplete: true }).select("candidateId totalScore attemptId").lean();
  const attempts = await Attempt.find({ _id: { $in: results.map((r) => r.attemptId) }, isSandbox: false, status: { $ne: "VOID" } }).select("_id").lean();
  const valid = new Set(attempts.map((a) => String(a._id)));
  const bestByCandidate = new Map<string, (typeof results)[number]>();
  for (const r of results) {
    if (!valid.has(String(r.attemptId))) continue;
    const cur = bestByCandidate.get(String(r.candidateId));
    if (!cur || r.totalScore > cur.totalScore) bestByCandidate.set(String(r.candidateId), r);
  }
  const ranked = [...bestByCandidate.values()].sort((a, b) => b.totalScore - a.totalScore);
  const n = ranked.length;
  const ops: any[] = [{ updateMany: { filter: { examId }, update: { $unset: { rank: 1, percentile: 1 } } } }];
  let lastScore: number | null = null;
  let lastRank = 0;
  ranked.forEach((r, i) => {
    const rank = lastScore !== null && r.totalScore === lastScore ? lastRank : i + 1;
    lastScore = r.totalScore;
    lastRank = rank;
    const below = ranked.filter((x) => x.totalScore < r.totalScore).length;
    ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { rank, percentile: n > 1 ? Math.round((below / n) * 1000) / 10 : 100 } } } });
  });
  await Result.bulkWrite(ops);
}

/** Re-syncs every result of an exam (used after moderation changes). */
export async function resyncExamResults(examId: unknown) {
  const attempts = await Attempt.find({ examId, isSandbox: false, status: { $in: ["SUBMITTED", "AUTO_SUBMITTED", "GRADING", "GRADED"] } }).select("_id examId candidateId totalScore gradingState markingSnapshot").lean();
  for (const a of attempts) await withTransaction((s) => syncResult(a as never, s));
  await recomputeRanks(examId);
}

// ---- examiner views ---------------------------------------------------------------------------

export async function listExamResults(user: AuthUser, examId: string, query: { page?: number; pageSize?: number; sort?: string; published?: boolean }) {
  const exam = await loadManagedExam(user, examId, "read");
  const p = pageParams(query);
  const filter: Record<string, unknown> = { examId: exam._id };
  if (query.published !== undefined) filter.isPublished = query.published;
  const sort = buildSort(query.sort, ["totalScore", "percentage", "rank", "createdAt"], { totalScore: -1 });
  const [rows, total] = await Promise.all([Result.find(filter).sort(sort).skip(p.skip).limit(p.pageSize).lean(), Result.countDocuments(filter)]);
  const [users, attempts] = await Promise.all([
    User.find({ _id: { $in: rows.map((r) => r.candidateId) } }).select("fullName registrationNo email").lean(),
    Attempt.find({ _id: { $in: rows.map((r) => r.attemptId) } }).select("status gradingState submitReason submittedAt startedAt attemptNo paperDifficultyIndex").lean(),
  ]);
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  const aMap = new Map(attempts.map((a) => [String(a._id), a]));
  return {
    rows: rows.map((r) => {
      const u = uMap.get(String(r.candidateId));
      const a = aMap.get(String(r.attemptId));
      return {
        resultId: String(r._id),
        attemptId: String(r.attemptId),
        candidateId: String(r.candidateId),
        fullName: u?.fullName,
        registrationNo: u?.registrationNo ?? null,
        attemptNo: a?.attemptNo,
        attemptStatus: a?.status,
        gradingState: a?.gradingState,
        submitReason: a?.submitReason ?? null,
        submittedAt: a?.submittedAt ?? null,
        paperDifficultyIndex: a?.paperDifficultyIndex ?? null,
        rawScore: r.rawScore,
        moderationOffset: r.moderationOffset,
        totalScore: r.totalScore,
        totalMarks: r.totalMarks,
        percentage: r.percentage,
        passed: r.passed ?? null,
        gradeLabel: r.gradeLabel,
        rank: r.rank ?? null,
        percentile: r.percentile ?? null,
        isPublished: r.isPublished,
        publishedAt: r.publishedAt ?? null,
        verificationCode: r.currentCode ? formatCode(r.currentCode) : null,
      };
    }),
    meta: pageMeta(p, total),
  };
}

export async function publishResults(user: AuthUser, examId: string, input: { candidateIds?: string[]; force: boolean; acknowledge: boolean }) {
  const exam = await loadManagedExam(user, examId, "write");
  if (exam.status === "DRAFT") throw conflict("Exam is not published", "EXAM_NOT_PUBLISHED");
  if (await Attempt.exists({ examId: exam._id, isSandbox: false, status: "IN_PROGRESS" })) {
    throw conflict("Attempts are still in progress", "EXAM_HAS_ACTIVE_ATTEMPTS");
  }
  const filter: Record<string, unknown> = { examId: exam._id, isPublished: false };
  if (input.candidateIds?.length) filter.candidateId = { $in: input.candidateIds };

  const candidates = await Result.find(filter).lean();
  const attempts = await Attempt.find({ _id: { $in: candidates.map((c) => c.attemptId) }, isSandbox: false, status: { $nin: ["VOID", "IN_PROGRESS"] } }).select("_id gradingState").lean();
  const okIds = new Set(attempts.map((a) => String(a._id)));
  const pending = attempts.filter((a) => a.gradingState !== "COMPLETE").length;
  if (pending > 0 && !(input.force && input.acknowledge)) {
    throw new AppError(409, "GRADING_INCOMPLETE", `${pending} attempt(s) still have ungraded answers. Finish grading, or publish with force and acknowledge.`, { details: [{ field: "pendingAttempts", issue: String(pending) }] });
  }
  const targets = candidates.filter((c) => okIds.has(String(c.attemptId)));
  if (!targets.length) throw conflict("No unpublished results to publish", "NOTHING_TO_PUBLISH");

  await recomputeRanks(exam._id);
  const now = new Date();
  await withTransaction(async (session) => {
    for (const r of targets) {
      const fresh = await Result.findById(r._id).session(session);
      if (!fresh || fresh.isPublished) continue;
      const code = await issueVerification({ _id: fresh._id, attemptId: fresh.attemptId, examId: fresh.examId, candidateId: fresh.candidateId, totalScore: fresh.totalScore, percentage: fresh.percentage }, session);
      fresh.isPublished = true;
      fresh.publishedAt = now;
      fresh.currentCode = code;
      await fresh.save({ session });
    }
    await Exam.updateOne({ _id: exam._id }, { $set: { resultsPublishedAt: now } }, { session });
  });
  await Promise.all(targets.map((r) => notify(String(r.candidateId), "result_published", { examId: String(exam._id), title: exam.title, attemptId: String(r.attemptId) }).catch(() => undefined)));
  await enqueue("analytics.refresh", { examId: String(exam._id) });
  await audit({ action: "results.publish", entityType: "exam", entityId: exam._id, meta: { count: targets.length, forced: pending > 0 } });
  return { published: targets.length, pendingGrading: pending };
}

export async function unpublishResults(user: AuthUser, examId: string, input: { candidateIds?: string[]; note: string }) {
  const exam = await loadManagedExam(user, examId, "write");
  const filter: Record<string, unknown> = { examId: exam._id, isPublished: true };
  if (input.candidateIds?.length) filter.candidateId = { $in: input.candidateIds };
  const rows = await Result.find(filter).lean();
  if (!rows.length) throw conflict("No published results match", "NOTHING_TO_PUBLISH");
  await Result.updateMany({ _id: { $in: rows.map((r) => r._id) } }, { $set: { isPublished: false }, $unset: { publishedAt: 1 } });
  await VerificationCode.updateMany({ code: { $in: rows.map((r) => r.currentCode).filter(Boolean) as string[] } }, { $set: { status: "REVOKED" } });
  await Result.updateMany({ _id: { $in: rows.map((r) => r._id) } }, { $unset: { currentCode: 1 } });
  const viewed = rows.filter((r) => r.viewedAt).length;
  await audit({ action: "results.unpublish", entityType: "exam", entityId: exam._id, meta: { count: rows.length, alreadyViewed: viewed, note: input.note } });
  return { unpublished: rows.length, alreadyViewedByCandidates: viewed };
}

// ---- candidate views --------------------------------------------------------------------------

export async function listMyResults(userId: string) {
  const rows = await Result.find({ candidateId: userId, isPublished: true }).sort({ publishedAt: -1 }).lean();
  const exams = await Exam.find({ _id: { $in: rows.map((r) => r.examId) } }).select("title disputeWindowHours passMarks").lean();
  const eMap = new Map(exams.map((e) => [String(e._id), e]));
  return rows.map((r) => ({
    attemptId: String(r.attemptId),
    examId: String(r.examId),
    examTitle: eMap.get(String(r.examId))?.title,
    totalScore: r.totalScore,
    totalMarks: r.totalMarks,
    percentage: r.percentage,
    gradeLabel: r.gradeLabel,
    passed: r.passed ?? null,
    rank: r.rank ?? null,
    publishedAt: r.publishedAt,
  }));
}

export async function getMyResult(userId: string, attemptId: string) {
  const result = await Result.findOne({ attemptId, candidateId: userId, isPublished: true });
  if (!result) throw new AppError(404, "RESULTS_NOT_PUBLISHED", "No published result found for this attempt");
  const exam = await Exam.findById(result.examId).lean();
  if (!exam) throw notFound("Exam");
  if (!result.viewedAt) {
    result.viewedAt = new Date();
    await result.save();
  }
  const [aqs, answers] = await Promise.all([AttemptQuestion.find({ attemptId }).sort({ position: 1 }).lean(), Answer.find({ attemptId }).lean()]);
  const aMap = new Map(answers.map((a) => [String(a.attemptQuestionId), a]));
  const reveal = exam.showAnswersAfterPublish;
  const disputeOpenUntil = new Date((result.publishedAt ?? new Date()).getTime() + exam.disputeWindowHours * 3_600_000);
  return {
    attemptId,
    examId: String(exam._id),
    examTitle: exam.title,
    totalScore: result.totalScore,
    rawScore: result.rawScore,
    moderationOffset: result.moderationOffset,
    moderationNote: result.moderationOffset ? (exam.moderation?.note ?? "A transparent moderation adjustment was applied to all candidates.") : null,
    totalMarks: result.totalMarks,
    percentage: result.percentage,
    gradeLabel: result.gradeLabel,
    passed: result.passed ?? null,
    rank: result.rank ?? null,
    percentile: result.percentile ?? null,
    publishedAt: result.publishedAt,
    verificationCode: result.currentCode ? formatCode(result.currentCode) : null,
    verifyUrl: result.currentCode ? `${env.PUBLIC_VERIFY_BASE_URL}/${result.currentCode}` : null,
    dispute: { windowHours: exam.disputeWindowHours, openUntil: disputeOpenUntil, open: Date.now() <= disputeOpenUntil.getTime() },
    history: result.history,
    questions: aqs.map((aq) => {
      const a = aMap.get(String(aq._id));
      const selected = new Set((a?.selectedOptionIds ?? []).map(String));
      return {
        attemptQuestionId: String(aq._id),
        position: aq.position,
        type: aq.type,
        stem: aq.stem,
        marks: aq.marks,
        score: a?.finalScore ?? 0,
        answered: Boolean(selected.size || a?.textAnswer?.trim()),
        textAnswer: aq.type === "WRITTEN" ? (a?.textAnswer ?? null) : undefined,
        feedback: a?.feedback ?? null,
        options: aq.type === "WRITTEN" ? undefined : aq.options.map((o) => ({ label: o.label, text: o.text, selected: selected.has(String(o._id)), ...(reveal ? { isCorrect: o.isCorrect } : {}) })),
        explanation: reveal ? (aq.explanation ?? null) : undefined,
        rubric: undefined,
      };
    }),
    examStatus: computeStatus(exam, new Date()),
  };
}

// ---- public verification ----------------------------------------------------------------------

export async function verifyCode(rawCode: string) {
  const code = normalizeCode(rawCode);
  const v = await VerificationCode.findOne({ code }).lean();
  if (!v) return { valid: false, status: "UNKNOWN" as const };
  const [exam, user] = await Promise.all([Exam.findById(v.examId).select("title").lean(), User.findById(v.candidateId).select("fullName").lean()]);
  const hashOk = safeEqual(v.hash, signCode(v.code, v.attemptId, v.score, v.issuedAt));
  return {
    valid: v.status === "VALID" && hashOk,
    status: hashOk ? v.status : ("REVOKED" as const),
    examTitle: exam?.title ?? null,
    institution: env.INSTITUTION_NAME,
    issuedAt: v.issuedAt,
    maskedName: user ? maskName(user.fullName) : null,
    percentage: v.percentage,
    supersededBy: v.supersededByCode ?? null,
  };
}

export { issueVerification, signCode };
