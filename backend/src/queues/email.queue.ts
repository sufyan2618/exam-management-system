import { Queue } from "bullmq";
import { redis } from "../lib/redis";
import type { EmailTemplate } from "../templates/email-templates";

export type EmailJobData = { to: string } & EmailTemplate;

export const emailQueue = new Queue<EmailJobData>("email-queue", { connection: redis });

export async function addEmailJob(data: EmailJobData) {
  await emailQueue.add("send-email", data, {
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
  });
}
