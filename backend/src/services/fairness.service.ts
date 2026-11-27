import { FINALIZED_STATUSES } from "../config/constants";
import { round2 } from "../lib/scoring";
import { Attempt } from "../models/attempt.model";
import { Result } from "../models/result.model";
import { loadManagedExam } from "../policies/exam.policy";
import type { AuthUser } from "../types/express";

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function pearson(xs: number[], ys: number[]) {
  if (xs.length < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    dx += (xs[i]! - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  }
  return dx && dy ? round2(num / Math.sqrt(dx * dy)) : null;
}

/** Explains how evenly difficulty was spread across candidates' papers (advisory; never changes scores). */
export async function fairnessReport(user: AuthUser, examId: string) {
  const exam = await loadManagedExam(user, examId, "read");
  const attempts = await Attempt.find({ examId: exam._id, isSandbox: false, status: { $in: FINALIZED_STATUSES }, paperDifficultyIndex: { $ne: null } })
    .select("_id paperDifficultyIndex totalScore markingSnapshot")
    .lean();
  const idx = attempts.map((a) => a.paperDifficultyIndex as number);
  const pct = attempts.map((a) => (a.markingSnapshot.totalMarks ? (a.totalScore / a.markingSnapshot.totalMarks) * 100 : 0));
  const m = mean(idx);
  const eps = exam.fairnessEpsilon ?? 0.03;
  const within = idx.filter((i) => Math.abs(i - m) <= eps).length;
  const sorted = attempts.map((a, i) => ({ i: idx[i]!, p: pct[i]! })).sort((a, b) => a.i - b.i);
  const third = Math.max(1, Math.floor(sorted.length / 3));
  const bucket = (rows: Array<{ p: number }>) => (rows.length ? round2(mean(rows.map((r) => r.p))) : null);
  const results = await Result.countDocuments({ examId: exam._id });
  return {
    examId,
    mode: exam.fairnessMode,
    epsilon: eps,
    attempts: attempts.length,
    resultsRecorded: results,
    difficultyIndex: {
      mean: round2(m),
      min: idx.length ? round2(Math.min(...idx)) : null,
      max: idx.length ? round2(Math.max(...idx)) : null,
      spread: idx.length ? round2(Math.max(...idx) - Math.min(...idx)) : null,
      withinEpsilon: idx.length ? round2(within / idx.length) : null,
    },
    balanced: idx.length ? within / idx.length >= 0.95 : null,
    scoreVsDifficultyCorrelation: pearson(idx, pct),
    meanPercentageByDifficultyBand: {
      easierPapers: bucket(sorted.slice(0, third)),
      middlePapers: bucket(sorted.slice(third, sorted.length - third)),
      harderPapers: bucket(sorted.slice(sorted.length - third)),
    },
    note:
      exam.fairnessMode === "BALANCED"
        ? "Papers were generated from the same blueprint and re-drawn until their difficulty index fell within epsilon of the target."
        : "Fairness balancing was off for this exam; the figures are provided for information.",
  };
}
