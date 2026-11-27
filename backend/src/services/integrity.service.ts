import type { IntegrityEventType } from "../config/constants";
import { Answer, Attempt, AttemptQuestion, IntegrityEvent } from "../models/attempt.model";
import { Exam } from "../models/exam.model";
import { User } from "../models/user.model";
import { isExaminerOf } from "../policies/exam.policy";
import type { AuthUser } from "../types/express";
import { notFound } from "../utils/errors";
import { median } from "../lib/scoring";
import { logger } from "../lib/logger";
import { audit } from "./audit.service";

export const INTEGRITY_NOTICE =
  "This exam records limited integrity indicators (for example tab or window switches, copy/paste actions and connection changes). " +
  "No camera, microphone, screenshots or keystroke content are captured. Indicators are advisory only and are reviewed by a human examiner; " +
  "they are not evidence of misconduct and never cause automatic penalties.";

export const INTEGRITY_DISCLAIMER = "Indicators for human review - not evidence of misconduct.";

const SEVERITY: Partial<Record<IntegrityEventType, "INFO" | "LOW" | "MEDIUM">> = {
  TAB_HIDDEN: "LOW",
  WINDOW_BLUR: "INFO",
  FULLSCREEN_EXIT: "LOW",
  COPY: "INFO",
  CUT: "INFO",
  PASTE: "LOW",
  PASTE_LARGE: "MEDIUM",
  CONTEXT_MENU: "INFO",
  MULTI_SESSION: "MEDIUM",
  IP_CHANGE: "LOW",
  FAST_ANSWER: "LOW",
  TYPING_ANOMALY: "LOW",
  RECONNECT: "INFO",
  SIMILARITY_WRITTEN: "MEDIUM",
  SIMILARITY_WRONG_PATTERN: "MEDIUM",
};

const WEIGHT: Record<string, number> = { INFO: 0.2, LOW: 1, MEDIUM: 3 };

export interface ClientEvent {
  type: IntegrityEventType;
  occurredAt?: Date;
  meta?: Record<string, unknown>;
}

export async function recordServerEvent(attempt: { _id: unknown; examId: unknown }, type: IntegrityEventType, meta: Record<string, unknown> = {}, at = new Date()) {
  await IntegrityEvent.create({ attemptId: attempt._id, examId: attempt.examId, type, severity: SEVERITY[type] ?? "INFO", meta, occurredAt: at, receivedAt: new Date() });
}

/** Records a batch of client-reported events, minimising what is stored (no content, only type/time/counts). */
export async function recordClientEvents(attempt: { _id: unknown; examId: unknown; startedAt: Date }, events: ClientEvent[], now = new Date()) {
  const docs = events.map((e) => {
    let type = e.type;
    const meta: Record<string, unknown> = {};
    if (typeof e.meta?.durationMs === "number") meta.durationMs = Math.min(e.meta.durationMs, 3_600_000);
    if (typeof e.meta?.length === "number") meta.length = Math.min(e.meta.length, 1_000_000);
    if (typeof e.meta?.count === "number") meta.count = Math.min(e.meta.count, 1000);
    if (type === "PASTE" && typeof meta.length === "number" && meta.length > 500) type = "PASTE_LARGE";
    // clamp client timestamps into the attempt's lifetime so events cannot be back- or forward-dated
    let occurred = e.occurredAt ?? now;
    if (occurred > now) occurred = now;
    if (occurred < attempt.startedAt) occurred = attempt.startedAt;
    return { attemptId: attempt._id, examId: attempt.examId, type, severity: SEVERITY[type] ?? "INFO", meta, occurredAt: occurred, receivedAt: now };
  });
  if (docs.length) await IntegrityEvent.insertMany(docs, { ordered: false });
  return docs.length;
}

export interface BandInput {
  type: string;
  severity: string;
  reviewStatus?: string;
}

