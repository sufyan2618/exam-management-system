import { Queue } from "bullmq";
import { env } from "../config/env";
import { redis } from "../lib/redis";

export const JOBS_QUEUE = "exam-jobs";

export type JobName =
  | "attempt.autoSubmit"
  | "attempt.autoSubmitOne"
  | "exam.statusSync"
  | "interruption.detect"
  | "import.process"
  | "sandbox.cleanup"
  | "maintenance.cleanup"
  | "analytics.refresh"
  | "integrity.postExam"
  | "consistency.check";

export const jobsQueue = new Queue(JOBS_QUEUE, {
  connection: redis,
  defaultJobOptions: { removeOnComplete: 200, removeOnFail: 1000, attempts: 5, backoff: { type: "exponential", delay: 1000 } },
});

export async function enqueue(name: JobName, data: Record<string, unknown>, opts: { delayMs?: number; jobId?: string } = {}) {
  if (env.IS_TEST) return;
  await jobsQueue.add(name, data, { delay: opts.delayMs, jobId: opts.jobId });
}

/** Per-attempt delayed auto-submit (the periodic sweep is the safety net). */
export async function scheduleAutoSubmit(attemptId: string, deadlineAt: Date) {
  const delayMs = Math.max(0, deadlineAt.getTime() - Date.now() + env.GRACE_SECONDS * 1000 + 500);
  await enqueue("attempt.autoSubmitOne", { attemptId }, { delayMs, jobId: `autosubmit-${attemptId}-${deadlineAt.getTime()}` });
}
