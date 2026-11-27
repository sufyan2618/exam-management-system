import type { NextFunction, Request, Response } from "express";
import { sha256 } from "../lib/crypto";
import { isDuplicateKey } from "../lib/db";
import { IdempotencyKey } from "../models/system.model";
import { AppError, unprocessable } from "../utils/errors";

const TTL_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Replays the stored response for a repeated `Idempotency-Key`; rejects key reuse with a
 * different payload; guards concurrent duplicates with a unique-keyed in-flight record.
 */
export async function idempotency(req: Request, res: Response, next: NextFunction) {
  try {
    const key = req.header("idempotency-key");
    if (!key) return next();
    if (!UUID.test(key)) throw unprocessable("Idempotency-Key must be a UUID", "VALIDATION_FAILED");

    const keyHash = sha256(`${req.user?.userId ?? req.ip}|${req.method}|${req.baseUrl}${req.path}|${key}`);
    const requestHash = sha256(JSON.stringify(req.body ?? {}));

    try {
      await IdempotencyKey.create({ keyHash, requestHash, expiresAt: new Date(Date.now() + TTL_MS) });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const existing = await IdempotencyKey.findOne({ keyHash }).lean();
      if (!existing) return next();
      if (existing.requestHash !== requestHash) {
        throw unprocessable("Idempotency-Key was already used with a different request", "IDEMPOTENCY_KEY_REUSED");
      }
      if (!existing.completed) {
        throw new AppError(409, "REQUEST_IN_PROGRESS", "A request with this Idempotency-Key is still being processed", { retryable: true });
      }
      res.setHeader("Idempotent-Replayed", "true");
      res.status(existing.statusCode ?? 200).json(existing.body);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const status = res.statusCode;
      const update =
        status >= 500
          ? IdempotencyKey.deleteOne({ keyHash })
          : IdempotencyKey.updateOne({ keyHash }, { $set: { completed: true, statusCode: status, body } });
      void update.catch(() => undefined);
      return originalJson(body);
    };
    next();
  } catch (err) {
    next(err);
  }
}