/** Weighted tally -> attention band. A review aid, never a probability of cheating. */
export function integrityBand(events: BandInput[]) {
  const active = events.filter((e) => e.reviewStatus !== "DISMISSED");
  const score = active.reduce((a, e) => a + (WEIGHT[e.severity] ?? 0), 0);
  const band = score >= 20 ? "HIGH" : score >= 8 ? "MEDIUM" : "LOW";
  const counts: Record<string, number> = {};
  for (const e of active) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return { band, score: Math.round(score * 10) / 10, counts, disclaimer: INTEGRITY_DISCLAIMER };
}

export async function reviewEvent(user: AuthUser, eventId: string, input: { status: "REVIEWED" | "DISMISSED" | "CONFIRMED"; note: string }) {
  const ev = await IntegrityEvent.findById(eventId);
  if (!ev) throw notFound("Integrity event");
  const exam = await Exam.findById(ev.examId).select("ownerId coExaminerIds").lean();
  if (!exam || !isExaminerOf(exam, user.userId)) throw notFound("Integrity event");
  const before = { reviewStatus: ev.reviewStatus };
  ev.reviewStatus = input.status;
  ev.reviewNote = input.note;
  ev.reviewerId = user.userId as never;
  ev.reviewedAt = new Date();
  await ev.save();
  await audit({ action: "integrity.review", entityType: "integrity_event", entityId: ev._id, before, after: { reviewStatus: ev.reviewStatus, note: input.note }, meta: { attemptId: String(ev.attemptId) } });
  return { id: String(ev._id), reviewStatus: ev.reviewStatus, reviewNote: ev.reviewNote, reviewedAt: ev.reviewedAt, disclaimer: INTEGRITY_DISCLAIMER };
}

// ---- post-exam analysis -------------------------------------------------------------------------

const shingles = (text: string, n = 3) => {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const set = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) set.add(words.slice(i, i + n).join(" "));
  return set;
};
export const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

/**
 * Runs after an exam completes. Produces advisory events only:
 *  - per-question answer-speed outliers (z-score vs. the question's cohort median)
 *  - near-duplicate written answers across candidates (3-gram Jaccard)
 *  - identical wrong-option patterns across candidate pairs
 */
