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
  questions?: {attemptQuestionId:string;stem:string;marks:number;score:number;answered:boolean;textAnswer?:string;feedback?:string;explanation?:string;options?:{label:string;text:string;selected:boolean;isCorrect?:boolean}[]}[];
  sections?: { title: string; score: number; totalMarks: number; feedback?: string }[];
};
export type Verification = {
  valid?: boolean;
  status: "VALID" | "SUPERSEDED" | "REVOKED" | "UNKNOWN" | "NOT_FOUND";
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
  return adapt(result.data) as T;
}
export async function examWrite<T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown, idempotencyKey?: string, version?: number, options: { keepalive?: boolean } = {}) {
  let sessionEpoch: number | undefined;
  if (body && typeof body === "object" && "sessionEpoch" in body) {
    const {sessionEpoch: epoch, ...rest} = body as Record<string, unknown>;
    sessionEpoch = typeof epoch === "number" ? epoch : undefined; body = rest;
  }
  const result = await apiRequest<Envelope<T> | null>(path, { method, body, idempotencyKey, sessionEpoch, version, ...options });
  return adapt(result?.data) as T | undefined;
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

// Translate API records into the display model at the feature boundary.
function adapt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(adapt);
  if (!value || typeof value !== "object") return value;
  // API DTOs vary by resource; this adapter preserves their fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = value as Record<string, any>;
  if (Array.isArray(r.questions) && "minSampleForFlags" in r) return r.questions.map(adapt);
  if (Array.isArray(r.flat)) return r.flat.map(adapt);
  if (r.users && !Array.isArray(r.users) && typeof r.users === "object") return {...r, users:Object.values(r.users).reduce((sum:number,n) => sum+Number(n),0), exams:Object.values(r.exams ?? {}).reduce((sum:number,n)=>sum+Number(n),0), queuedJobs:r.queue?.waiting, database:r.health?.mongo};
  if (r.readiness) return {...r, canPublish:r.readiness.ready, checks:(r.readiness.checklist ?? []).map((check: {key:string;status:string;message:string}) => ({id:check.key,label:check.message,passed:check.status === "PASS"}))};
  return { ...r, attemptId: r.attemptId ?? r.attempt?.id, id: r.id ?? r._id ?? r.examId ?? r.answerId ?? r.attemptId ?? r.questionId,
    title: r.title ?? r.type, read: r.readAt != null, message: r.message ?? r.payload?.message,
    validCount: r.validRows, invalidCount: r.errorRows, appliedCount: r.appliedRows, totalRows: r.totalRows,
    atomic: r.atomic, failureReason: r.failureReason, canCommit: r.status === "PREVIEW",
    errors: Array.isArray(r.errors) ? r.errors.map((e: {reason?:string;message?:string}) => ({...e,message:e.message ?? e.reason})) : r.errors,
    question: r.stem, answer: r.textAnswer, candidateName: r.fullName ?? r.candidate?.fullName ?? r.candidate?.alias,
    distribution:r.distribution?.map((b:{from:number;to:number;count:number})=>({...b,range:`${b.from}–${b.to}%`})), correctRate:r.pValue,skipRate:r.omitRate,
    mean:r.score?.mean, median:r.score?.median, completionRate:r.participationRate,
    state: r.status, score: r.totalScore ?? r.score, grade: r.gradeLabel,
    canStart: r.access?.canEnter, eligibilityMessage: r.access?.message,
    activeAttemptId: r.attempts?.activeAttemptId ?? (Array.isArray(r.attempts) ? r.attempts.find((a: {status:string}) => a.status === "IN_PROGRESS")?.id : undefined), resultAttemptId: r.result?.attemptId,
    canDispute: r.dispute?.open, reportAvailable: r.attemptId != null,
    replacementCode: r.supersededBy, canWithdraw: r.status === "OPEN", timeline:r.events?.map((e: {at:string;action:string;note?:string},i:number)=>({id:String(i),at:e.at,message:e.note ?? e.action})),
    name: r.name ?? r.fullName ?? r.candidate?.fullName, active: r.isActive,
    canPublish: r.readiness?.ready, checks: r.readiness?.checklist ?? r.checks,
  };
}
