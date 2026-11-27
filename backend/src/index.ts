import { createApp, state } from "./app";
import { env } from "./config/env";
import { connectDatabase, disconnectDatabase, ensureIndexes } from "./lib/db";
import { logger } from "./lib/logger";
import { redis } from "./lib/redis";
import { closeAllStreams, hub } from "./lib/sse";
import { emailQueue } from "./queues/email.queue";
import { jobsQueue } from "./queues/jobs.queue";

// Register all models before index creation.
import "./models/user.model";
import "./models/question.model";
import "./models/exam.model";
import "./models/attempt.model";
import "./models/result.model";
import "./models/dispute.model";
import "./models/system.model";

async function bootstrap() {
  await connectDatabase();
  if (!env.IS_PROD) await ensureIndexes();
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Server running on http://localhost:${env.PORT} (docs: /api/docs)`);
  });
  server.keepAliveTimeout = 65_000;

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info(`${signal} received: draining`);
    state.shuttingDown = true;
    closeAllStreams();
    const force = setTimeout(() => {
      logger.error("Forced shutdown after 30s");
      process.exit(1);
    }, 30_000);
    force.unref();
    server.close(async () => {
      await hub.close();
      await Promise.allSettled([jobsQueue.close(), emailQueue.close()]);
      redis.disconnect();
      await disconnectDatabase();
      logger.info("Shutdown complete");
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

bootstrap().catch((error) => {
  logger.error("Failed to start server", { error: error.message });
  process.exit(1);
});
