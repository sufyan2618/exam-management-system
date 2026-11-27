import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger";
import { AppError } from "../utils/errors";

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, "ROUTE_NOT_FOUND", "Route not found"));
}

function normalize(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = err as { name?: string; code?: number | string; type?: string; status?: number; message?: string; keyPattern?: Record<string, unknown>; path?: string; errors?: Record<string, { message: string }> };

  if (err instanceof ZodError) {
    return new AppError(422, "VALIDATION_FAILED", "Request validation failed", {
      details: err.issues.map((i) => ({ field: i.path.join("."), issue: i.message })),
    });
  }
  if (e.type === "entity.parse.failed") return new AppError(400, "BAD_REQUEST", "Malformed JSON body");
  if (e.type === "entity.too.large") return new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  if (e.type === "charset.unsupported" || e.type === "encoding.unsupported") return new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported encoding");
  if (e.code === 11000) {
    const field = Object.keys(e.keyPattern ?? {})[0];
    return new AppError(409, "CONFLICT", "A record with these values already exists", { details: field ? [{ field, issue: "Must be unique" }] : [] });
  }
  if (e.name === "CastError") return new AppError(400, "BAD_REQUEST", `Invalid value for ${e.path ?? "field"}`);
  if (e.name === "ValidationError" && e.errors) {
    return new AppError(422, "VALIDATION_FAILED", "Validation failed", {
      details: Object.entries(e.errors).map(([field, v]) => ({ field, issue: v.message })),
    });
  }
  if (e.code === "LIMIT_FILE_SIZE") return new AppError(413, "PAYLOAD_TOO_LARGE", "Uploaded file is too large");
  if (typeof e.code === "string" && e.code.startsWith("LIMIT_")) return new AppError(400, "BAD_REQUEST", "Invalid upload");
  if (e.name === "MongoServerSelectionError" || e.name === "MongoNetworkError") {
    return new AppError(503, "SERVICE_UNAVAILABLE", "Service temporarily unavailable", { retryable: true, headers: { "Retry-After": "5" } });
  }
  return new AppError(500, "INTERNAL_ERROR", "Internal server error");
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const appError = normalize(err);

  if (appError.statusCode >= 500) {
    const e = err as Error;
    logger.error(e?.message ?? "unknown error", { stack: e?.stack, requestId: req.requestId, route: req.originalUrl.split("?")[0] });
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  for (const [k, v] of Object.entries(appError.headers)) res.setHeader(k, v);
  res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details,
      requestId: req.requestId,
      retryable: appError.retryable,
    },
  });
}
