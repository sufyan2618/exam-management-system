import { z } from "zod";
import { DISPUTE_MAX_OPEN, DISPUTE_SLA_HOURS } from "../config/constants";
import { withTransaction } from "../lib/db";
import { pageMeta, pageParams } from "../lib/pagination";
import { round2 } from "../lib/scoring";
import { Answer, Attempt, AttemptQuestion, Interruption } from "../models/attempt.model";
import { Dispute, DisputeEvent } from "../models/dispute.model";
import { Enrollment, Exam } from "../models/exam.model";
import { GradeRevision, Result } from "../models/result.model";
import { User } from "../models/user.model";
import { isExaminerOf, loadManagedExam } from "../policies/exam.policy";
import type { commentBody, createDisputeBody, disputeListQuery, resolveBody } from "../schemas/dispute.schema";
import type { AuthUser } from "../types/express";
import { AppError, conflict, forbidden, notFound, unprocessable } from "../utils/errors";
import { audit } from "./audit.service";
import { setKeyOverride } from "./grading.service";
import { notify } from "./notification.service";
import { recomputeRanks } from "./results.service";
import { recomputeAttemptScore } from "./scoring.service";

type In<T extends z.ZodTypeAny> = z.infer<T>;
const OPEN = ["OPEN", "UNDER_REVIEW", "ESCALATED"];

const event = (disputeId: unknown, user: AuthUser | { userId: string; role: string }, action: string, note?: string, evidence?: unknown) =>
  DisputeEvent.create({ disputeId, actorId: user.userId, actorRole: user.role, action, note, evidence });

