import { apiRequest } from "./client";

export type ExamState = "DRAFT" | "PUBLISHED" | "ONGOING" | "COMPLETED" | "ARCHIVED";
export type Exam = {
  id: string;
  title: string;
  state: ExamState;
  instructions?: string;
  examinerName?: string;
  startsAt?: string;
  endsAt?: string;
  durationMinutes?: number;
  totalMarks?: number;
  passMarks?: number;
  canStart?: boolean;
  eligibilityMessage?: string;
  activeAttemptId?: string;
  resultAttemptId?: string;
  integrityNotice?: string;
};
export type ExamResult = {
  attemptId: string;
  examTitle: string;
  score: number;
  totalMarks: number;
  percentage?: number;
  grade?: string;
  publishedAt?: string;
  verificationCode?: string;
  canDispute?: boolean;
  reportAvailable?: boolean;
  sections?: { title: string; score: number; totalMarks: number; feedback?: string }[];
};
export type Verification = {
  status: "VALID" | "SUPERSEDED" | "REVOKED" | "NOT_FOUND";
  examTitle?: string;
  institution?: string;
  issuedAt?: string;
  percentage?: number;
  maskedName?: string;
  replacementCode?: string;
};
export type Dispute = {
  id: string;
  examTitle: string;
  status: string;
  reason: string;
  createdAt: string;
  canWithdraw?: boolean;
  timeline?: { id: string; message: string; at: string }[];
};
type Envelope<T> = { data: T };
export async function examGet<T>(path: string, signal?: AbortSignal, auth = true) {
  const result = await apiRequest<Envelope<T>>(path, { signal, auth });
  if (!result || typeof result !== "object" || !("data" in result)) {
    throw new Error("The server returned an unexpected response.");
  }
  return result.data;
}
export async function examWrite<T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown, idempotencyKey?: string) {
  const result = await apiRequest<Envelope<T> | null>(path, { method, body, idempotencyKey });
  return result?.data;
}
export function display(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export const segment = encodeURIComponent;
export function newOperationKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, "0")).join("");
}
export function formatDate(date?: string) {
  if (!date) return "—";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
