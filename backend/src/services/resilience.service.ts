import { HEARTBEAT_GAP_SECONDS } from "../config/constants";
import { addSeconds, secondsBetween } from "../lib/time";
import { publish } from "../lib/sse";
import { Attempt, Interruption } from "../models/attempt.model";
import { Exam } from "../models/exam.model";
import { isExaminerOf } from "../policies/exam.policy";
import type { AuthUser } from "../types/express";
import { conflict, notFound, unprocessable } from "../utils/errors";
import { audit } from "./audit.service";
import { notify } from "./notification.service";

interface TouchAttempt {
  _id: unknown;
  examId: unknown;
  deadlineAt: Date;
  hardEndsAt?: Date | null;
  lastSeenAt?: Date | null;
  creditedSeconds: number;
  creditCount: number;
  resilienceSnapshot?: { mode?: string; maxCreditSeconds?: number; maxCredits?: number; extendHardCap?: boolean } | null;
}

/** Extends a deadline by `seconds`, honouring the hard window cap unless the policy lifts it. */
export function extendedDeadline(a: TouchAttempt, seconds: number, ignoreCap = false) {
  let next = addSeconds(a.deadlineAt, seconds);
  if (!ignoreCap && a.hardEndsAt && !a.resilienceSnapshot?.extendHardCap && next > a.hardEndsAt) next = a.hardEndsAt.getTime() > a.deadlineAt.getTime() ? a.hardEndsAt : a.deadlineAt;
  return next;
}

/**
 * Called on every authenticated attempt interaction. A server-observed gap larger than the heartbeat
 * tolerance becomes an interruption record; under the GRACE policy the verified gap (minus tolerance) is
 * credited automatically - capped, limited in count, and denied if the candidate wrote answers offline during it.
 * Returns the (possibly extended) deadline.
 */
export async function touchAttempt(attempt: TouchAttempt, now: Date, opts: { hadOfflineWrites?: boolean } = {}): Promise<Date> {
  if (!attempt.lastSeenAt) return attempt.deadlineAt;
  const gap = secondsBetween(now, attempt.lastSeenAt);
  if (gap <= HEARTBEAT_GAP_SECONDS) return attempt.deadlineAt;

  const open = await Interruption.findOne({ attemptId: attempt._id, endedAt: null });
  const interruption = open ?? new Interruption({ attemptId: attempt._id, examId: attempt.examId, startedAt: attempt.lastSeenAt });
  interruption.endedAt = now;
  interruption.gapSeconds = secondsBetween(now, interruption.startedAt);
  interruption.hadOfflineWrites = Boolean(opts.hadOfflineWrites);

  const policy = attempt.resilienceSnapshot ?? {};
  let deadline = attempt.deadlineAt;
  if (policy.mode === "GRACE" && !opts.hadOfflineWrites && attempt.creditCount < (policy.maxCredits ?? 3)) {
    const room = (policy.maxCreditSeconds ?? 300) - attempt.creditedSeconds;
    const wanted = Math.min(interruption.gapSeconds - HEARTBEAT_GAP_SECONDS, room);
    if (wanted > 0) {
      const next = extendedDeadline(attempt, wanted);
      const effective = secondsBetween(next, attempt.deadlineAt);
      if (effective > 0) {
        const res = await Attempt.updateOne({ _id: attempt._id, status: "IN_PROGRESS" }, { $set: { deadlineAt: next }, $inc: { creditedSeconds: effective, creditCount: 1 } });
        if (res.modifiedCount) {
          interruption.creditedSeconds = effective;
          interruption.status = "REVIEWED";
          interruption.note = "Auto-credited under GRACE policy";
          deadline = next;
          await publish(`attempt:${String(attempt._id)}`, { type: "time_extended", data: { seconds: effective, deadlineAt: next.toISOString(), reason: "INTERRUPTION_CREDIT" } });
        }
      }
    }
  }
  await interruption.save();
  return deadline;
}

async function loadForExaminer(user: AuthUser, attemptId: string) {
  const attempt = await Attempt.findById(attemptId);
  if (!attempt) throw notFound("Attempt");
  const exam = await Exam.findById(attempt.examId).select("ownerId coExaminerIds title").lean();
  const allowed = exam && (user.role === "ADMIN" || isExaminerOf(exam, user.userId) || (attempt.isSandbox && String(attempt.candidateId) === user.userId));
  if (!allowed) throw notFound("Attempt");
  return { attempt, exam: exam! };
}

