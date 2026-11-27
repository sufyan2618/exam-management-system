import { BASE_DIFFICULTY_SCORE, FINALIZED_STATUSES } from "../config/constants";
import { pageMeta, pageParams } from "../lib/pagination";
import { redis } from "../lib/redis";
import { clamp, median, round2 } from "../lib/scoring";
import { Answer, Attempt } from "../models/attempt.model";
import { Enrollment, Exam } from "../models/exam.model";
import { Question } from "../models/question.model";
import { Result } from "../models/result.model";
import { User } from "../models/user.model";
import { loadManagedExam } from "../policies/exam.policy";
import type { AuthUser } from "../types/express";
import { notFound } from "../utils/errors";

const TTL_SECONDS = 60;
const MIN_FOR_CALIBRATION = 30;

async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    /* cache is best-effort */
  }
  const value = await compute();
  await redis.set(key, JSON.stringify(value), "EX", TTL_SECONDS).catch(() => undefined);
  return value;
}

const finalizedAttempts = (examId: unknown) =>
  Attempt.find({ examId, isSandbox: false, status: { $in: FINALIZED_STATUSES } })
    .select("_id candidateId totalScore startedAt submittedAt submitReason markingSnapshot paperDifficultyIndex")
    .lean();

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

// ---- exam ----------------------------------------------------------------------------------------------

export async function examAnalytics(user: AuthUser, examId: string) {
  const exam = await loadManagedExam(user, examId, "read");
  return cached(`analytics:exam:${examId}`, async () => {
    const [attempts, enrolled] = await Promise.all([finalizedAttempts(exam._id), Enrollment.countDocuments({ examId: exam._id, status: "ENROLLED" })]);
    const totalMarks = attempts[0]?.markingSnapshot.totalMarks ?? 0;
    const pct = attempts.map((a) => (a.markingSnapshot.totalMarks ? (a.totalScore / a.markingSnapshot.totalMarks) * 100 : 0));
    const passMarks = exam.passMarks ?? null;
    const bins = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9.99, count: 0 }));
    for (const p of pct) bins[Math.min(9, Math.max(0, Math.floor(p / 10)))]!.count++;
    const candidates = new Set(attempts.map((a) => String(a.candidateId)));
    const durations = attempts.filter((a) => a.submittedAt).map((a) => (a.submittedAt!.getTime() - a.startedAt.getTime()) / 60_000);
    return {
      examId,
      title: exam.title,
      enrolled,
      participants: candidates.size,
      participationRate: enrolled ? round2((candidates.size / enrolled) * 100) : 0,
      attempts: attempts.length,
      autoSubmitted: attempts.filter((a) => a.submitReason === "TIMEOUT").length,
      totalMarks,
      score: {
        mean: round2(mean(attempts.map((a) => a.totalScore))),
        median: round2(median(attempts.map((a) => a.totalScore))),
        stdDev: round2(stdev(attempts.map((a) => a.totalScore))),
        min: attempts.length ? Math.min(...attempts.map((a) => a.totalScore)) : 0,
        max: attempts.length ? Math.max(...attempts.map((a) => a.totalScore)) : 0,
        meanPercentage: round2(mean(pct)),
      },
      passRate: passMarks === null || !attempts.length ? null : round2((attempts.filter((a) => a.totalScore >= passMarks).length / attempts.length) * 100),
      averageDurationMinutes: round2(mean(durations)),
      distribution: bins,
      generatedAt: new Date().toISOString(),
    };
  });
}

// ---- questions -----------------------------------------------------------------------------------------

