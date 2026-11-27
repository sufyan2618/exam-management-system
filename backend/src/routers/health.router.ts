import mongoose from "mongoose";
import { createRouter } from "../lib/router";
import { redis } from "../lib/redis";
import { send } from "../lib/http";
import { jobsQueue } from "../queues/jobs.queue";
import { AppError } from "../utils/errors";

const r = createRouter("Health");

r.get("/health/live", { summary: "Liveness probe", access: "public" }, (_req, res) => send(res, { status: "ok", uptime: Math.round(process.uptime()) }));

r.get("/health/ready", { summary: "Readiness probe (MongoDB, Redis, queue)", access: "public" }, async (_req, res) => {
  const checks: Record<string, string> = {};
  try {
    await mongoose.connection.db?.admin().ping();
    checks.mongo = "up";
  } catch {
    checks.mongo = "down";
  }
  try {
    checks.redis = (await redis.ping()) === "PONG" ? "up" : "down";
  } catch {
    checks.redis = "down";
  }
  try {
    await jobsQueue.getJobCounts("waiting");
    checks.queue = "up";
  } catch {
    checks.queue = "down";
  }
  if (Object.values(checks).some((v) => v !== "up")) {
    throw new AppError(503, "NOT_READY", "Service not ready", { details: Object.entries(checks).map(([field, issue]) => ({ field, issue })), retryable: true });
  }
  send(res, { status: "ready", checks });
});

export default r.router;
