import { z } from "zod";
import { computeStatus } from "../lib/exam-status";
import { pageMeta, pageParams } from "../lib/pagination";
import { publish } from "../lib/sse";
import { Attempt } from "../models/attempt.model";
import { Announcement, Enrollment, Exam } from "../models/exam.model";
import { User } from "../models/user.model";
import { isExaminerOf, loadManagedExam } from "../policies/exam.policy";
import type { announcementBody, enrollBody, listEnrollmentsQuery, patchEnrollmentBody } from "../schemas/exam.schema";
import type { AuthUser } from "../types/express";
import { conflict, notFound } from "../utils/errors";
import { audit } from "./audit.service";
import { notify } from "./notification.service";

export async function listEnrollments(user: AuthUser, examId: string, query: z.infer<typeof listEnrollmentsQuery>) {
  const exam = await loadManagedExam(user, examId, "read");
  const p = pageParams(query);
  const filter: Record<string, unknown> = { examId: exam._id };
  if (query.status) filter.status = query.status;
  const [rows, total] = await Promise.all([
    Enrollment.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.pageSize).lean(),
    Enrollment.countDocuments(filter),
  ]);
  const candidateIds = rows.map((r) => r.candidateId);
  const [users, attempts] = await Promise.all([
    User.find({ _id: { $in: candidateIds } }).select("fullName email registrationNo").lean(),
    Attempt.find({ examId: exam._id, candidateId: { $in: candidateIds }, isSandbox: false }).select("candidateId status attemptNo submittedAt totalScore").sort({ attemptNo: 1 }).lean(),
  ]);
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  const aMap = new Map<string, typeof attempts>();
  for (const a of attempts) aMap.set(String(a.candidateId), [...(aMap.get(String(a.candidateId)) ?? []), a]);
  const data = rows.map((r) => {
    const u = uMap.get(String(r.candidateId));
    const list = aMap.get(String(r.candidateId)) ?? [];
    const latest = list[list.length - 1];
    return {
      id: String(r._id),
      candidateId: String(r.candidateId),
      fullName: u?.fullName,
      email: u?.email,
      registrationNo: u?.registrationNo ?? null,
      status: r.status,
      extraTimeMinutes: r.extraTimeMinutes,
      extraAttempts: r.extraAttempts,
      attemptCount: list.length,
      attemptStatus: latest?.status ?? "NOT_STARTED",
      enrolledAt: r.createdAt,
    };
  });
  return { rows: data, meta: pageMeta(p, total) };
}

export async function enroll(user: AuthUser, examId: string, input: z.infer<typeof enrollBody>) {
  const exam = await loadManagedExam(user, examId, "write");
  if (["ARCHIVED"].includes(exam.status) || computeStatus(exam, new Date()) === "COMPLETED") throw conflict("Cannot enroll candidates in a finished exam", "EXAM_WINDOW_CLOSED");

  const byId = input.candidateIds?.length ? await User.find({ _id: { $in: input.candidateIds }, role: "CANDIDATE", isActive: true }).select("_id email").lean() : [];
  const byEmail = input.emails?.length ? await User.find({ email: { $in: input.emails }, role: "CANDIDATE", isActive: true }).select("_id email").lean() : [];
  const found = new Map([...byId, ...byEmail].map((u) => [String(u._id), u]));
  const notFoundKeys = [
    ...(input.candidateIds ?? []).filter((id) => !found.has(id)),
    ...(input.emails ?? []).filter((e) => !byEmail.some((u) => u.email === e)),
  ];

  const ids = [...found.keys()];
  const existing = await Enrollment.find({ examId: exam._id, candidateId: { $in: ids } }).lean();
  const existingMap = new Map(existing.map((e) => [String(e.candidateId), e]));
  const toCreate = ids.filter((id) => !existingMap.has(id));
  const toReactivate = existing.filter((e) => e.status === "WITHDRAWN").map((e) => e._id);

  if (toCreate.length) {
    await Enrollment.insertMany(toCreate.map((candidateId) => ({ examId: exam._id, candidateId, enrolledBy: user.userId })), { ordered: false }).catch((e) => {
      if (e?.code !== 11000 && !e?.writeErrors?.every((w: any) => w.code === 11000)) throw e;
    });
  }
  if (toReactivate.length) await Enrollment.updateMany({ _id: { $in: toReactivate } }, { $set: { status: "ENROLLED" } });

  if (exam.status !== "DRAFT") {
    await Promise.all(toCreate.map((c) => notify(c, "enrolled", { examId, title: exam.title, startsAt: exam.startsAt }).catch(() => undefined)));
  }
  await audit({ action: "enrollment.add", entityType: "exam", entityId: exam._id, meta: { added: toCreate.length, reactivated: toReactivate.length } });
  return {
    enrolled: toCreate.length + toReactivate.length,
    alreadyEnrolled: existing.length - toReactivate.length,
    notFound: notFoundKeys,
  };
}