async function questionStats(examId: unknown) {
  const attempts = await finalizedAttempts(examId);
  const ids = attempts.map((a) => a._id);
  if (!ids.length) return { n: 0, rows: [] as Array<Record<string, any>> };
  const sorted = [...attempts].sort((a, b) => b.totalScore - a.totalScore);
  const k = Math.max(1, Math.floor(sorted.length * 0.27));
  const upper = sorted.slice(0, k).map((a) => a._id);
  const lower = sorted.slice(-k).map((a) => a._id);

  const base = Answer.aggregate([
    { $match: { attemptId: { $in: ids } } },
    { $lookup: { from: "attemptquestions", localField: "attemptQuestionId", foreignField: "_id", as: "aq", pipeline: [{ $project: { marks: 1, type: 1 } }] } },
    { $unwind: "$aq" },
    {
      $group: {
        _id: "$questionId",
        type: { $first: "$aq.type" },
        marks: { $first: "$aq.marks" },
        n: { $sum: 1 },
        full: { $sum: { $cond: [{ $gte: [{ $ifNull: ["$finalScore", 0] }, { $subtract: ["$aq.marks", 0.001] }] }, 1, 0] } },
        sumScore: { $sum: { $ifNull: ["$finalScore", 0] } },
        answered: { $sum: { $cond: [{ $or: [{ $gt: [{ $size: "$selectedOptionIds" }, 0] }, { $gt: [{ $strLenCP: { $ifNull: ["$textAnswer", ""] } }, 0] }] }, 1, 0] } },
        avgTime: { $avg: "$timeSpentSeconds" },
      },
    },
  ]);
  const groupFull = (set: unknown[]) =>
    Answer.aggregate([
      { $match: { attemptId: { $in: set } } },
      { $lookup: { from: "attemptquestions", localField: "attemptQuestionId", foreignField: "_id", as: "aq", pipeline: [{ $project: { marks: 1 } }] } },
      { $unwind: "$aq" },
      { $group: { _id: "$questionId", n: { $sum: 1 }, full: { $sum: { $cond: [{ $gte: [{ $ifNull: ["$finalScore", 0] }, { $subtract: ["$aq.marks", 0.001] }] }, 1, 0] } } } },
    ]);
  const picks = Answer.aggregate([
    { $match: { attemptId: { $in: ids }, type: { $ne: "WRITTEN" } } },
    { $unwind: "$selectedOptionIds" },
    { $group: { _id: { q: "$questionId", o: "$selectedOptionIds" }, n: { $sum: 1 } } },
  ]);
  const [rows, up, low, optionPicks] = await Promise.all([base, groupFull(upper), groupFull(lower), picks]);
  const questions = await Question.find({ _id: { $in: rows.map((r: { _id: unknown }) => r._id) } }).select("stem difficulty difficultyScore options categoryId").lean();
  const qMap = new Map(questions.map((q) => [String(q._id), q]));
  const upMap = new Map(up.map((r: { _id: unknown; n: number; full: number }) => [String(r._id), r]));
  const lowMap = new Map(low.map((r: { _id: unknown; n: number; full: number }) => [String(r._id), r]));
  const pickMap = new Map<string, Map<string, number>>();
  for (const p of optionPicks as Array<{ _id: { q: unknown; o: unknown }; n: number }>) {
    const m = pickMap.get(String(p._id.q)) ?? new Map<string, number>();
    m.set(String(p._id.o), p.n);
    pickMap.set(String(p._id.q), m);
  }
  return {
    n: attempts.length,
    rows: rows.map((r: { _id: unknown; type: string; marks: number; n: number; full: number; sumScore: number; answered: number; avgTime: number | null }) => {
      const q = qMap.get(String(r._id));
      const u = upMap.get(String(r._id));
      const l = lowMap.get(String(r._id));
      const discrimination = u && l && u.n && l.n ? round2(u.full / u.n - l.full / l.n) : null;
      const pValue = r.n ? round2(r.full / r.n) : 0;
      const picksFor = pickMap.get(String(r._id));
      const flags: string[] = [];
      if (r.n >= MIN_FOR_CALIBRATION) {
        if (pValue < 0.2) flags.push("TOO_HARD");
        if (pValue > 0.9) flags.push("TOO_EASY");
        if (discrimination !== null && discrimination < 0) flags.push("NEGATIVE_DISCRIMINATION");
        else if (discrimination !== null && discrimination < 0.1) flags.push("LOW_DISCRIMINATION");
      }
      return {
        questionId: String(r._id),
        stem: q?.stem?.slice(0, 160),
        type: r.type,
        marks: r.marks,
        difficulty: q?.difficulty,
        difficultyScore: q?.difficultyScore,
        attempts: r.n,
        answered: r.answered,
        omitRate: r.n ? round2(1 - r.answered / r.n) : 0,
        pValue,
        averageScore: r.n ? round2(r.sumScore / r.n) : 0,
        discrimination,
        averageTimeSeconds: r.avgTime ? Math.round(r.avgTime) : null,
        flags,
        distractors:
          r.type === "WRITTEN"
            ? undefined
            : (q?.options ?? []).map((o) => ({ optionId: String(o._id), text: o.text, isCorrect: o.isCorrect, picked: picksFor?.get(String(o._id)) ?? 0, pickRate: r.n ? round2((picksFor?.get(String(o._id)) ?? 0) / r.n) : 0 })),
      };
    }),
  };
}

export async function questionAnalyticsForExam(user: AuthUser, examId: string) {
  const exam = await loadManagedExam(user, examId, "read");
  return cached(`analytics:questions:${examId}`, async () => {
    const { n, rows } = await questionStats(exam._id);
    return { examId, attempts: n, questions: rows, minSampleForFlags: MIN_FOR_CALIBRATION, generatedAt: new Date().toISOString() };
  });
}

// ---- candidates ----------------------------------------------------------------------------------------

