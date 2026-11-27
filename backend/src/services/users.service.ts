import { env } from "../config/env";
import { randomPassword } from "../lib/crypto";
import { buildSort, escapeRegex, pageMeta, pageParams } from "../lib/pagination";
import { Attempt } from "../models/attempt.model";
import { Dispute } from "../models/dispute.model";
import { Exam } from "../models/exam.model";
import { Session, User, type UserDoc } from "../models/user.model";
import { addEmailJob } from "../queues/email.queue";
import { jobsQueue } from "../queues/jobs.queue";
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from "../schemas/user.schema";
import { conflict, forbidden, notFound } from "../utils/errors";
import { hashPassword } from "../utils/password";
import { audit } from "./audit.service";
import mongoose from "mongoose";

export function toUserDto(u: Pick<UserDoc, "email" | "fullName" | "role" | "isActive" | "mustChangePassword" | "createdAt"> & { _id: unknown; registrationNo?: string | null; lastLoginAt?: Date | null }) {
  return {
    id: String(u._id),
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    registrationNo: u.registrationNo ?? null,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: u.createdAt,
  };
}

export async function listUsers(query: ListUsersQuery) {
  const p = pageParams(query);
  const filter: Record<string, unknown> = {};
  if (query.role) filter.role = query.role;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [{ email: rx }, { fullName: rx }, { registrationNo: rx }];
  }
  const sort = buildSort(query.sort, ["createdAt", "fullName", "email", "role", "lastLoginAt"], { createdAt: -1 });
  const [rows, total] = await Promise.all([
    User.find(filter).sort(sort).skip(p.skip).limit(p.pageSize).lean(),
    User.countDocuments(filter),
  ]);
  return { rows: rows.map(toUserDto), meta: pageMeta(p, total) };
}

export async function getUser(id: string) {
  const u = await User.findById(id).lean();
  if (!u) throw notFound("User");
  return toUserDto(u);
}

export async function createUser(input: CreateUserInput) {
  if (await User.exists({ email: input.email })) throw conflict("A user with this email already exists", "CONFLICT", [{ field: "email", issue: "Already in use" }]);
  const tempPassword = randomPassword();
  const user = await User.create({
    email: input.email,
    fullName: input.fullName,
    role: input.role,
    registrationNo: input.registrationNo,
    passwordHash: await hashPassword(tempPassword),
    mustChangePassword: true,
  });
  if (input.sendEmail) {
    await addEmailJob({ to: user.email, template: "welcome_credentials", vars: { fullName: user.fullName, email: user.email, tempPassword, loginUrl: `${env.CLIENT_URL}/login` } });
  }
  await audit({ action: "user.create", entityType: "user", entityId: user._id, after: { email: user.email, role: user.role } });
  return { user: toUserDto(user), temporaryPassword: tempPassword };
}

async function activeAdminCount() {
  return User.countDocuments({ role: "ADMIN", isActive: true });
}

async function assertNotLastAdmin(target: { _id: unknown; role: string; isActive: boolean }, becomesNonAdminOrInactive: boolean) {
  if (target.role === "ADMIN" && target.isActive && becomesNonAdminOrInactive && (await activeAdminCount()) <= 1) {
    throw conflict("The last active administrator cannot be demoted or deactivated", "LAST_ADMIN");
  }
}

async function revokeSessions(userId: unknown) {
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function updateUser(actorId: string, id: string, input: UpdateUserInput) {
  const user = await User.findById(id);
  if (!user) throw notFound("User");
  const before = { fullName: user.fullName, role: user.role, isActive: user.isActive, registrationNo: user.registrationNo };
  const isSelf = String(user._id) === actorId;

  const roleChange = input.role !== undefined && input.role !== user.role;
  const deactivating = input.isActive === false && user.isActive;
  if (isSelf && (roleChange || deactivating)) throw forbidden("You cannot change your own role or deactivate yourself", "SELF_MODIFICATION");
  await assertNotLastAdmin(user, roleChange || deactivating);

  if (input.fullName !== undefined) user.fullName = input.fullName;
  if (input.registrationNo !== undefined) user.registrationNo = input.registrationNo ?? undefined;
  if (input.role !== undefined) user.role = input.role;
  if (input.isActive !== undefined) user.isActive = input.isActive;
  const needsRevocation = roleChange || deactivating;
  if (needsRevocation) user.tokenVersion += 1;
  await user.save();
  if (needsRevocation) await revokeSessions(user._id);

  await audit({ action: "user.update", entityType: "user", entityId: user._id, before, after: { fullName: user.fullName, role: user.role, isActive: user.isActive, registrationNo: user.registrationNo } });
  return toUserDto(user);
}

export async function setActive(actorId: string, id: string, active: boolean) {
  return updateUser(actorId, id, { isActive: active });
}

export async function adminResetPassword(id: string) {
  const user = await User.findById(id);
  if (!user) throw notFound("User");
  const tempPassword = randomPassword();
  user.passwordHash = await hashPassword(tempPassword);
  user.mustChangePassword = true;
  user.tokenVersion += 1;
  await user.save();
  await revokeSessions(user._id);
  await audit({ action: "user.admin_reset_password", entityType: "user", entityId: user._id });
  return { temporaryPassword: tempPassword };
}

export async function adminStats() {
  const [byRole, byStatus, activeAttempts, openDisputes, overdueDisputes, queueCounts] = await Promise.all([
    User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
    Exam.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Attempt.countDocuments({ status: "IN_PROGRESS", isSandbox: false }),
    Dispute.countDocuments({ status: { $in: ["OPEN", "UNDER_REVIEW", "ESCALATED"] } }),
    Dispute.countDocuments({ status: { $in: ["OPEN", "UNDER_REVIEW", "ESCALATED"] }, slaDueAt: { $lt: new Date() } }),
    jobsQueue.getJobCounts("waiting", "active", "delayed", "failed").catch(() => ({})),
  ]);
  return {
    users: Object.fromEntries(byRole.map((r) => [r._id, r.count])),
    exams: Object.fromEntries(byStatus.map((r) => [r._id, r.count])),
    activeAttempts,
    disputes: { open: openDisputes, overdue: overdueDisputes },
    queue: queueCounts,
    health: { mongo: mongoose.connection.readyState === 1 ? "up" : "down" },
  };
}

export async function deadLetterJobs() {
  const failed = await jobsQueue.getFailed(0, 49);
  return failed.map((j) => ({ id: j.id, name: j.name, failedReason: j.failedReason, attemptsMade: j.attemptsMade, timestamp: j.timestamp, data: j.data }));
}