export async function runPostExamAnalysis(examId: string) {
  const attempts = await Attempt.find({ examId, isSandbox: false, status: { $in: ["SUBMITTED", "AUTO_SUBMITTED", "GRADING", "GRADED"] } }).select("_id examId candidateId").lean();
  if (attempts.length < 2) return { flagged: 0 };
  await IntegrityEvent.deleteMany({ examId, type: { $in: ["SIMILARITY_WRITTEN", "SIMILARITY_WRONG_PATTERN", "FAST_ANSWER"] }, reviewStatus: "OPEN", "meta.source": "post_exam" });
  const attemptIds = attempts.map((a) => a._id);
  const [aqs, answers] = await Promise.all([
    AttemptQuestion.find({ attemptId: { $in: attemptIds } }).select("attemptId type questionId marks").lean(),
    Answer.find({ attemptId: { $in: attemptIds } }).select("attemptId attemptQuestionId questionId type textAnswer selectedOptionIds finalScore timeSpentSeconds").lean(),
  ]);
  const aqMap = new Map(aqs.map((a) => [String(a._id), a]));
  const events: any[] = [];
  const now = new Date();
  const mk = (attemptId: unknown, type: IntegrityEventType, meta: Record<string, unknown>) =>
    events.push({ attemptId, examId, type, severity: SEVERITY[type] ?? "INFO", meta: { ...meta, source: "post_exam" }, occurredAt: now, receivedAt: now });

  // 1) speed outliers
  const byQuestion = new Map<string, number[]>();
  for (const a of answers) if (typeof a.timeSpentSeconds === "number" && a.timeSpentSeconds >= 0) byQuestion.set(String(a.questionId), [...(byQuestion.get(String(a.questionId)) ?? []), a.timeSpentSeconds]);
  const fastCount = new Map<string, number>();
  for (const a of answers) {
    const times = byQuestion.get(String(a.questionId));
    if (!times || times.length < 10 || typeof a.timeSpentSeconds !== "number") continue;
    const med = median(times);
    const sd = Math.sqrt(times.reduce((s, t) => s + (t - med) ** 2, 0) / times.length) || 1;
    if (med >= 15 && (a.timeSpentSeconds - med) / sd < -2 && a.timeSpentSeconds <= 0.15 * med) fastCount.set(String(a.attemptId), (fastCount.get(String(a.attemptId)) ?? 0) + 1);
  }
  for (const [attemptId, n] of fastCount) if (n >= 5) mk(attemptId, "FAST_ANSWER", { questionsFlagged: n });

  // 2) similar written answers
  const written = answers.filter((a) => a.type === "WRITTEN" && (a.textAnswer?.length ?? 0) >= 120);
  const byQ = new Map<string, typeof written>();
  for (const a of written) byQ.set(String(a.questionId), [...(byQ.get(String(a.questionId)) ?? []), a]);
  const simPairs = new Map<string, number>();
  for (const list of byQ.values()) {
    const sh = list.map((a) => shingles(a.textAnswer!));
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const s = jaccard(sh[i]!, sh[j]!);
        if (s >= 0.8) {
          const k = `${list[i]!.attemptId}|${list[j]!.attemptId}`;
          simPairs.set(k, Math.max(simPairs.get(k) ?? 0, s));
        }
      }
  }
  for (const [k, s] of simPairs) {
    const [a, b] = k.split("|");
    mk(a, "SIMILARITY_WRITTEN", { otherAttempt: "anonymised", similarity: Math.round(s * 100) / 100 });
    mk(b, "SIMILARITY_WRITTEN", { otherAttempt: "anonymised", similarity: Math.round(s * 100) / 100 });
  }

  // 3) identical wrong-answer patterns
  // option ids differ per paper (they are snapshots), so map them back to the original option id first
  const optionTextMap = new Map<string, string>();
  for (const aq of await AttemptQuestion.find({ attemptId: { $in: attemptIds }, type: { $ne: "WRITTEN" } }).select("options").lean()) {
    for (const o of aq.options) optionTextMap.set(String(o._id), `${String(o.optionId)}`);
  }
  const canon = new Map<string, Set<string>>();
  for (const a of answers) {
    const aq = aqMap.get(String(a.attemptQuestionId));
    if (!aq || aq.type === "WRITTEN" || !a.selectedOptionIds?.length || (a.finalScore ?? 0) >= aq.marks) continue;
    const sig = `${String(a.questionId)}:${a.selectedOptionIds.map((o) => optionTextMap.get(String(o)) ?? "").sort().join("+")}`;
    const key = String(a.attemptId);
    if (!canon.has(key)) canon.set(key, new Set());
    canon.get(key)!.add(sig);
  }
  const keys = [...canon.keys()];
  const flaggedPatterns = new Map<string, number>();
  if (keys.length <= 1500) {
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        const A = canon.get(keys[i]!)!;
        const B = canon.get(keys[j]!)!;
        const min = Math.min(A.size, B.size);
        if (min < 5) continue;
        let shared = 0;
        for (const s of A) if (B.has(s)) shared++;
        if (shared >= 5 && shared / min >= 0.7) {
          flaggedPatterns.set(keys[i]!, Math.max(flaggedPatterns.get(keys[i]!) ?? 0, shared));
          flaggedPatterns.set(keys[j]!, Math.max(flaggedPatterns.get(keys[j]!) ?? 0, shared));
        }
      }
  }
  for (const [attemptId, shared] of flaggedPatterns) mk(attemptId, "SIMILARITY_WRONG_PATTERN", { sharedWrongAnswers: shared });

  if (events.length) await IntegrityEvent.insertMany(events);
  logger.info("post-exam integrity analysis", { examId, flagged: events.length });
  return { flagged: events.length };
}

export async function candidateLabel(candidateId: unknown) {
  const u = await User.findById(candidateId).select("fullName registrationNo").lean();
  return u ? { fullName: u.fullName, registrationNo: u.registrationNo ?? null } : null;
}