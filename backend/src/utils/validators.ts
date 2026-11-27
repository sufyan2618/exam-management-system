import type { NextFunction, Request, Response } from "express";
import { z, type ZodTypeAny } from "zod";
import { AppError, type ErrorDetail } from "./errors";
import { normalizeText } from "../lib/sanitize";

export interface ValidationSchemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

function setReq(req: Request, key: "body" | "params" | "query", value: unknown) {
  Object.defineProperty(req, key, { value, writable: true, configurable: true, enumerable: true });
}

export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const details: ErrorDetail[] = [];
    for (const key of ["params", "query", "body"] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const parsed = schema.safeParse(req[key] ?? {});
      if (parsed.success) {
        setReq(req, key, parsed.data);
      } else {
        for (const issue of parsed.error.issues) {
          details.push({ field: [key, ...issue.path].join("."), issue: issue.message });
        }
      }
    }
    if (details.length) {
      next(new AppError(422, "VALIDATION_FAILED", "Request validation failed", { details }));
      return;
    }
    next();
  };
}

// ---- reusable primitives -------------------------------------------------------------------

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
export const idParams = z.object({ id: objectId }).strict();

/** Trimmed, NFC-normalised, control-char-free string with length bounds. */
export const text = (min: number, max: number) =>
  z
    .string()
    .transform((s) => normalizeText(s).trim())
    .pipe(z.string().min(min, `Must be at least ${min} characters`).max(max, `Must be at most ${max} characters`));

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("Invalid email address");

export const marks = z
  .number()
  .positive("Marks must be greater than 0")
  .max(10_000)
  .refine((n) => Math.abs(n * 4 - Math.round(n * 4)) < 1e-9, "Marks must be in steps of 0.25");

export const isoDate = z.coerce.date();
export const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");
