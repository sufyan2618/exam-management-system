import type { ClientSession } from "mongoose";
import { Answer, Attempt, AttemptQuestion } from "../models/attempt.model";
import { Exam } from "../models/exam.model";
import { GradeRevision } from "../models/result.model";
import { round2, scoreObjective, sumScores } from "../lib/scoring";
import type { MultiScheme } from "../config/constants";
import { syncResult } from "./results.service";

export interface KeyOverrideLite {
  questionId: unknown;
  policy: string;
  correctOptionIds?: unknown[];
}

interface AqLite {
  _id: unknown;
  type: "MCQ_SINGLE" | "MCQ_MULTI" | "WRITTEN";
  marks: number;
  questionId: unknown;
  options: Array<{ _id: unknown; optionId: unknown; isCorrect: boolean }>;
}

/** Scores one objective answer against the frozen snapshot, honouring examiner key overrides. */
export function scoreAttemptQuestion(
  aq: AqLite,
  selected: string[],
  snapshot: { multiSelectScheme: MultiScheme; negativeMarking: number },
  override?: KeyOverrideLite,
) {
  if (override?.policy === "VOID_QUESTION") return round2(aq.marks);
  if (override?.policy === "ACCEPT_ALL_ANSWERS") return selected.length ? round2(aq.marks) : 0;
  let correctIds = aq.options.filter((o) => o.isCorrect).map((o) => String(o._id));
  if (override?.policy === "ALTERNATE_KEY") {
    const alt = new Set((override.correctOptionIds ?? []).map(String));
    correctIds = aq.options.filter((o) => alt.has(String(o.optionId))).map((o) => String(o._id));
  }
  return scoreObjective({
    type: aq.type,
    marks: aq.marks,
    correctIds,
    allOptionIds: aq.options.map((o) => String(o._id)),
    selectedIds: selected,
    scheme: snapshot.multiSelectScheme,
    negativeMarking: snapshot.negativeMarking,
  });
}

export interface GradeOptions {
  source?: "REGRADE" | "KEY_OVERRIDE";
  changedBy?: string;
  reason?: string;
}

/** Auto-grades every objective answer (creating rows for unanswered ones) and zero-scores blank written answers. */
export async function gradeAttemptObjective(attemptId: unknown, session: ClientSession, opts: GradeOptions = {}) {
  const attempt = await Attempt.findById(attemptId).session(session).lean();
  if (!attempt) return { changed: 0 };
  const [exam, aqs, answers] = await Promise.all([
    Exam.findById(attempt.examId).select("keyOverrides").session(session).lean(),
    AttemptQuestion.find({ attemptId }).session(session).lean(),
    Answer.find({ attemptId }).session(session).lean(),
  ]);
  const overrides = new Map((exam?.keyOverrides ?? []).map((k) => [String(k.questionId), k]));
  const byAq = new Map(answers.map((a) => [String(a.attemptQuestionId), a]));
  const now = new Date();
  const ops: any[] = [];
  const revisions: any[] = [];
  let changed = 0;

  for (const aq of aqs) {
    const existing = byAq.get(String(aq._id));
    const base = { attemptId: attempt._id, examId: attempt.examId, candidateId: attempt.candidateId, questionId: aq.questionId, isSandbox: attempt.isSandbox, type: aq.type, clientSeq: 0, selectedOptionIds: [], isMarkedForReview: false };
    let set: Record<string, unknown> | null = null;

    if (aq.type !== "WRITTEN") {
      const score = scoreAttemptQuestion(aq as never, (existing?.selectedOptionIds ?? []).map(String), attempt.markingSnapshot as never, overrides.get(String(aq.questionId)));
      const had = existing && existing.finalScore != null;
      const differs = had && round2(existing!.finalScore as number) !== score;
      set = { autoScore: score, finalScore: score, gradeStatus: differs && opts.source ? "REGRADED" : "AUTO", gradedAt: now };
      if (differs) {
        changed++;
        revisions.push({ answerId: existing!._id, attemptId: attempt._id, examId: attempt.examId, oldScore: existing!.finalScore, newScore: score, reason: opts.reason, source: opts.source ?? "REGRADE", changedBy: opts.changedBy });
      }
      if (!had || differs) {
        /* write */
      } else {
        continue;
      }
    } else {
      const manual = existing && (existing.gradeStatus === "MANUAL" || existing.gradeStatus === "REGRADED");
      if (manual) continue;
      const hasText = Boolean(existing?.textAnswer?.trim());
      if (!hasText) set = { autoScore: 0, finalScore: 0, gradeStatus: "AUTO", gradedAt: now };
      else if (!existing) set = { gradeStatus: "UNGRADED" };
      else continue;
    }
    // $setOnInsert may not overlap $set paths
    const insertOnly = Object.fromEntries(Object.entries(base).filter(([k]) => !(k in set!)));
    ops.push({ updateOne: { filter: { attemptQuestionId: aq._id }, update: { $set: set, $setOnInsert: insertOnly }, upsert: true } });
  }

  if (ops.length) await Answer.bulkWrite(ops, { session });
  if (revisions.length) {
    // answers upserted just now already exist when we have an answerId from `existing`
    await GradeRevision.insertMany(revisions, { session });
  }
  return { changed };
}

/** Derives attempt total, grading state and status from the answer rows, then syncs the result. All in one transaction. */
export async function recomputeAttemptScore(attemptId: unknown, session: ClientSession) {
  const attempt = await Attempt.findById(attemptId).session(session);
  if (!attempt) return null;
  const answers = await Answer.find({ attemptId }).select("finalScore gradeStatus type").session(session).lean();
  const total = sumScores(answers.map((a) => a.finalScore));
  const ungraded = answers.filter((a) => a.gradeStatus === "UNGRADED").length;
  const manual = answers.filter((a) => a.type === "WRITTEN" && (a.gradeStatus === "MANUAL" || a.gradeStatus === "REGRADED")).length;
  const gradingState = ungraded === 0 ? "COMPLETE" : manual > 0 ? "PARTIAL" : "PENDING";

  attempt.totalScore = total;
  attempt.gradingState = gradingState;
  if (attempt.status !== "IN_PROGRESS" && attempt.status !== "VOID") {
    if (gradingState === "COMPLETE") attempt.status = "GRADED";
    else if (gradingState === "PARTIAL") attempt.status = "GRADING";
    else if (attempt.status === "GRADED" || attempt.status === "GRADING") attempt.status = attempt.submitReason === "TIMEOUT" ? "AUTO_SUBMITTED" : "SUBMITTED";
  }
  await attempt.save({ session });
  if (!attempt.isSandbox && attempt.status !== "IN_PROGRESS") await syncResult(attempt.toObject(), session);
  return attempt;
}
