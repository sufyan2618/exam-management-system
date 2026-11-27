import type { SubmitReason } from "../config/constants";
import { env } from "../config/env";
import { withTransaction } from "../lib/db";
import { logger } from "../lib/logger";
import { autoSubmitLag, finalizeCounter } from "../lib/metrics";
import { publish } from "../lib/sse";
import { Attempt } from "../models/attempt.model";
import { notFound } from "../utils/errors";
import { audit } from "./audit.service";
import { gradeAttemptObjective, recomputeAttemptScore } from "./scoring.service";

/**
 * Atomically moves an attempt out of IN_PROGRESS and grades it. Safe to call any number of times
 * and from any number of workers/requests: only the caller that wins the status transition grades.
 */
export async function finalizeAttempt(attemptId: string, reason: SubmitReason, opts: { actorId?: string } = {}) {
  const now = new Date();
  const outcome = await withTransaction(async (session) => {
    const current = await Attempt.findById(attemptId).select("deadlineAt").session(session).lean();
    if (!current) throw notFound("Attempt");
    const claimed = await Attempt.findOneAndUpdate(
      { _id: attemptId, status: "IN_PROGRESS" },
      {
        $set: {
          status: reason === "TIMEOUT" ? "AUTO_SUBMITTED" : "SUBMITTED",
          submittedAt: reason === "TIMEOUT" ? current.deadlineAt : now,
          submitReason: reason,
        },
        $inc: { version: 1 },
      },
      { new: true, session },
    );
    if (!claimed) {
      const existing = await Attempt.findById(attemptId).session(session).lean();
      return { attempt: existing!, finalizedNow: false };
    }
    await gradeAttemptObjective(claimed._id, session);
    await recomputeAttemptScore(claimed._id, session);
    const attempt = (await Attempt.findById(attemptId).session(session).lean())!;
    return { attempt, finalizedNow: true, deadlineAt: current.deadlineAt };
  });

  if (outcome.finalizedNow) {
    finalizeCounter.inc({ reason });
    if (reason === "TIMEOUT" && outcome.deadlineAt) autoSubmitLag.observe(Math.max(0, (now.getTime() - outcome.deadlineAt.getTime()) / 1000));
    const payload = { attemptId, status: outcome.attempt.status, reason };
    await Promise.all([
      publish(`attempt:${attemptId}`, { type: reason === "EXAMINER" ? "force_submit" : "attempt_status", data: payload }),
      publish(`exam:${String(outcome.attempt.examId)}:monitor`, { type: "attempt_finalized", data: payload }),
    ]);
    if (reason === "EXAMINER" || reason === "INTERRUPT_LIMIT") {
      await audit({ action: "attempt.force_submit", entityType: "attempt", entityId: attemptId, actor: opts.actorId ? { userId: opts.actorId } : undefined, meta: { reason } });
    }
    logger.info("attempt finalized", { attemptId, reason, graceSeconds: env.GRACE_SECONDS });
  }
  return { ...outcome, finalizedNow: outcome.finalizedNow };
}

/** Lazy finalization: any request touching an expired attempt completes it, so the cron worker is only a safety net. */
export async function finalizeIfExpired<T extends { _id: unknown; status: string; deadlineAt: Date }>(attempt: T, now = new Date()) {
  if (attempt.status !== "IN_PROGRESS") return false;
  if (now.getTime() <= attempt.deadlineAt.getTime() + env.GRACE_SECONDS * 1000) return false;
  await finalizeAttempt(String(attempt._id), "TIMEOUT");
  return true;
}
