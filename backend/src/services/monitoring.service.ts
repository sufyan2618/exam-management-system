import { HEARTBEAT_GAP_SECONDS } from "../config/constants";
import { escapeRegex, pageMeta, pageParams } from "../lib/pagination";
import { computeStatus } from "../lib/exam-status";
import { remainingSeconds } from "../lib/time";
import { Answer, Attempt, IntegrityEvent, Interruption } from "../models/attempt.model";
import { Enrollment, Exam } from "../models/exam.model";
import { User } from "../models/user.model";
import { isExaminerOf } from "../policies/exam.policy";
import type { AuthUser } from "../types/express";
import { forbidden, notFound } from "../utils/errors";
import { INTEGRITY_DISCLAIMER, integrityBand } from "./integrity.service";
import { toInterruptionDto } from "./resilience.service";

async function examForMonitor(user: AuthUser, examId: string) {
  const exam = await Exam.findById(examId).select("title ownerId coExaminerIds status startsAt endsAt durationMinutes totalMarks").lean();
  if (!exam) throw notFound("Exam");
  if (user.role === "ADMIN") return exam;
  if (user.role !== "EXAMINER" || !isExaminerOf(exam, user.userId)) throw notFound("Exam");
  return exam;
}

/** Examiner/admin access to a real (non-sandbox) attempt. Admins are read-only. */
export async function loadAttemptForExaminer(user: AuthUser, attemptId: string, write: boolean) {
  const attempt = await Attempt.findOne({ _id: attemptId, isSandbox: false }).lean();
  if (!attempt) throw notFound("Attempt");
  const exam = await Exam.findById(attempt.examId).select("ownerId coExaminerIds").lean();
  if (!exam) throw notFound("Attempt");
  if (user.role === "ADMIN") {
    if (write) throw forbidden();
    return attempt;
  }
  if (user.role !== "EXAMINER" || !isExaminerOf(exam, user.userId)) throw notFound("Attempt");
  return attempt;
}

export async function monitorSummary(user: AuthUser, examId: string) {
  const exam = await examForMonitor(user, examId);
  const now = new Date();
  const onlineSince = new Date(now.getTime() - HEARTBEAT_GAP_SECONDS * 1000);
  const [enrolled, byStatus, online, openEvents, interruptions] = await Promise.all([
    Enrollment.countDocuments({ examId, status: "ENROLLED" }),
    Attempt.aggregate([{ $match: { examId: exam._id, isSandbox: false } }, { $group: { _id: "$status", n: { $sum: 1 }, candidates: { $addToSet: "$candidateId" } } }]),
    Attempt.countDocuments({ examId, isSandbox: false, status: "IN_PROGRESS", lastSeenAt: { $gte: onlineSince } }),
    IntegrityEvent.aggregate([{ $match: { examId: exam._id, reviewStatus: "OPEN", severity: { $in: ["LOW", "MEDIUM", "HIGH"] } } }, { $group: { _id: "$severity", n: { $sum: 1 } } }]),
    Interruption.countDocuments({ examId, status: "AUTO_RECORDED", endedAt: { $ne: null } }),
  ]);
  const counts = Object.fromEntries(byStatus.map((s: { _id: string; n: number }) => [s._id, s.n]));
  const started = new Set(byStatus.flatMap((s: { candidates: unknown[] }) => s.candidates.map(String))).size;
  const inProgress = counts.IN_PROGRESS ?? 0;
  return {
    examId,
    title: exam.title,
    status: computeStatus(exam, now),
    enrolled,
    notStarted: Math.max(0, enrolled - started),
    inProgress,
    online,
    offline: Math.max(0, inProgress - online),
    submitted: (counts.SUBMITTED ?? 0) + (counts.AUTO_SUBMITTED ?? 0) + (counts.GRADING ?? 0) + (counts.GRADED ?? 0),
    attemptsByStatus: counts,
    openIntegrityEvents: Object.fromEntries(openEvents.map((e: { _id: string; n: number }) => [e._id, e.n])),
    pendingInterruptionReviews: interruptions,
    serverTime: now.toISOString(),
    disclaimer: INTEGRITY_DISCLAIMER,
  };
}

export interface MonitorQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  q?: string;
  onlyIncidents?: boolean;
}

