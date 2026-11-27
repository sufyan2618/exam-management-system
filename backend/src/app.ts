import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { setupSwagger } from "./lib/swagger";
import { registry } from "./lib/metrics";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware";
import { globalRateLimiter } from "./middlewares/rate-limit.middleware";
import { requestId, requestLogger } from "./middlewares/request-id.middleware";
import apiRouter from "./routers";
import { AppError } from "./utils/errors";

export const state = { shuttingDown: false };

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(requestId);
  app.use(requestLogger);
  app.use(
    helmet({
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
      credentials: true,
      exposedHeaders: ["X-Request-Id", "Retry-After", "Idempotent-Replayed"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Request-Id", "Idempotency-Key", "If-Match", "X-Session-Epoch", "Last-Event-ID"],
    }),
  );
  app.use(compression({ filter: (req, res) => !String(res.getHeader("Content-Type")).includes("text/event-stream") && compression.filter(req, res) }));

  // Backpressure during graceful shutdown.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    if (state.shuttingDown) {
      res.setHeader("Retry-After", "5");
      next(new AppError(503, "SERVICE_UNAVAILABLE", "Server is shutting down", { retryable: true }));
      return;
    }
    next();
  });

  // Enforce JSON for bodies (multipart only for upload routes).
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      const len = Number(req.headers["content-length"] ?? 0);
      const type = req.headers["content-type"] ?? "";
      if (len > 0 && !type.includes("application/json") && !type.includes("multipart/form-data")) {
        next(new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json"));
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: "1mb", strict: true }));
  app.use(cookieParser());
  app.use(globalRateLimiter);

  app.get("/internal/metrics", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = env.METRICS_TOKEN;
      const provided = req.header("authorization")?.replace("Bearer ", "");
      const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");
      if (token ? provided !== token : env.IS_PROD && !loopback) throw new AppError(404, "ROUTE_NOT_FOUND", "Route not found");
      res.setHeader("Content-Type", registry.contentType);
      res.end(await registry.metrics());
    } catch (err) {
      next(err);
    }
  });

  app.use("/api/v1", apiRouter);
  setupSwagger(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
