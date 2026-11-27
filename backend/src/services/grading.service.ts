import { z } from "zod";
import { FINALIZED_STATUSES } from "../config/constants";
import { sha256 } from "../lib/crypto";
import { withTransaction } from "../lib/db";
import { publish } from "../lib/sse";
import { pageMeta, pageParams } from "../lib/pagination";
import { round2 } from "../lib/scoring";
import { Answer, Attempt, AttemptQuestion } from "../models/attempt.model";
import { Exam } from "../models/exam.model";
import { GradeRevision } from "../models/result.model";
import { Question } from "../models/question.model";
import { User } from "../models/user.model";
import { isExaminerOf, loadManagedExam } from "../policies/exam.policy";
import type { AuthUser } from "../types/express";
import { conflict, notFound, unprocessable } from "../utils/errors";
import { audit } from "./audit.service";
import { notify } from "./notification.service";
import { gradeAttemptObjective, recomputeAttemptScore } from "./scoring.service";
import { recomputeRanks, resyncExamResults } from "./results.service";
import type { gradeBody, gradingQueueQuery, keyOverrideBody, moderationBody, regradeBody } from "../schemas/grading.schema";

type Input<T extends z.ZodTypeAny> = z.infer<T>;

const alias = (attemptId: unknown, examId: unknown) => `Candidate-${sha256(`${examId}:${attemptId}`).slice(0, 6).toUpperCase()}`;

async function finalizedAttemptIds(examId: unknown) {
  return Attempt.distinct("_id", { examId, isSandbox: false, status: { $in: FINALIZED_STATUSES } });
}

// ---- queue --------------------------------------------------------------------------------------------

export async function gradingQueue(user: AuthUser, examId: string, query: Input<typeof gradingQueueQuery>) {
  const exam = await loadManagedExam(user, examId, "read");
  const p = pageParams(query);
  const blind = query.blind ?? true;
  const filter: Record<string, unknown> = { examId: exam._id, type: "WRITTEN", isSandbox: false, attemptId: { $in: await finalizedAttemptIds(exam._id) } };
  if (query.status === "UNGRADED") {
    filter.gradeStatus = "UNGRADED";
    filter.textAnswer = { $nin: [null, ""] };
  } else if (query.status === "GRADED") filter.gradeStatus = { $in: ["MANUAL", "REGRADED"] };
  if (query.questionId) filter.questionId = query.questionId;
  const [rows, total] = await Promise.all([Answer.find(filter).sort({ updatedAt: 1, _id: 1 }).skip(p.skip).limit(p.pageSize).lean(), Answer.countDocuments(filter)]);
  const aqs = await AttemptQuestion.find({ _id: { $in: rows.map((r) => r.attemptQuestionId) } }).lean();
  const aqMap = new Map(aqs.map((a) => [String(a._id), a]));
  const candidates = blind ? new Map() : new Map((await User.find({ _id: { $in: rows.map((r) => r.candidateId) } }).select("fullName registrationNo").lean()).map((u) => [String(u._id), u]));
  return {
    rows: rows.map((r) => {
      const aq = aqMap.get(String(r.attemptQuestionId));
      const u = candidates.get(String(r.candidateId));
      return {
        answerId: String(r._id),
        attemptId: String(r.attemptId),
        questionId: String(r.questionId),
        position: aq?.position,
        stem: aq?.stem,
        rubric: aq?.rubric ?? null,
        maxMarks: aq?.marks,
        maxWords: aq?.maxWords ?? null,
        textAnswer: r.textAnswer ?? "",
        wordCount: (r.textAnswer ?? "").trim().split(/\s+/).filter(Boolean).length,
        gradeStatus: r.gradeStatus,
        score: r.finalScore,
        feedback: r.feedback ?? null,
        candidate: blind ? { alias: alias(r.attemptId, exam._id), blind: true } : { alias: alias(r.attemptId, exam._id), blind: false, fullName: u?.fullName, registrationNo: u?.registrationNo ?? null },
      };
    }),
    meta: { ...pageMeta(p, total), blind },
  };
}

async function loadAnswerForExaminer(user: AuthUser, answerId: string, write: boolean) {
  const answer = await Answer.findOne({ _id: answerId, isSandbox: false });
  if (!answer) throw notFound("Answer");
  const exam = await Exam.findById(answer.examId).select("ownerId coExaminerIds title").lean();
  if (!exam) throw notFound("Answer");
  const allowed = user.role === "ADMIN" ? !write : user.role === "EXAMINER" && isExaminerOf(exam, user.userId);
  if (!allowed) throw notFound("Answer");
  return { answer, exam };
}