export async function monitorAttempts(user: AuthUser, examId: string, query: MonitorQuery) {
  await examForMonitor(user, examId);
  const p = pageParams(query);
  const now = new Date();
  const filter: Record<string, unknown> = { examId, isSandbox: false };
  if (query.status) filter.status = query.status;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    const users = await User.find({ role: "CANDIDATE", $or: [{ fullName: rx }, { email: rx }, { registrationNo: rx }] }).select("_id").limit(500).lean();
    filter.candidateId = { $in: users.map((u) => u._id) };
  }
  if (query.onlyIncidents) {
    const ids = await IntegrityEvent.distinct("attemptId", { examId, reviewStatus: "OPEN", severity: { $in: ["LOW", "MEDIUM", "HIGH"] } });
    filter._id = { $in: ids };
  }
  const [rows, total] = await Promise.all([Attempt.find(filter).sort({ startedAt: -1 }).skip(p.skip).limit(p.pageSize).lean(), Attempt.countDocuments(filter)]);
  const ids = rows.map((r) => r._id);
  const [users, answered, events, interruptions] = await Promise.all([
    User.find({ _id: { $in: rows.map((r) => r.candidateId) } }).select("fullName email registrationNo").lean(),
    Answer.aggregate([
      { $match: { attemptId: { $in: ids } } },
      { $group: { _id: "$attemptId", answered: { $sum: { $cond: [{ $or: [{ $gt: [{ $size: "$selectedOptionIds" }, 0] }, { $gt: [{ $strLenCP: { $ifNull: ["$textAnswer", ""] } }, 0] }] }, 1, 0] } } } },
    ]),
    IntegrityEvent.find({ attemptId: { $in: ids } }).select("attemptId type severity reviewStatus").lean(),
    Interruption.aggregate([{ $match: { attemptId: { $in: ids } } }, { $group: { _id: "$attemptId", n: { $sum: 1 }, gap: { $sum: "$gapSeconds" } } }]),
  ]);
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  const aMap = new Map(answered.map((a: { _id: unknown; answered: number }) => [String(a._id), a.answered]));
  const iMap = new Map(interruptions.map((a: { _id: unknown; n: number; gap: number }) => [String(a._id), a]));
  const evMap = new Map<string, typeof events>();
  for (const e of events) evMap.set(String(e.attemptId), [...(evMap.get(String(e.attemptId)) ?? []), e]);
  const online = (r: (typeof rows)[number]) => r.status === "IN_PROGRESS" && r.lastSeenAt != null && now.getTime() - r.lastSeenAt.getTime() <= HEARTBEAT_GAP_SECONDS * 1000;
  return {
    rows: rows.map((r) => {
      const u = uMap.get(String(r.candidateId));
      const attemptEvents = evMap.get(String(r._id)) ?? [];
      const band = integrityBand(attemptEvents);
      const incidentCount = attemptEvents.filter((event) => event.reviewStatus === "OPEN").length;
      const i = iMap.get(String(r._id));
      return {
        attemptId: String(r._id),
        candidate: { id: String(r.candidateId), fullName: u?.fullName ?? null, email: u?.email ?? null, registrationNo: u?.registrationNo ?? null },
        attemptNo: r.attemptNo,
        status: r.status,
        online: online(r),
        startedAt: r.startedAt,
        lastSeenAt: r.lastSeenAt ?? null,
        remainingSeconds: r.status === "IN_PROGRESS" ? remainingSeconds(r.deadlineAt, now) : 0,
        answered: aMap.get(String(r._id)) ?? 0,
        integrity: { band: band.band, score: band.score },
        incidentCount,
        interruptions: { count: i?.n ?? 0, totalGapSeconds: i?.gap ?? 0 },
        creditedSeconds: r.creditedSeconds,
        extraSeconds: r.extraSeconds,
        submittedAt: r.submittedAt ?? null,
        submitReason: r.submitReason ?? null,
      };
    }),
    meta: { ...pageMeta(p, total), serverTime: now.toISOString() },
  };
}

export async function monitorAttemptDetail(user: AuthUser, attemptId: string) {
  const attempt = await loadAttemptForExaminer(user, attemptId, false);
  const now = new Date();
  const [candidate, events, interruptions, answered] = await Promise.all([
    User.findById(attempt.candidateId).select("fullName email registrationNo").lean(),
    IntegrityEvent.find({ attemptId }).sort({ occurredAt: 1 }).limit(1000).lean(),
    Interruption.find({ attemptId }).sort({ startedAt: 1 }).lean(),
    Answer.countDocuments({ attemptId, $or: [{ "selectedOptionIds.0": { $exists: true } }, { textAnswer: { $nin: [null, ""] } }] }),
  ]);
  const band = integrityBand(events);
  return {
    attemptId,
    examId: String(attempt.examId),
    candidate: candidate ? { id: String(candidate._id), fullName: candidate.fullName, email: candidate.email, registrationNo: candidate.registrationNo ?? null } : null,
    status: attempt.status,
    attemptNo: attempt.attemptNo,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    submittedAt: attempt.submittedAt ?? null,
    submitReason: attempt.submitReason ?? null,
    remainingSeconds: attempt.status === "IN_PROGRESS" ? remainingSeconds(attempt.deadlineAt, now) : 0,
    answered,
    lastSeenAt: attempt.lastSeenAt ?? null,
    lastIp: attempt.lastIp ?? null,
    sessionEpoch: attempt.sessionEpoch,
    creditedSeconds: attempt.creditedSeconds,
    extraSeconds: attempt.extraSeconds,
    paperDifficultyIndex: attempt.paperDifficultyIndex ?? null,
    integrity: band,
    events: events.map((e) => ({ id: String(e._id), type: e.type, severity: e.severity, occurredAt: e.occurredAt, meta: e.meta ?? {}, reviewStatus: e.reviewStatus, reviewNote: e.reviewNote ?? null, reviewedAt: e.reviewedAt ?? null })),
    interruptions: interruptions.map(toInterruptionDto),
    serverTime: now.toISOString(),
  };
}

export const monitorChannel = (examId: string) => `exam:${examId}:monitor`;

export async function monitorStreamSnapshot(user: AuthUser, examId: string) {
  return monitorSummary(user, examId);
}