async function loadEnrollment(examId: unknown, candidateId: string) {
  const e = await Enrollment.findOne({ examId, candidateId });
  if (!e) throw notFound("Enrollment");
  return e;
}

export async function withdraw(user: AuthUser, examId: string, candidateId: string) {
  const exam = await loadManagedExam(user, examId, "write");
  const e = await loadEnrollment(exam._id, candidateId);
  if (await Attempt.exists({ examId: exam._id, candidateId, isSandbox: false })) throw conflict("Candidate already has an attempt; block instead of withdrawing", "ATTEMPT_ALREADY_ACTIVE");
  e.status = "WITHDRAWN";
  await e.save();
  await audit({ action: "enrollment.withdraw", entityType: "enrollment", entityId: e._id, meta: { examId, candidateId } });
}

export async function patchEnrollment(user: AuthUser, examId: string, candidateId: string, input: z.infer<typeof patchEnrollmentBody>) {
  const exam = await loadManagedExam(user, examId, "write");
  const e = await loadEnrollment(exam._id, candidateId);
  const before = { extraTimeMinutes: e.extraTimeMinutes, extraAttempts: e.extraAttempts, status: e.status };
  if (input.extraTimeMinutes !== undefined) e.extraTimeMinutes = input.extraTimeMinutes;
  if (input.extraAttempts !== undefined) e.extraAttempts = input.extraAttempts;
  if (input.status !== undefined) e.status = input.status as never;
  await e.save();
  await audit({ action: "enrollment.update", entityType: "enrollment", entityId: e._id, before, after: { extraTimeMinutes: e.extraTimeMinutes, extraAttempts: e.extraAttempts, status: e.status }, meta: { reason: input.reason } });
  return { id: String(e._id), status: e.status, extraTimeMinutes: e.extraTimeMinutes, extraAttempts: e.extraAttempts };
}

// ---- announcements ----------------------------------------------------------------------------

export async function createAnnouncement(user: AuthUser, examId: string, input: z.infer<typeof announcementBody>) {
  const exam = await loadManagedExam(user, examId, "write");
  if (exam.status === "DRAFT") throw conflict("Publish the exam before sending announcements", "EXAM_NOT_PUBLISHED");
  const bumped = await Exam.findByIdAndUpdate(exam._id, { $inc: { announcementSeq: 1 } }, { new: true }).select("announcementSeq").lean();
  const a = await Announcement.create({ examId: exam._id, authorId: user.userId, message: input.message, priority: input.priority, seq: bumped!.announcementSeq });
  const dto = toAnnouncementDto(a.toObject());
  await publish(`exam:${examId}`, { type: "announcement", data: dto, id: dto.seq });
  await audit({ action: "announcement.create", entityType: "exam", entityId: exam._id, meta: { seq: dto.seq } });
  return dto;
}

export const toAnnouncementDto = (a: Record<string, any>) => ({ id: String(a._id), seq: a.seq, message: a.message, priority: a.priority, createdAt: a.createdAt });

export async function listAnnouncements(user: AuthUser, examId: string, since = 0) {
  if (user.role === "CANDIDATE") {
    const enrolled = await Enrollment.exists({ examId, candidateId: user.userId, status: "ENROLLED" });
    const exam = await Exam.findById(examId).select("status").lean();
    if (!enrolled || !exam || exam.status === "DRAFT") throw notFound("Exam");
  } else {
    const exam = await Exam.findById(examId).select("ownerId coExaminerIds").lean();
    if (!exam || (user.role === "EXAMINER" && !isExaminerOf(exam, user.userId))) throw notFound("Exam");
  }
  const rows = await Announcement.find({ examId, seq: { $gt: since } }).sort({ seq: 1 }).limit(200).lean();
  return rows.map(toAnnouncementDto);
}