export async function candidateAnalytics(user: AuthUser, examId: string, query: { page?: number; pageSize?: number; q?: string }) {
  const exam = await loadManagedExam(user, examId, "read");
  const p = pageParams(query);
  const results = await Result.find({ examId: exam._id }).sort({ totalScore: -1 }).lean();
  const users = await User.find({ _id: { $in: results.map((r) => r.candidateId) } }).select("fullName registrationNo").lean();
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  const attempts = await Attempt.find({ _id: { $in: results.map((r) => r.attemptId) } }).select("startedAt submittedAt submitReason attemptNo paperDifficultyIndex").lean();
  const aMap = new Map(attempts.map((a) => [String(a._id), a]));
  let rows = results.map((r) => {
    const a = aMap.get(String(r.attemptId));
    const u = uMap.get(String(r.candidateId));
    return {
      candidateId: String(r.candidateId),
      fullName: u?.fullName,
      registrationNo: u?.registrationNo ?? null,
      attemptId: String(r.attemptId),
      attemptNo: a?.attemptNo,
      totalScore: r.totalScore,
      percentage: r.percentage,
      rank: r.rank ?? null,
      percentile: r.percentile ?? null,
      passed: r.passed ?? null,
      durationMinutes: a?.submittedAt ? round2((a.submittedAt.getTime() - a.startedAt.getTime()) / 60_000) : null,
      submitReason: a?.submitReason ?? null,
      paperDifficultyIndex: a?.paperDifficultyIndex ?? null,
    };
  });
  if (query.q) {
    const needle = query.q.toLowerCase();
    rows = rows.filter((r) => `${r.fullName} ${r.registrationNo}`.toLowerCase().includes(needle));
  }
  return { rows: rows.slice(p.skip, p.skip + p.pageSize), meta: pageMeta(p, rows.length) };
}

// ---- single question across exams ------------------------------------------------------------------------

export async function questionBankAnalytics(user: AuthUser, questionId: string) {
  const q = await Question.findById(questionId).lean();
  if (!q || (user.role !== "ADMIN" && String(q.ownerId) !== user.userId)) throw notFound("Question");
  const versions = await Question.find({ $or: [{ rootId: q.rootId ?? q._id }, { _id: q.rootId ?? q._id }] }).select("_id version").lean();
  const rows = await Answer.aggregate([
    { $match: { questionId: { $in: versions.map((v) => v._id) }, isSandbox: false, gradeStatus: { $ne: "UNGRADED" } } },
    { $lookup: { from: "attemptquestions", localField: "attemptQuestionId", foreignField: "_id", as: "aq", pipeline: [{ $project: { marks: 1 } }] } },
    { $unwind: "$aq" },
    { $group: { _id: "$questionId", n: { $sum: 1 }, full: { $sum: { $cond: [{ $gte: [{ $ifNull: ["$finalScore", 0] }, { $subtract: ["$aq.marks", 0.001] }] }, 1, 0] } }, exams: { $addToSet: "$examId" } } },
  ]);
  const total = rows.reduce((a: number, r: { n: number }) => a + r.n, 0);
  const full = rows.reduce((a: number, r: { full: number }) => a + r.full, 0);
  const examIds = new Set(rows.flatMap((r: { exams: unknown[] }) => r.exams.map(String)));
  return {
    questionId,
    difficulty: q.difficulty,
    difficultyScore: q.difficultyScore,
    calibrationCount: q.calibrationCount,
    ambiguityFlag: q.ambiguityFlag,
    usage: { exams: examIds.size, responses: total },
    pValue: total ? round2(full / total) : null,
    perVersion: rows.map((r: { _id: unknown; n: number; full: number }) => ({ questionId: String(r._id), version: versions.find((v) => String(v._id) === String(r._id))?.version, responses: r.n, pValue: r.n ? round2(r.full / r.n) : null })),
  };
}

// ---- background refresh --------------------------------------------------------------------------------

/**
 * Recalibrates `difficultyScore` from observed performance: a blend of the declared band and the observed
 * miss rate, weighted by sample size (so the result is deterministic and does not drift across refreshes).
 */
export async function recalibrateExam(examId: unknown) {
  const { rows } = await questionStats(examId);
  let updated = 0;
  for (const r of rows) {
    if (r.attempts < MIN_FOR_CALIBRATION || r.type === "WRITTEN") continue;
    const q = await Question.findById(r.questionId).select("difficulty").lean();
    if (!q) continue;
    const weight = Math.min(1, r.attempts / 200);
    const score = round2(clamp(BASE_DIFFICULTY_SCORE[q.difficulty] * (1 - weight) + (1 - r.pValue) * weight, 0.05, 0.95));
    await Question.updateOne({ _id: r.questionId }, { $set: { difficultyScore: score, calibrationCount: r.attempts, ambiguityFlag: r.flags.includes("NEGATIVE_DISCRIMINATION") } });
    updated++;
  }
  return updated;
}

export async function invalidateAnalytics(examId: string) {
  await redis.del(`analytics:exam:${examId}`, `analytics:questions:${examId}`).catch(() => undefined);
}

export async function refreshAnalytics(examId?: string) {
  const ids = examId ? [examId] : (await Exam.find({ status: { $in: ["ONGOING", "COMPLETED"] }, updatedAt: { $gte: new Date(Date.now() - 2 * 86_400_000) } }).select("_id").limit(50).lean()).map((e) => String(e._id));
  let recalibrated = 0;
  for (const id of ids) {
    await invalidateAnalytics(id);
    recalibrated += await recalibrateExam(id);
  }
  return { exams: ids.length, recalibrated };
}
