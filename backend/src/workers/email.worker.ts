import { Worker } from "bullmq";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { redis } from "../lib/redis";
import type { EmailJobData } from "../queues/email.queue";
import { sendTemplatedEmail } from "../utils/send-email";

export function startEmailWorker() {
  const worker = new Worker<EmailJobData>(
    "email-queue",
    async (job) => {
      const { to, ...tpl } = job.data;
      await sendTemplatedEmail(to, tpl as Parameters<typeof sendTemplatedEmail>[1]);
    },
    { connection: redis, concurrency: 5 },
  );
  worker.on("completed", (job) => logger.info(`Email job completed: ${job.id}`));
  worker.on("failed", (job, err) => logger.error(`Email job failed: ${job?.id} - ${err.message}`));
  return worker;
}

if (import.meta.main) {
  startEmailWorker();
  logger.info(`Email worker running in ${env.NODE_ENV} mode`);
}