export async function getAnswerForGrading(user: AuthUser, answerId: string, blind = true) {
  const { answer, exam } = await loadAnswerForExaminer(user, answerId, false);
  const [aq, revisions, candidate] = await Promise.all([
    AttemptQuestion.findById(answer.attemptQuestionId).lean(),
    GradeRevision.find({ answerId }).sort({ createdAt: 1 }).lean(),
    blind ? null : User.findById(answer.candidateId).select("fullName registrationNo").lean(),
  ]);
  return {
    answerId,
    attemptId: String(answer.attemptId),
    examId: String(answer.examId),
    type: answer.type,
    stem: aq?.stem,
    rubric: aq?.rubric ?? null,
    maxMarks: aq?.marks,
    options: aq?.options?.map((o) => ({ label: o.label, text: o.text, isCorrect: o.isCorrect, selected: answer.selectedOptionIds.some((s) => String(s) === String(o._id)) })),
    textAnswer: answer.textAnswer ?? "",
    gradeStatus: answer.gradeStatus,
    autoScore: answer.autoScore ?? null,
    score: answer.finalScore,
    feedback: answer.feedback ?? null,
    gradedAt: answer.gradedAt ?? null,
    candidate: blind ? { alias: alias(answer.attemptId, exam._id), blind: true } : { alias: alias(answer.attemptId, exam._id), blind: false, fullName: candidate?.fullName, registrationNo: candidate?.registrationNo ?? null },
    revisions: revisions.map((r) => ({ at: (r as { createdAt?: Date }).createdAt, oldScore: r.oldScore ?? null, newScore: r.newScore, source: r.source, reason: r.reason ?? null })),
  };
}

// ---- manual grading -----------------------------------------------------------------------------------

export async function gradeAnswer(user: AuthUser, answerId: string, input: Input<typeof gradeBody>) {
  const { answer: probe, exam } = await loadAnswerForExaminer(user, answerId, true);
  const out = await withTransaction(async (session) => {
    const answer = await Answer.findById(answerId).session(session);
    const attempt = await Attempt.findById(answer!.attemptId).session(session);
    if (!answer || !attempt || attempt.isSandbox) throw notFound("Answer");
    if (attempt.status === "IN_PROGRESS") throw conflict("The attempt is still in progress", "ATTEMPT_NOT_ACTIVE");
    if (answer.type !== "WRITTEN") throw conflict("Only written answers are graded manually", "CONFLICT");
    const aq = await AttemptQuestion.findById(answer.attemptQuestionId).session(session).lean();
    if (!aq) throw notFound("Question");
    if (input.score > aq.marks) throw unprocessable(`Score cannot exceed ${aq.marks}`, "VALIDATION_FAILED", [{ field: "score", issue: `Maximum is ${aq.marks}` }]);
    const score = round2(input.score);
    const old = answer.finalScore ?? null;
    const wasGraded = answer.gradeStatus === "MANUAL" || answer.gradeStatus === "REGRADED";
    answer.manualScore = score;
    answer.finalScore = score;
    answer.gradeStatus = wasGraded ? "REGRADED" : "MANUAL";
    answer.graderId = user.userId as never;
    answer.gradedAt = new Date();
    if (input.feedback !== undefined) answer.feedback = input.feedback;
    await answer.save({ session });
    if (old !== score) await GradeRevision.create([{ answerId: answer._id, attemptId: attempt._id, examId: answer.examId, oldScore: old, newScore: score, reason: input.reason, source: "MANUAL", changedBy: user.userId }], { session });
    const updated = await recomputeAttemptScore(attempt._id, session);
    return { answer, attempt: updated!, old };
  });
  await audit({ action: "answer.grade", entityType: "answer", entityId: answerId, before: { score: out.old }, after: { score: out.answer.finalScore }, meta: { attemptId: String(out.attempt._id) } });
  if (out.attempt.gradingState === "COMPLETE") {
    await recomputeRanks(probe.examId);
    await publish(`exam:${String(probe.examId)}:monitor`, { type: "grading_complete", data: { attemptId: String(out.attempt._id) } });
    void notify(String(out.attempt.candidateId), "grading_complete", { examId: String(probe.examId), examTitle: exam.title }).catch(() => undefined);
  }
  return { answerId, score: out.answer.finalScore, gradeStatus: out.answer.gradeStatus, attemptTotal: out.attempt.totalScore, gradingState: out.attempt.gradingState };
}

// ---- regrade / key override -----------------------------------------------------------------------------

async function regradeExamAttempts(examId: unknown, source: "REGRADE" | "KEY_OVERRIDE", by: string, reason: string) {
  const ids = await finalizedAttemptIds(examId);
  let attempts = 0;
  let answersChanged = 0;
  for (const id of ids) {
    const r = await withTransaction(async (session) => {
      const g = await gradeAttemptObjective(id, session, { source, changedBy: by, reason });
      await recomputeAttemptScore(id, session);
      return g.changed;
    });
    if (r) {
      attempts++;
      answersChanged += r;
    }
  }
  await recomputeRanks(examId);
  return { attemptsAffected: attempts, answersChanged, attemptsScanned: ids.length };
}

export async function regradeExam(user: AuthUser, examId: string, input: Input<typeof regradeBody>) {
  const exam = await loadManagedExam(user, examId, "write");
  const out = await regradeExamAttempts(exam._id, "REGRADE", user.userId, input.reason);
  await audit({ action: "exam.regrade", entityType: "exam", entityId: exam._id, meta: { ...out, reason: input.reason, questionId: input.questionId } });
  return out;
}

