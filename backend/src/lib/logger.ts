import path from "node:path";
import fs from "node:fs";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { env } from "../config/env";

const logsDir = path.resolve(process.cwd(), "logs");

if (!env.IS_TEST && !fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const REDACT_KEYS = /authorization|password|token|secret|cookie|answers?|textAnswer|selectedOptionIds|refresh/i;

/** Redacts sensitive keys from structured log metadata (deep). */
const redactFormat = winston.format((info) => {
  const walk = (value: unknown, depth = 0): unknown => {
    if (depth > 5 || value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.test(k) ? "[REDACTED]" : walk(v, depth + 1);
    }
    return out;
  };
  for (const key of Object.keys(info)) {
    if (["level", "message", "timestamp"].includes(key)) continue;
    (info as Record<string, unknown>)[key] = REDACT_KEYS.test(key) ? "[REDACTED]" : walk((info as Record<string, unknown>)[key]);
  }
  return info;
});

const baseFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  redactFormat(),
  winston.format.json(),
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    silent: env.IS_TEST,
    format: env.IS_PROD ? baseFormat : winston.format.combine(winston.format.colorize(), winston.format.simple()),
  }),
];

if (!env.IS_TEST) {
  transports.push(
    new winston.transports.File({ filename: path.join(logsDir, "error.log"), level: "error" }),
    new DailyRotateFile({
      filename: path.join(logsDir, "combined-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxFiles: "15d",
    }),
  );
}

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: baseFormat,
  transports,
});
