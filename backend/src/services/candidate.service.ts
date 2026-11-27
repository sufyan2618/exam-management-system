import { z } from "zod";
import { MAX_SCRATCHPAD_BYTES } from "../config/constants";
import { computeStatus, evaluateAccess } from "../lib/exam-status";
import { Attempt, Scratchpad } from "../models/attempt.model";
import { Enrollment, Exam } from "../models/exam.model";
import { Result } from "../models/result.model";
import { UserPreference } from "../models/system.model";
import type { AuthUser } from "../types/express";
import { notFound, unprocessable } from "../utils/errors";
import { liveAttempt, loadOwnAttempt } from "./attempt.service";
import { INTEGRITY_NOTICE } from "./integrity.service";

// ---- dashboard -----------------------------------------------------------------------------------------

export async function listMyExams(user: AuthUser, bucket?: "available" | "upcoming" | "completed") {
  const now = new Date();
  const enrollments = await Enrollment.find({ candidateId: user.userId, status: "ENROLLED" }).lean();
  if (!enrollments.length) return [];
  const exams = await Exam.find({ _id: { $in: enrollments.map((e) => e.examId) }, status: { $ne: "DRAFT" } }).select("-questions -blueprint -keyOverrides").lean();
  const [attempts, results] = await Promise.all([
    Attempt.find({ candidateId: user.userId, isSandbox: false, examId: { $in: exams.map((e) => e._id) } }).select("examId status attemptNo").lean(),
    Result.find({ candidateId: user.userId, isPublished: true, examId: { $in: exams.map((e) => e._id) } }).select("examId attemptId").lean(),
  ]);
  const eMap = new Map(enrollments.map((e) => [String(e.examId), e]));
  const out = exams.map((exam) => {
    const enrollment = eMap.get(String(exam._id))!;
    const mine = attempts.filter((a) => String(a.examId) === String(exam._id) && a.status !== "VOID");
    const active = mine.find((a) => a.status === "IN_PROGRESS");
    const decision = evaluateAccess(exam as never, enrollment, mine.length, now);
    const published = results.find((r) => String(r.examId) === String(exam._id));
    let b: "available" | "upcoming" | "completed";
    if (active || decision.canEnter) b = "available";
    else if (now < exam.startsAt) b = "upcoming";
    else b = "completed";
    const target = now < decision.opensAt ? decision.opensAt : decision.closesAt;
    return {
      bucket: b,
      examId: String(exam._id),
      title: exam.title,
      status: computeStatus(exam, now),
      startsAt: exam.startsAt,
      endsAt: exam.endsAt,
      durationMinutes: exam.durationMinutes,
      totalMarks: exam.totalMarks,
      access: { canEnter: Boolean(active) || decision.canEnter, code: active ? undefined : decision.code, message: active ? "Attempt in progress; you can resume." : decision.message, opensAt: decision.opensAt, closesAt: decision.closesAt, countdownSeconds: Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 1000)) },
      attempts: { used: mine.length, max: exam.maxAttempts + (enrollment.extraAttempts ?? 0), activeAttemptId: active ? String(active._id) : null },
      result: published ? { attemptId: String(published.attemptId), published: true } : { published: false },
      serverTime: now.toISOString(),
    };
  });
  const filtered = bucket ? out.filter((o) => o.bucket === bucket) : out;
  return filtered.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export async function getMyExam(user: AuthUser, examId: string) {
  const now = new Date();
  const [exam, enrollment] = await Promise.all([Exam.findById(examId).select("-questions -blueprint -keyOverrides").lean(), Enrollment.findOne({ examId, candidateId: user.userId, status: "ENROLLED" }).lean()]);
  if (!exam || exam.status === "DRAFT" || !enrollment) throw notFound("Exam");
  const mine = await Attempt.find({ examId, candidateId: user.userId, isSandbox: false, status: { $ne: "VOID" } }).select("status attemptNo startedAt submittedAt").sort({ attemptNo: 1 }).lean();
  const active = mine.find((a) => a.status === "IN_PROGRESS");
  const decision = evaluateAccess(exam as never, enrollment, mine.length, now);
  return {
    examId: String(exam._id),
    title: exam.title,
    instructions: exam.instructions,
    status: computeStatus(exam, now),
    startsAt: exam.startsAt,
    endsAt: exam.endsAt,
    durationMinutes: exam.durationMinutes + enrollment.extraTimeMinutes,
    extraTimeMinutes: enrollment.extraTimeMinutes,
    totalMarks: exam.totalMarks,
    passMarks: exam.passMarks ?? null,
    rules: { negativeMarking: exam.negativeMarking, multiSelectScheme: exam.multiSelectScheme, shuffleQuestions: exam.shuffleQuestions, shuffleOptions: exam.shuffleOptions, maxAttempts: exam.maxAttempts + enrollment.extraAttempts, lateEntryMinutes: exam.lateEntryMinutes },
    integrityNotice: exam.integrityLevel !== "OFF" ? INTEGRITY_NOTICE : null,
    access: { canEnter: Boolean(active) || decision.canEnter, code: active ? undefined : decision.code, message: active ? "Attempt in progress; you can resume." : decision.message, opensAt: decision.opensAt, closesAt: decision.closesAt },
    attempts: mine.map((a) => ({ id: String(a._id), attemptNo: a.attemptNo, status: a.status, startedAt: a.startedAt, submittedAt: a.submittedAt ?? null })),
    serverTime: now.toISOString(),
  };
}

