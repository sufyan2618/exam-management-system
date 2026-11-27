import type { ExamStatus } from "../config/constants";
import { AppError } from "../utils/errors";

interface StatusFields {
  status: string;
  startsAt: Date;
  endsAt: Date;
  closedAt?: Date | null;
}

/**
 * Single source of truth for exam status in access decisions. The persisted `status` is only a
 * base state (DRAFT / PUBLISHED / ARCHIVED); time-derived states are computed on every read so a
 * stale scheduler can never grant or deny access.
 */
export function computeStatus(exam: StatusFields, now: Date): ExamStatus {
  if (exam.status === "DRAFT" || exam.status === "ARCHIVED") return exam.status;
  if (exam.closedAt) return "COMPLETED";
  if (now.getTime() < exam.startsAt.getTime()) return "PUBLISHED";
  if (now.getTime() <= exam.endsAt.getTime()) return "ONGOING";
  return "COMPLETED";
}

export interface EntryFields extends StatusFields {
  lateEntryMinutes: number;
  flexibleStart: boolean;
  maxAttempts: number;
}

export function entryWindow(exam: EntryFields) {
  const closeByLate = exam.startsAt.getTime() + exam.lateEntryMinutes * 60_000;
  const closes = exam.flexibleStart ? exam.endsAt.getTime() : Math.min(exam.endsAt.getTime(), closeByLate);
  return { opensAt: exam.startsAt, closesAt: new Date(closes) };
}

export interface AccessDecision {
  canEnter: boolean;
  code?: string;
  message?: string;
  opensAt: Date;
  closesAt: Date;
}

/** Non-throwing variant, used by dashboards to explain access status to candidates. */
export function evaluateAccess(
  exam: EntryFields,
  enrollment: { status: string; extraAttempts?: number } | null,
  attemptsUsed: number,
  now: Date,
): AccessDecision {
  const { opensAt, closesAt } = entryWindow(exam);
  const base = { opensAt, closesAt };
  if (exam.status === "DRAFT") return { ...base, canEnter: false, code: "EXAM_NOT_PUBLISHED", message: "This exam has not been published." };
  if (!enrollment || enrollment.status !== "ENROLLED") return { ...base, canEnter: false, code: "NOT_ENROLLED", message: "You are not enrolled in this exam." };
  if (exam.status === "ARCHIVED" || exam.closedAt) return { ...base, canEnter: false, code: "EXAM_WINDOW_CLOSED", message: "This exam is closed." };
  if (now.getTime() < opensAt.getTime()) return { ...base, canEnter: false, code: "EXAM_NOT_AVAILABLE", message: "This exam is not open yet." };
  if (now.getTime() > closesAt.getTime()) return { ...base, canEnter: false, code: "EXAM_WINDOW_CLOSED", message: "The entry window for this exam has closed." };
  if (attemptsUsed >= exam.maxAttempts + (enrollment.extraAttempts ?? 0)) {
    return { ...base, canEnter: false, code: "ATTEMPT_LIMIT_REACHED", message: "You have used all of your attempts." };
  }
  return { ...base, canEnter: true };
}

/** `assertCanEnter` (spec 8.2): the one function gating candidate entry. */
export function assertCanEnter(exam: EntryFields, enrollment: { status: string; extraAttempts?: number } | null, attemptsUsed: number, now: Date) {
  const d = evaluateAccess(exam, enrollment, attemptsUsed, now);
  if (d.canEnter) return d;
  const status = d.code === "EXAM_NOT_PUBLISHED" ? 404 : d.code === "NOT_ENROLLED" ? 403 : d.code === "ATTEMPT_LIMIT_REACHED" ? 409 : d.code === "EXAM_WINDOW_CLOSED" ? 410 : 403;
  throw new AppError(status, d.code!, d.message!, { details: [{ field: "opensAt", issue: d.opensAt.toISOString() }, { field: "closesAt", issue: d.closesAt.toISOString() }] });
}
