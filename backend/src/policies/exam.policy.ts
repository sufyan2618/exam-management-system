import { Exam } from "../models/exam.model";
import type { AuthUser } from "../types/express";
import { forbidden, notFound } from "../utils/errors";

export const isExaminerOf = (exam: { ownerId: unknown; coExaminerIds?: unknown[] }, userId: string) =>
  String(exam.ownerId) === userId || (exam.coExaminerIds ?? []).some((c) => String(c) === userId);

/**
 * Loads an exam subject to the resource policy.
 *  - read:  admin (all), examiner (owner / co-examiner)
 *  - write: examiner (owner / co-examiner) only; admins are read-only on exam content
 * Foreign exams return 404 so existence is not leaked.
 */
export async function loadManagedExam(user: AuthUser, examId: string, mode: "read" | "write" = "write") {
  const exam = await Exam.findById(examId);
  if (!exam) throw notFound("Exam");
  if (user.role === "ADMIN") {
    if (mode === "write") throw forbidden();
    return exam;
  }
  if (user.role !== "EXAMINER" || !isExaminerOf(exam, user.userId)) throw notFound("Exam");
  return exam;
}

export const canManageExam = (user: AuthUser, exam: { ownerId: unknown; coExaminerIds?: unknown[] }) => user.role === "EXAMINER" && isExaminerOf(exam, user.userId);
