import { unlink } from "node:fs/promises";
import { HEARTBEAT_GAP_SECONDS } from "../config/constants";
import { env } from "../config/env";
import { computeStatus } from "../lib/exam-status";
import { logger } from "../lib/logger";
import { publish } from "../lib/sse";
import { Answer, Attempt, Interruption } from "../models/attempt.model";
import { Exam } from "../models/exam.model";
import { Result } from "../models/result.model";
import { ImportJob } from "../models/system.model";
import { enqueue, scheduleAutoSubmit } from "../queues/jobs.queue";
import { purgeSandboxData } from "./exam.service";
import { finalizeAttempt } from "./finalize.service";

const DAY = 86_400_000;

/** Safety net behind lazy finalization and per-attempt delayed jobs: auto-submits anything past deadline + grace. */
export async function sweepExpiredAttempts(limit = 200) {
  const cutoff = new Date(Date.now() - env.GRACE_SECONDS * 1000);
  const rows = await Attempt.find({ status: "IN_PROGRESS", deadlineAt: { $lt: cutoff } }).select("_id").limit(limit).lean();
  let finalized = 0;
  for (const row of rows) {
    try {
      const r = await finalizeAttempt(String(row._id), "TIMEOUT");
      if (r.finalizedNow) finalized++;
    } catch (err) {
      logger.error("auto-submit failed", { attemptId: String(row._id), error: (err as Error).message });
    }
  }
  return { scanned: rows.length, finalized };
}

/** Auto-submits a single attempt when its delayed job fires; re-arms if the deadline was extended meanwhile. */
export async function autoSubmitOne(attemptId: string) {
  const attempt = await Attempt.findById(attemptId).select("status deadlineAt").lean();
  if (!attempt || attempt.status !== "IN_PROGRESS") return { skipped: true };
  if (Date.now() <= attempt.deadlineAt.getTime() + env.GRACE_SECONDS * 1000) {
    await scheduleAutoSubmit(attemptId, attempt.deadlineAt);
    return { rescheduled: true };
  }
  const r = await finalizeAttempt(attemptId, "TIMEOUT");
  return { finalized: r.finalizedNow };
}

/** Persists time-derived exam states (the API always recomputes, so this only serves queries/reports). */
export async function syncExamStatuses() {
  const now = new Date();
  const started = await Exam.updateMany({ status: "PUBLISHED", startsAt: { $lte: now }, endsAt: { $gte: now }, closedAt: null }, { $set: { status: "ONGOING" } });
  const ended = await Exam.find({ status: { $in: ["PUBLISHED", "ONGOING"] }, $or: [{ endsAt: { $lt: now } }, { closedAt: { $ne: null } }] }).select("_id status startsAt endsAt closedAt").lean();
  let completed = 0;
  for (const exam of ended) {
    if (computeStatus(exam as never, now) !== "COMPLETED") continue;
    const res = await Exam.updateOne({ _id: exam._id, status: { $in: ["PUBLISHED", "ONGOING"] } }, { $set: { status: "COMPLETED" } });
    if (!res.modifiedCount) continue;
    completed++;
    const examId = String(exam._id);
    await publish(`exam:${examId}`, { type: "exam_status", data: { examId, status: "COMPLETED" } });
    await enqueue("integrity.postExam", { examId }, { jobId: `postexam-${examId}`, delayMs: 60_000 });
    await enqueue("analytics.refresh", { examId }, { jobId: `analytics-${examId}-${Date.now()}`, delayMs: 30_000 });
  }
  return { started: started.modifiedCount, completed };
}

/** Records an open interruption for every live attempt whose heartbeat went silent. */
export async function detectInterruptions() {
  const cutoff = new Date(Date.now() - HEARTBEAT_GAP_SECONDS * 1000);
  const silent = await Attempt.find({ status: "IN_PROGRESS", lastSeenAt: { $lt: cutoff } }).select("_id examId lastSeenAt").limit(500).lean();
  let opened = 0;
  for (const a of silent) {
    const res = await Interruption.updateOne(
      { attemptId: a._id, endedAt: null },
      { $setOnInsert: { attemptId: a._id, examId: a.examId, startedAt: a.lastSeenAt, kind: "UNKNOWN", status: "AUTO_RECORDED" } },
      { upsert: true },
    );
    if (res.upsertedCount) {
      opened++;
      await publish(`exam:${String(a.examId)}:monitor`, { type: "candidate_offline", data: { attemptId: String(a._id), since: a.lastSeenAt } });
    }
  }
  return { silent: silent.length, opened };
}

export async function cleanupSandboxes() {
  return { purged: await purgeSandboxData({ createdAt: { $lt: new Date(Date.now() - DAY) } }) };
}

export async function maintenanceCleanup() {
  const old = await ImportJob.find({ createdAt: { $lt: new Date(Date.now() - 7 * DAY) }, filePath: { $exists: true, $ne: null } }).select("filePath").limit(500).lean();
  let files = 0;
  for (const j of old) {
    if (j.filePath) {
      await unlink(j.filePath).then(() => files++).catch(() => undefined);
      await ImportJob.updateOne({ _id: j._id }, { $unset: { filePath: 1, rows: 1 } });
    }
  }
  const jobs = await ImportJob.deleteMany({ createdAt: { $lt: new Date(Date.now() - 60 * DAY) } });
  return { files, jobsDeleted: jobs.deletedCount };
}

/** Nightly invariants. Violations are logged loudly (and counted) rather than silently repaired. */
export async function consistencyCheck() {
  const stuckCutoff = new Date(Date.now() - (env.GRACE_SECONDS + 120) * 1000);
  const stuck = await Attempt.countDocuments({ status: "IN_PROGRESS", deadlineAt: { $lt: stuckCutoff } });
  const graded = await Attempt.find({ status: "GRADED", isSandbox: false }).sort({ updatedAt: -1 }).limit(500).select("_id totalScore").lean();
  const sums = await Answer.aggregate([{ $match: { attemptId: { $in: graded.map((g) => g._id) } } }, { $group: { _id: "$attemptId", total: { $sum: { $ifNull: ["$finalScore", 0] } } } }]);
  const sumMap = new Map(sums.map((s: { _id: unknown; total: number }) => [String(s._id), s.total]));
  const mismatched = graded.filter((g) => Math.abs((sumMap.get(String(g._id)) ?? 0) - g.totalScore) > 0.005).map((g) => String(g._id));
  const publishedMissing = await Result.countDocuments({ isPublished: true, publishedAt: null });
  const report = { stuckAttempts: stuck, scoreMismatches: mismatched.length, publishedWithoutTimestamp: publishedMissing };
  if (stuck || mismatched.length || publishedMissing) logger.error("consistency check found violations", { ...report, mismatched: mismatched.slice(0, 20) });
  else logger.info("consistency check clean");
  return report;
}