export async function setKeyOverride(user: AuthUser, examId: string, questionId: string, input: Input<typeof keyOverrideBody>) {
  const exam = await loadManagedExam(user, examId, "write");
  if (!exam.questions.some((q) => String(q.questionId) === questionId)) throw notFound("Exam question");
  if (input.policy === "ALTERNATE_KEY") {
    const q = await Question.findById(questionId).select("options type").lean();
    if (!q || q.type === "WRITTEN") throw unprocessable("Alternate keys apply to objective questions only");
    const valid = new Set(q.options.map((o) => String(o._id)));
    const bad = input.correctOptionIds.filter((id) => !valid.has(id));
    if (bad.length) throw unprocessable("Unknown option ids", "VALIDATION_FAILED", bad.map((b) => ({ field: "correctOptionIds", issue: b })));
  }
  const before = exam.keyOverrides.find((k) => String(k.questionId) === questionId);
  await Exam.updateOne({ _id: exam._id }, { $pull: { keyOverrides: { questionId } } });
  await Exam.updateOne(
    { _id: exam._id },
    { $push: { keyOverrides: { questionId, policy: input.policy, correctOptionIds: input.policy === "ALTERNATE_KEY" ? input.correctOptionIds : [], reason: input.reason, appliedBy: user.userId, appliedAt: new Date() } }, $inc: { version: 1 } },
  );
  const out = await regradeExamAttempts(exam._id, "KEY_OVERRIDE", user.userId, `${input.policy}: ${input.reason}`);
  await audit({ action: "exam.key_override", entityType: "exam", entityId: exam._id, before: before ?? null, after: { questionId, policy: input.policy, correctOptionIds: input.correctOptionIds }, meta: { ...out, reason: input.reason } });
  return { questionId, policy: input.policy, ...out };
}

export async function removeKeyOverride(user: AuthUser, examId: string, questionId: string, reason: string) {
  const exam = await loadManagedExam(user, examId, "write");
  const before = exam.keyOverrides.find((k) => String(k.questionId) === questionId);
  if (!before) throw notFound("Key override");
  await Exam.updateOne({ _id: exam._id }, { $pull: { keyOverrides: { questionId } }, $inc: { version: 1 } });
  const out = await regradeExamAttempts(exam._id, "KEY_OVERRIDE", user.userId, `Override removed: ${reason}`);
  await audit({ action: "exam.key_override_remove", entityType: "exam", entityId: exam._id, before, meta: { ...out, reason } });
  return { questionId, removed: true, ...out };
}

export async function listKeyOverrides(user: AuthUser, examId: string) {
  const exam = await loadManagedExam(user, examId, "read");
  return exam.keyOverrides.map((k) => ({ questionId: String(k.questionId), policy: k.policy, correctOptionIds: k.correctOptionIds.map(String), reason: k.reason ?? null, appliedBy: k.appliedBy ? String(k.appliedBy) : null, appliedAt: k.appliedAt }));
}

// ---- status & moderation ----------------------------------------------------------------------------------

export async function gradingStatus(user: AuthUser, examId: string) {
  const exam = await loadManagedExam(user, examId, "read");
  const ids = await finalizedAttemptIds(exam._id);
  const [byState, byQuestion] = await Promise.all([
    Attempt.aggregate([{ $match: { _id: { $in: ids } } }, { $group: { _id: "$gradingState", n: { $sum: 1 } } }]),
    Answer.aggregate([
      { $match: { attemptId: { $in: ids }, type: "WRITTEN", textAnswer: { $nin: [null, ""] } } },
      { $group: { _id: "$questionId", total: { $sum: 1 }, graded: { $sum: { $cond: [{ $in: ["$gradeStatus", ["MANUAL", "REGRADED"]] }, 1, 0] } } } },
    ]),
  ]);
  const totalWritten = byQuestion.reduce((a: number, q: { total: number }) => a + q.total, 0);
  const graded = byQuestion.reduce((a: number, q: { graded: number }) => a + q.graded, 0);
  return {
    examId,
    attempts: Object.fromEntries(byState.map((s: { _id: string; n: number }) => [s._id, s.n])),
    writtenAnswers: { total: totalWritten, graded, remaining: totalWritten - graded },
    perQuestion: byQuestion.map((q: { _id: unknown; total: number; graded: number }) => ({ questionId: String(q._id), total: q.total, graded: q.graded, remaining: q.total - q.graded })),
    complete: totalWritten === graded,
  };
}

export async function setModeration(user: AuthUser, examId: string, input: Input<typeof moderationBody>) {
  const exam = await loadManagedExam(user, examId, "write");
  const before = { ...exam.moderation };
  const offset = input.mode === "NONE" ? 0 : input.offset;
  await Exam.updateOne({ _id: exam._id }, { $set: { moderation: { mode: input.mode, offset, note: input.note, appliedBy: user.userId, appliedAt: new Date() } }, $inc: { version: 1 } });
  await resyncExamResults(exam._id);
  await audit({ action: "exam.moderation", entityType: "exam", entityId: exam._id, before, after: { mode: input.mode, offset }, meta: { note: input.note } });
  return { mode: input.mode, offset, note: input.note };
}