export function toDisputeDto(d: Record<string, any>) {
  return {
    id: String(d._id),
    attemptId: String(d.attemptId),
    examId: String(d.examId),
    candidateId: String(d.candidateId),
    type: d.type,
    status: d.status,
    reason: d.reason,
    attemptQuestionId: d.attemptQuestionId ? String(d.attemptQuestionId) : null,
    answerId: d.answerId ? String(d.answerId) : null,
    interruptionId: d.interruptionId ? String(d.interruptionId) : null,
    assigneeId: d.assigneeId ? String(d.assigneeId) : null,
    slaDueAt: d.slaDueAt,
    overdue: OPEN.includes(d.status) && d.slaDueAt < new Date(),
    escalatedAt: d.escalatedAt ?? null,
    awaitingCountersign: Boolean(d.pendingResolution),
    resolution: d.resolution?.outcome
      ? { outcome: d.resolution.outcome, oldScore: d.resolution.oldScore ?? null, newScore: d.resolution.newScore ?? null, note: d.resolution.note ?? null, policy: d.resolution.policy ?? null, allowReattempt: d.resolution.allowReattempt ?? false, resolvedAt: d.resolution.resolvedAt }
      : null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

async function loadDispute(user: AuthUser, id: string) {
  const dispute = await Dispute.findById(id);
  if (!dispute) throw notFound("Dispute");
  const exam = await Exam.findById(dispute.examId).select("ownerId coExaminerIds title").lean();
  if (!exam) throw notFound("Dispute");
  const ok = user.role === "ADMIN" || (user.role === "EXAMINER" && isExaminerOf(exam, user.userId)) || (user.role === "CANDIDATE" && String(dispute.candidateId) === user.userId);
  if (!ok) throw notFound("Dispute");
  return { dispute, exam };
}

// ---- candidate --------------------------------------------------------------------------------------------

export async function createDispute(user: AuthUser, attemptId: string, input: In<typeof createDisputeBody>) {
  const result = await Result.findOne({ attemptId, candidateId: user.userId, isPublished: true }).lean();
  if (!result) throw new AppError(404, "RESULTS_NOT_PUBLISHED", "Disputes can only be raised against published results");
  const exam = await Exam.findById(result.examId).select("ownerId coExaminerIds disputeWindowHours title").lean();
  if (!exam) throw notFound("Exam");
  const now = new Date();
  const closes = new Date((result.publishedAt ?? now).getTime() + exam.disputeWindowHours * 3_600_000);
  if (now > closes) throw new AppError(410, "DISPUTE_WINDOW_CLOSED", "The dispute window for this result has closed", { details: [{ field: "closedAt", issue: closes.toISOString() }] });
  const open = await Dispute.countDocuments({ candidateId: user.userId, examId: result.examId, status: { $in: OPEN } });
  if (open >= DISPUTE_MAX_OPEN) throw conflict(`You can have at most ${DISPUTE_MAX_OPEN} open disputes for an exam`, "DISPUTE_LIMIT_REACHED");

  let answerId: unknown;
  let originalGraderId: unknown;
  if (input.attemptQuestionId) {
    const aq = await AttemptQuestion.findOne({ _id: input.attemptQuestionId, attemptId }).select("_id").lean();
    if (!aq) throw notFound("Question");
    const ans = await Answer.findOne({ attemptQuestionId: aq._id }).select("_id graderId").lean();
    answerId = ans?._id;
    originalGraderId = ans?.graderId;
    const dup = await Dispute.exists({ attemptId, attemptQuestionId: aq._id, type: input.type, status: { $in: OPEN } });
    if (dup) throw conflict("You already have an open dispute for this question", "CONFLICT");
  }
  if (input.interruptionId && !(await Interruption.exists({ _id: input.interruptionId, attemptId }))) throw notFound("Interruption");

  const dispute = await Dispute.create({
    resultId: result._id,
    attemptId,
    examId: result.examId,
    candidateId: user.userId,
    type: input.type,
    reason: input.reason,
    attemptQuestionId: input.attemptQuestionId,
    answerId,
    interruptionId: input.interruptionId,
    assigneeId: exam.ownerId,
    originalGraderId,
    slaDueAt: new Date(now.getTime() + DISPUTE_SLA_HOURS * 3_600_000),
  });
  await event(dispute._id, user, "CREATED", input.reason);
  await audit({ action: "dispute.create", entityType: "dispute", entityId: dispute._id, meta: { type: input.type, attemptId } });
  void notify(String(exam.ownerId), "dispute_opened", { disputeId: String(dispute._id), examId: String(result.examId), examTitle: exam.title, type: input.type }).catch(() => undefined);
  return toDisputeDto(dispute.toObject());
}

export async function listMyDisputes(user: AuthUser) {
  const rows = await Dispute.find({ candidateId: user.userId }).sort({ createdAt: -1 }).limit(100).lean();
  const exams = rows.length ? await Exam.find({ _id: { $in: [...new Set(rows.map((row) => row.examId))] } }).select("title").lean() : [];
  const examTitles = new Map(exams.map((exam) => [String(exam._id), exam.title]));
  return rows.map((row) => ({ ...toDisputeDto(row), examTitle: examTitles.get(String(row.examId)) ?? "Examination unavailable" }));
}

export async function withdrawDispute(user: AuthUser, id: string) {
  const { dispute } = await loadDispute(user, id);
  if (user.role !== "CANDIDATE") throw forbidden();
  if (!["OPEN", "UNDER_REVIEW"].includes(dispute.status)) throw conflict("This dispute can no longer be withdrawn", "CONFLICT");
  dispute.status = "WITHDRAWN";
  dispute.pendingResolution = undefined;
  await dispute.save();
  await event(dispute._id, user, "WITHDRAWN");
  await audit({ action: "dispute.withdraw", entityType: "dispute", entityId: dispute._id });
  return toDisputeDto(dispute.toObject());
}

// ---- shared -----------------------------------------------------------------------------------------------

export async function getDispute(user: AuthUser, id: string) {
  const { dispute, exam } = await loadDispute(user, id);
  const events = await DisputeEvent.find({ disputeId: id }).sort({ createdAt: 1 }).lean();
  const [aq, answer, candidate] = await Promise.all([
    dispute.attemptQuestionId ? AttemptQuestion.findById(dispute.attemptQuestionId).select("position stem marks type").lean() : null,
    dispute.answerId ? Answer.findById(dispute.answerId).select("finalScore gradeStatus feedback").lean() : null,
    user.role === "CANDIDATE" ? null : User.findById(dispute.candidateId).select("fullName registrationNo").lean(),
  ]);
  return {
    ...toDisputeDto(dispute.toObject()),
    examTitle: exam.title,
    question: aq ? { position: aq.position, stem: aq.stem, marks: aq.marks, type: aq.type, currentScore: answer?.finalScore ?? null, gradeStatus: answer?.gradeStatus ?? null, feedback: answer?.feedback ?? null } : null,
    candidate: candidate ? { fullName: candidate.fullName, registrationNo: candidate.registrationNo ?? null } : undefined,
    events: events.map((e) => ({ at: (e as { createdAt?: Date }).createdAt, actorRole: e.actorRole, action: e.action, note: e.note ?? null })),
  };
}

export async function addComment(user: AuthUser, id: string, input: In<typeof commentBody>) {
  const { dispute } = await loadDispute(user, id);
  if (!OPEN.includes(dispute.status)) throw conflict("This dispute is closed", "CONFLICT");
  await event(dispute._id, user, "COMMENT", input.note);
  const notifyId = user.role === "CANDIDATE" ? dispute.assigneeId : dispute.candidateId;
  if (notifyId) void notify(String(notifyId), "dispute_comment", { disputeId: id }).catch(() => undefined);
  return { ok: true };
}

// ---- examiner -----------------------------------------------------------------------------------------------

export async function listExamDisputes(user: AuthUser, examId: string, query: In<typeof disputeListQuery>) {
  const exam = await loadManagedExam(user, examId, "read");
  const p = pageParams(query);
  const filter: Record<string, unknown> = { examId: exam._id };
  if (query.status) filter.status = query.status;
  const [rows, total] = await Promise.all([Dispute.find(filter).sort({ slaDueAt: 1 }).skip(p.skip).limit(p.pageSize).lean(), Dispute.countDocuments(filter)]);
  return { rows: rows.map(toDisputeDto), meta: pageMeta(p, total) };
}

export async function startReview(user: AuthUser, id: string) {
  const { dispute } = await loadDispute(user, id);
  if (user.role !== "EXAMINER") throw forbidden();
  if (dispute.status !== "OPEN") throw conflict("Dispute is not open", "CONFLICT");
  dispute.status = "UNDER_REVIEW";
  dispute.assigneeId = user.userId as never;
  await dispute.save();
  await event(dispute._id, user, "REVIEW_STARTED");
  void notify(String(dispute.candidateId), "dispute_update", { disputeId: id, status: dispute.status }).catch(() => undefined);
  return toDisputeDto(dispute.toObject());
}

export async function escalate(user: AuthUser, id: string, note?: string) {
  const { dispute } = await loadDispute(user, id);
  if (user.role !== "EXAMINER") throw forbidden();
  if (!["OPEN", "UNDER_REVIEW"].includes(dispute.status)) throw conflict("Dispute cannot be escalated", "CONFLICT");
  dispute.status = "ESCALATED";
  dispute.escalatedAt = new Date();
  await dispute.save();
  await event(dispute._id, user, "ESCALATED", note);
  await audit({ action: "dispute.escalate", entityType: "dispute", entityId: id });
  void notify(String(dispute.candidateId), "dispute_update", { disputeId: id, status: dispute.status }).catch(() => undefined);
  return toDisputeDto(dispute.toObject());
}

/** Applies a score change from a dispute inside one transaction (revision + recompute + result sync). */
async function applyScore(answerId: string, newScore: number, actorId: string, reason: string) {
  return withTransaction(async (session) => {
    const answer = await Answer.findById(answerId).session(session);
    if (!answer) throw notFound("Answer");
    const aq = await AttemptQuestion.findById(answer.attemptQuestionId).session(session).lean();
    if (!aq) throw notFound("Question");
    if (newScore > aq.marks) throw unprocessable(`Score cannot exceed ${aq.marks}`, "VALIDATION_FAILED", [{ field: "newScore", issue: `Maximum is ${aq.marks}` }]);
    const old = answer.finalScore ?? null;
    answer.manualScore = round2(newScore);
    answer.finalScore = round2(newScore);
    answer.gradeStatus = "REGRADED";
    answer.graderId = actorId as never;
    answer.gradedAt = new Date();
    await answer.save({ session });
    await GradeRevision.create([{ answerId, attemptId: answer.attemptId, examId: answer.examId, oldScore: old, newScore: round2(newScore), reason, source: "DISPUTE", changedBy: actorId }], { session });
    await recomputeAttemptScore(answer.attemptId, session);
    return { old, examId: answer.examId };
  });
}

async function finish(dispute: Awaited<ReturnType<typeof loadDispute>>["dispute"], resolver: AuthUser, input: In<typeof resolveBody>, countersignedBy?: string) {
  const accepted = input.outcome !== "REJECT";
  let oldScore: number | null = null;
  if (accepted) {
    if (dispute.type === "GRADING_ERROR") {
      if (!dispute.answerId) throw unprocessable("This dispute has no answer to re-score");
      if (input.newScore === undefined) throw unprocessable("newScore is required when accepting a grading dispute", "VALIDATION_FAILED", [{ field: "newScore", issue: "Required" }]);
      const r = await applyScore(String(dispute.answerId), input.newScore, resolver.userId, `Dispute ${dispute._id}: ${input.note}`);
      oldScore = r.old;
      await recomputeRanks(dispute.examId);
    } else if (dispute.type === "AMBIGUOUS_QUESTION") {
      if (!input.policy) throw unprocessable("policy is required when accepting an ambiguous-question dispute", "VALIDATION_FAILED", [{ field: "policy", issue: "Required" }]);
      const aq = await AttemptQuestion.findById(dispute.attemptQuestionId).select("questionId").lean();
      if (!aq) throw notFound("Question");
      await setKeyOverride(resolver, String(dispute.examId), String(aq.questionId), { policy: input.policy, correctOptionIds: input.correctOptionIds ?? [], reason: `Dispute ${dispute._id}: ${input.note}` });
    } else if (dispute.type === "TECHNICAL_INCIDENT" && input.allowReattempt) {
      await Enrollment.updateOne({ examId: dispute.examId, candidateId: dispute.candidateId }, { $inc: { extraAttempts: 1 } });
    }
  }
  dispute.status = accepted ? "RESOLVED_ACCEPTED" : "RESOLVED_REJECTED";
  dispute.resolution = { outcome: input.outcome, oldScore: oldScore ?? undefined, newScore: input.newScore, note: input.note, policy: input.policy, allowReattempt: input.allowReattempt, resolverId: resolver.userId as never, countersignedBy: countersignedBy as never, resolvedAt: new Date() } as never;
  dispute.pendingResolution = undefined;
  await dispute.save();
  await event(dispute._id, resolver, countersignedBy ? "RESOLVED_COUNTERSIGNED" : "RESOLVED", input.note, { outcome: input.outcome, newScore: input.newScore, policy: input.policy });
  await audit({ action: "dispute.resolve", entityType: "dispute", entityId: dispute._id, before: { oldScore }, after: { outcome: input.outcome, newScore: input.newScore, policy: input.policy }, meta: { countersignedBy } });
  void notify(String(dispute.candidateId), "dispute_resolved", { disputeId: String(dispute._id), status: dispute.status }).catch(() => undefined);
  return toDisputeDto(dispute.toObject());
}

export async function resolveDispute(user: AuthUser, id: string, input: In<typeof resolveBody>) {
  const { dispute } = await loadDispute(user, id);
  if (user.role !== "EXAMINER") throw forbidden();
  if (!OPEN.includes(dispute.status)) throw conflict("Dispute is already closed", "CONFLICT");
  if (dispute.pendingResolution) throw conflict("A resolution is already awaiting countersignature", "CONFLICT");
  const changesScore = input.outcome !== "REJECT" && dispute.type === "GRADING_ERROR";
  // four-eyes: the original grader cannot finalise a score change on their own grading
  if (changesScore && dispute.originalGraderId && String(dispute.originalGraderId) === user.userId) {
    dispute.pendingResolution = { ...input, proposedBy: user.userId, proposedAt: new Date() };
    dispute.status = "UNDER_REVIEW";
    await dispute.save();
    await event(dispute._id, user, "RESOLUTION_PROPOSED", input.note, { outcome: input.outcome, newScore: input.newScore });
    await audit({ action: "dispute.propose", entityType: "dispute", entityId: id, meta: { outcome: input.outcome, newScore: input.newScore } });
    return { ...toDisputeDto(dispute.toObject()), message: "You graded this answer originally; another examiner or an administrator must countersign." };
  }
  return finish(dispute, user, input);
}

export async function countersign(user: AuthUser, id: string) {
  const { dispute } = await loadDispute(user, id);
  if (user.role === "CANDIDATE") throw forbidden();
  const pending = dispute.pendingResolution as (In<typeof resolveBody> & { proposedBy: string }) | undefined;
  if (!pending) throw conflict("No resolution is awaiting countersignature", "CONFLICT");
  if (String(pending.proposedBy) === user.userId) throw conflict("A different reviewer must countersign", "FOUR_EYES_REQUIRED");
  const { proposedBy: _p, ...input } = pending as In<typeof resolveBody> & { proposedBy: string; proposedAt?: Date };
  return finish(dispute, user, input as In<typeof resolveBody>, user.userId);
}

export async function rejectProposal(user: AuthUser, id: string, note: string) {
  const { dispute } = await loadDispute(user, id);
  if (user.role === "CANDIDATE") throw forbidden();
  if (!dispute.pendingResolution) throw conflict("No resolution is awaiting countersignature", "CONFLICT");
  dispute.pendingResolution = undefined;
  await dispute.save();
  await event(dispute._id, user, "PROPOSAL_REJECTED", note);
  return toDisputeDto(dispute.toObject());
}

/** SLA enforcement: overdue disputes escalate automatically so none stall silently. */
export async function escalateOverdueDisputes() {
  const overdue = await Dispute.find({ status: { $in: ["OPEN", "UNDER_REVIEW"] }, slaDueAt: { $lt: new Date() } }).limit(200);
  for (const d of overdue) {
    d.status = "ESCALATED";
    d.escalatedAt = new Date();
    await d.save();
    await DisputeEvent.create({ disputeId: d._id, actorId: d.assigneeId ?? d.candidateId, actorRole: "SYSTEM", action: "AUTO_ESCALATED", note: "SLA elapsed" });
    const admins = await User.find({ role: "ADMIN", isActive: true }).select("_id").limit(5).lean();
    await Promise.all(admins.map((a) => notify(String(a._id), "dispute_overdue", { disputeId: String(d._id), examId: String(d.examId) }).catch(() => undefined)));
  }
  return { escalated: overdue.length };
}

void Attempt;
