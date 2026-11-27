import type { Request, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { env } from "../config/env";
import { redis } from "../lib/redis";
import { AppError } from "../utils/errors";

const sendCommand = async (...args: string[]) => {
  const [command, ...rest] = args;
  if (!command) throw new Error("Redis command is required");
  return redis.call(command, ...rest) as Promise<import("rate-limit-redis").RedisReply>;
};

interface LimiterOptions {
  prefix: string;
  windowMs: number;
  limit: number;
  key?: (req: Request) => string;
  message?: string;
}

export function makeLimiter(opts: LimiterOptions): RequestHandler {
  if (env.IS_TEST) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    keyGenerator: (req) => (opts.key ? opts.key(req) : (req.ip ?? "unknown")),
    store: new RedisStore({ prefix: `rl:${opts.prefix}:`, sendCommand }),
    handler: (_req, _res, next, options) => {
      const retryAfter = Math.ceil(options.windowMs / 1000);
      next(
        new AppError(429, "RATE_LIMITED", opts.message ?? "Too many requests, please slow down", {
          retryable: true,
          headers: { "Retry-After": String(retryAfter) },
        }),
      );
    },
  });
}

const MIN = 60 * 1000;
const userKey = (req: Request) => req.user?.userId ?? req.ip ?? "unknown";

/** Coarse per-IP ceiling (high, since a whole exam hall may share one NAT address). */
export const globalRateLimiter = makeLimiter({ prefix: "ip", windowMs: MIN, limit: env.RATE_LIMIT_IP_PER_MIN });
export const userRateLimiter = makeLimiter({ prefix: "user", windowMs: MIN, limit: env.RATE_LIMIT_USER_PER_MIN, key: userKey });
export const loginIpLimiter = makeLimiter({ prefix: "login", windowMs: MIN, limit: 10, message: "Too many login attempts" });
export const refreshLimiter = makeLimiter({ prefix: "refresh", windowMs: MIN, limit: 30 });
export const passwordResetLimiter = makeLimiter({ prefix: "pwreset", windowMs: 15 * MIN, limit: 10 });
export const autosaveLimiter = makeLimiter({
  prefix: "autosave",
  windowMs: MIN,
  limit: env.RATE_LIMIT_AUTOSAVE_PER_MIN,
  key: (req) => `${req.user?.userId ?? req.ip}:${req.params.id}`,
});
export const verifyLimiter = makeLimiter({ prefix: "verify", windowMs: MIN, limit: 30 });
export const importLimiter = makeLimiter({ prefix: "import", windowMs: 60 * MIN, limit: 5, key: userKey });