// ---- scratchpad --------------------------------------------------------------------------------------------

export const scratchpadBody = z
  .object({ content: z.string().max(MAX_SCRATCHPAD_BYTES), strokes: z.any().optional(), clientUpdatedAt: z.coerce.date().optional() })
  .strict();

export async function getScratchpad(user: AuthUser, attemptId: string) {
  const attempt = await loadOwnAttempt(user, attemptId);
  const pad = await Scratchpad.findOne({ attemptId: attempt._id }).lean();
  return { content: pad?.content ?? "", strokes: pad?.strokes ?? null, updatedAt: pad?.updatedAt ?? null, editable: attempt.status === "IN_PROGRESS" };
}

export async function putScratchpad(user: AuthUser, attemptId: string, input: z.infer<typeof scratchpadBody>, epoch?: number) {
  const now = new Date();
  await liveAttempt(user, attemptId, now, { epoch });
  const size = Buffer.byteLength(input.content, "utf8") + (input.strokes ? Buffer.byteLength(JSON.stringify(input.strokes), "utf8") : 0);
  if (size > MAX_SCRATCHPAD_BYTES) throw unprocessable("Scratchpad exceeds 100 KB", "VALIDATION_FAILED", [{ field: "content", issue: "Too large" }]);
  const clientAt = input.clientUpdatedAt ?? now;
  // last-write-wins by client timestamp
  try {
    const pad = await Scratchpad.findOneAndUpdate(
      { attemptId, $or: [{ clientUpdatedAt: { $lte: clientAt } }, { clientUpdatedAt: null }] },
      { $set: { content: input.content, strokes: input.strokes ?? null, clientUpdatedAt: clientAt } },
      { upsert: true, new: true },
    ).lean();
    return { saved: true, updatedAt: pad?.updatedAt, serverTime: now.toISOString() };
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return { saved: false, stale: true, serverTime: now.toISOString() };
    throw err;
  }
}

// ---- preferences -------------------------------------------------------------------------------------------

export const preferencesBody = z
  .object({
    theme: z.enum(["light", "dark", "contrast"]),
    fontScale: z.number().min(0.875).max(1.5),
    layout: z.enum(["single", "split"]),
    navigatorPosition: z.enum(["left", "right", "bottom"]),
    showTimer: z.boolean(),
    reducedMotion: z.boolean(),
    autoAdvance: z.boolean(),
    colorBlindPalette: z.boolean(),
    scratchpadDock: z.enum(["right", "bottom", "floating"]),
  })
  .partial()
  .strict();

export const DEFAULT_PREFERENCES = {
  theme: "light",
  fontScale: 1,
  layout: "single",
  navigatorPosition: "right",
  showTimer: true,
  reducedMotion: false,
  autoAdvance: false,
  colorBlindPalette: false,
  scratchpadDock: "right",
} as const;

export async function getPreferences(userId: string) {
  const pref = await UserPreference.findOne({ userId }).lean();
  return { ...DEFAULT_PREFERENCES, ...((pref?.workspace as object | undefined) ?? {}) };
}

export async function putPreferences(userId: string, input: z.infer<typeof preferencesBody>) {
  const current = await getPreferences(userId);
  const merged = { ...current, ...input };
  await UserPreference.findOneAndUpdate({ userId }, { $set: { workspace: merged } }, { upsert: true });
  return merged;
}
