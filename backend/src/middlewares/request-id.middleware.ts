import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { requestContext } from "../lib/context";
import { logger } from "../lib/logger";
import { httpDuration } from "../lib/metrics";
import { maskEmail } from "../lib/sanitize";

const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  const id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  requestContext.run({ requestId: id, ip: req.ip, userAgent: req.header("user-agent")?.slice(0, 300) }, next);
}

/** Structured access log + latency histogram. Never logs bodies, query values or tokens. */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : "unmatched";
    httpDuration.observe({ method: req.method, route, status: String(res.statusCode) }, latencyMs / 1000);
    if (route === "/api/v1/health/live") return;
    logger.http("request", {
      requestId: req.requestId,
      userId: req.user?.userId,
      role: req.user?.role,
      method: req.method,
      route,
      status: res.statusCode,
      latencyMs: Math.round(latencyMs),
      ip: req.ip,
      user: req.user ? maskEmail(req.user.email) : undefined,
    });
  });
  next();
}
