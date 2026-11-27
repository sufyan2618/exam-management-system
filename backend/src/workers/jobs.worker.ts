import { Worker, type Job } from "bullmq";
import { env } from "../config/env";
import { connectDatabase, disconnectDatabase } from "../lib/db";
import { logger } from "../lib/logger";
import { redis } from "../lib/redis";
import { hub } from "../lib/sse";
import { JOBS_QUEUE, jobsQueue } from "../queues/jobs.queue";
import { runPostExamAnalysis } from "../services/integrity.service";
import { escalateOverdueDisputes } from "../services/dispute.service";
import * as maintenance from "../services/maintenance.service";

import "../models/user.model";
import "../models/question.model";
import "../models/exam.model";
import "../models/attempt.model";
import "../models/result.model";
import "../models/dispute.model";
import "../models/system.model";

async function handle(job: Job) {
  switch (job.name) {
    case "attempt.autoSubmit":
      return maintenance.sweepExpiredAttempts();
    case "attempt.autoSubmitOne":
      return maintenance.autoSubmitOne(job.data.attemptId);
    case "exam.statusSync":
      return { ...(await maintenance.syncExamStatuses()), ...(await escalateOverdueDisputes()) };
    case "interruption.detect":
      return maintenance.detectInterruptions();
    case "sandbox.cleanup":
      return maintenance.cleanupSandboxes();
    case "maintenance.cleanup":
      return maintenance.maintenanceCleanup();
    case "consistency.check":
      return maintenance.consistencyCheck();
    case "integrity.postExam":
      return runPostExamAnalysis(job.data.examId);
    case "analytics.refresh": {
      const { refreshAnalytics } = await import("../services/analytics.service");
      return refreshAnalytics(job.data.examId);
    }
    case "import.process": {
      const { processImportJob } = await import("../services/import.service");
      return processImportJob(job.data.jobId);
    }
    default:
      logger.warn("unknown job", { name: job.name });
  }
}

/** Idempotent registration of recurring jobs (safe to run on every worker boot / from many replicas). */
export async function registerSchedulers() {
  const every = (id: string, ms: number) => jobsQueue.upsertJobScheduler(id, { every: ms }, { name: id, data: {} });
  const cron = (id: string, pattern: string) => jobsQueue.upsertJobScheduler(id, { pattern }, { name: id, data: {} });
  await Promise.all([
    every("attempt.autoSubmit", 10_000),
    every("exam.statusSync", 30_000),
    every("interruption.detect", 15_000),
    every("analytics.refresh", 15 * 60_000),
    cron("sandbox.cleanup", "0 * * * *"),
    cron("maintenance.cleanup", "0 3 * * *"),
    cron("consistency.check", "30 3 * * *"),
  ]);
}

export async function startJobsWorker() {
  await connectDatabase();
  await registerSchedulers();
  const worker = new Worker(JOBS_QUEUE, handle, { connection: redis, concurrency: 5 });
  worker.on("failed", (job, err) => logger.error(`Job failed: ${job?.name} ${job?.id} - ${err.message}`));
  worker.on("completed", (job, result) => {
    if (!["attempt.autoSubmit", "interruption.detect", "exam.statusSync"].includes(job.name)) logger.info(`Job completed: ${job.name}`, { result });
  });
  return worker;
}

if (import.meta.main) {
  const { startEmailWorker } = await import("./email.worker");
  const worker = await startJobsWorker();
  const email = startEmailWorker();
  logger.info(`Jobs + email workers running in ${env.NODE_ENV} mode`);
  const stop = async () => {
    await Promise.allSettled([worker.close(), email.close()]);
    await hub.close().catch(() => undefined);
    redis.disconnect();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
}