export async function listInterruptions(user: AuthUser, attemptId: string) {
  const { attempt } = await loadForExaminer(user, attemptId);
  const rows = await Interruption.find({ attemptId: attempt._id }).sort({ startedAt: 1 }).lean();
  return rows.map(toInterruptionDto);
}

export const toInterruptionDto = (i: Record<string, any>) => ({
  id: String(i._id),
  startedAt: i.startedAt,
  endedAt: i.endedAt ?? null,
  gapSeconds: i.gapSeconds,
  kind: i.kind,
  creditedSeconds: i.creditedSeconds,
  hadOfflineWrites: i.hadOfflineWrites,
  status: i.status,
  note: i.note ?? null,
});

/** REVIEWED policy: an examiner approves (or rejects) a bounded credit for a recorded interruption. */
export async function reviewInterruption(user: AuthUser, attemptId: string, interruptionId: string, input: { approve: boolean; creditSeconds?: number; kind?: string; note: string }) {
  const { attempt, exam } = await loadForExaminer(user, attemptId);
  if (user.role !== "EXAMINER") throw conflict("Only examiners can review interruptions", "FORBIDDEN");
  const interruption = await Interruption.findOne({ _id: interruptionId, attemptId: attempt._id });
  if (!interruption) throw notFound("Interruption");
  if (!interruption.endedAt) throw conflict("Interruption is still open", "CONFLICT");
  if (interruption.status !== "AUTO_RECORDED") throw conflict("Interruption was already reviewed", "CONFLICT");

  if (!input.approve) {
    interruption.status = "REJECTED";
    interruption.reviewerId = user.userId as never;
    interruption.note = input.note;
    await interruption.save();
    await audit({ action: "interruption.reject", entityType: "attempt", entityId: attempt._id, meta: { interruptionId, note: input.note } });
    return toInterruptionDto(interruption);
  }

  if (attempt.status !== "IN_PROGRESS") throw conflict("Attempt is no longer active", "ATTEMPT_NOT_ACTIVE");
  const policy = attempt.resilienceSnapshot ?? {};
  if (policy.mode === "NONE") throw conflict("This exam does not allow interruption credits", "CONFLICT");
  if (attempt.creditCount >= (policy.maxCredits ?? 3)) throw conflict("Maximum number of credits reached for this attempt", "CONFLICT");
  const requested = input.creditSeconds ?? Math.max(0, interruption.gapSeconds - HEARTBEAT_GAP_SECONDS);
  const room = (policy.maxCreditSeconds ?? 300) - attempt.creditedSeconds;
  const seconds = Math.min(requested, interruption.gapSeconds, room);
  if (seconds <= 0) throw unprocessable("No creditable time remains for this attempt", "VALIDATION_FAILED");

  const next = extendedDeadline(attempt as never, seconds);
  const effective = secondsBetween(next, attempt.deadlineAt);
  if (effective <= 0) throw conflict("Hard window cap prevents any further credit", "EXAM_WINDOW_CLOSED");
  await Attempt.updateOne({ _id: attempt._id, status: "IN_PROGRESS" }, { $set: { deadlineAt: next }, $inc: { creditedSeconds: effective, creditCount: 1 } });
  interruption.creditedSeconds = effective;
  interruption.status = "REVIEWED";
  interruption.reviewerId = user.userId as never;
  if (input.kind) interruption.kind = input.kind as never;
  interruption.note = input.note;
  await interruption.save();

  await publish(`attempt:${attemptId}`, { type: "time_extended", data: { seconds: effective, deadlineAt: next.toISOString(), reason: "INTERRUPTION_CREDIT" } });
  await notify(String(attempt.candidateId), "time_credited", { attemptId, seconds: effective, examTitle: exam.title }).catch(() => undefined);
  await audit({ action: "interruption.credit", entityType: "attempt", entityId: attempt._id, meta: { interruptionId, seconds: effective, note: input.note, hadOfflineWrites: interruption.hadOfflineWrites } });
  return toInterruptionDto(interruption);
}
