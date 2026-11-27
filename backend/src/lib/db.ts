import mongoose, { type ClientSession } from "mongoose";
import { env } from "../config/env";
import { logger } from "./logger";

export async function connectDatabase() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGO_URI, { maxPoolSize: 20, serverSelectionTimeoutMS: 10_000 });
  logger.info("MongoDB connected");
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}

export async function ensureIndexes() {
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes().catch((e) => logger.error(`index error ${m.modelName}: ${e.message}`))));
}

function isRetryable(err: unknown) {
  const e = err as { hasErrorLabel?: (l: string) => boolean; code?: number };
  return Boolean(e?.hasErrorLabel?.("TransientTransactionError") || e?.hasErrorLabel?.("UnknownTransactionCommitResult") || e?.code === 112);
}

/**
 * Runs `fn` in a MongoDB transaction (requires a replica set), retrying transient
 * failures such as write conflicts up to 3 times.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const session = await mongoose.startSession();
    try {
      let result!: T;
      await session.withTransaction(
        async () => {
          result = await fn(session);
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
      return result;
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) throw err;
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1) + Math.random() * 25));
    } finally {
      await session.endSession();
    }
  }
  throw lastError;
}

export const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === 11000;
