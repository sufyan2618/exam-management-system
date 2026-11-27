import { env } from "../config/env";
import { randomToken, sha256 } from "../lib/crypto";
import { redis } from "../lib/redis";
import { addEmailJob } from "../queues/email.queue";
import { Session, User, type UserDoc } from "../models/user.model";
import type { ChangePasswordInput, LoginInput, ResetPasswordInput } from "../schemas/auth.schema";
import { AppError, notFound, unauthorized } from "../utils/errors";
import { signAccessToken } from "../utils/jwt";
import { dummyVerify, hashPassword, verifyPasswordHash } from "../utils/password";
import { UserPreference } from "../models/system.model";
import { audit } from "./audit.service";
import { toUserDto } from "./users.service";

interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

const FAIL_LIMIT = 5;
const FAIL_WINDOW_S = 15 * 60;

async function issueSession(user: UserDoc, client: ClientInfo, familyId?: string) {
  const refreshToken = randomToken(32);
  const session = await Session.create({
    userId: user._id,
    refreshHash: sha256(refreshToken),
    familyId: familyId ?? randomToken(12),
    userAgent: client.userAgent?.slice(0, 300),
    ip: client.ip,
    expiresAt: new Date(Date.now() + env.REFRESH_TTL_DAYS * 86_400_000),
  });
  const accessToken = signAccessToken({
    userId: String(user._id),
    role: user.role,
    sessionId: String(session._id),
    tokenVersion: user.tokenVersion,
  });
  return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, session };
}

async function recordFailure(email: string, ip: string) {
  const failKey = `login:fail:${email}:${ip}`;
  const n = await redis.incr(failKey);
  if (n === 1) await redis.expire(failKey, FAIL_WINDOW_S);
  if (n >= FAIL_LIMIT) {
    const lcKey = `login:lc:${email}`;
    const lockCount = await redis.incr(lcKey);
    await redis.expire(lcKey, 86_400);
    const ttl = Math.min(FAIL_WINDOW_S * 2 ** (lockCount - 1), 86_400);
    await redis.set(`login:lock:${email}:${ip}`, "1", "EX", ttl);
    await redis.del(failKey);
    await audit({ action: "auth.lockout", entityType: "user", entityId: email, meta: { ip, lockSeconds: ttl } });
    throw new AppError(423, "AUTH_ACCOUNT_LOCKED", "Too many failed attempts. Try again later.", { headers: { "Retry-After": String(ttl) } });
  }
}

export async function login(input: LoginInput, client: ClientInfo) {
  const ip = client.ip ?? "unknown";
  const lockTtl = await redis.ttl(`login:lock:${input.email}:${ip}`);
  if (lockTtl > 0) {
    throw new AppError(423, "AUTH_ACCOUNT_LOCKED", "Too many failed attempts. Try again later.", { headers: { "Retry-After": String(lockTtl) } });
  }

  const user = await User.findOne({ email: input.email });
  if (!user) {
    await dummyVerify(input.password);
    await recordFailure(input.email, ip);
    throw unauthorized("Invalid credentials", "AUTH_INVALID_CREDENTIALS");
  }
  const valid = await verifyPasswordHash(input.password, user.passwordHash);
  if (!valid || !user.isActive) {
    await recordFailure(input.email, ip);
    throw unauthorized("Invalid credentials", "AUTH_INVALID_CREDENTIALS");
  }

  await redis.del(`login:fail:${input.email}:${ip}`, `login:lc:${input.email}`);
  user.lastLoginAt = new Date();
  await user.save();
  const tokens = await issueSession(user, client);
  return { tokens, user: toUserDto(user) };
}

export async function refresh(rawToken: string | undefined, client: ClientInfo) {
  if (!rawToken) throw unauthorized("Refresh token missing", "AUTH_INVALID_TOKEN");
  const existing = await Session.findOne({ refreshHash: sha256(rawToken) });
  if (!existing) throw unauthorized("Invalid refresh token", "AUTH_INVALID_TOKEN");

  if (existing.revokedAt) {
    // A token that was just rotated may legitimately be replayed by a second tab; anything older is theft.
    const recentlyRotated = existing.replacedBy && Date.now() - existing.revokedAt.getTime() < 10_000;
    if (recentlyRotated) throw new AppError(401, "AUTH_TOKEN_EXPIRED", "Refresh token was just rotated; retry", { retryable: true });
    await Session.updateMany({ familyId: existing.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await audit({ action: "auth.refresh_reuse_detected", entityType: "session", entityId: existing._id, actor: { userId: String(existing.userId) } });
    throw unauthorized("Refresh token reuse detected; please sign in again", "AUTH_TOKEN_REUSED");
  }
  if (existing.expiresAt.getTime() < Date.now()) throw unauthorized("Refresh token expired", "AUTH_TOKEN_EXPIRED");

  const user = await User.findById(existing.userId);
  if (!user || !user.isActive) throw unauthorized("Account unavailable", "AUTH_INVALID_TOKEN");

  const claimed = await Session.findOneAndUpdate({ _id: existing._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  if (!claimed) throw new AppError(401, "AUTH_TOKEN_EXPIRED", "Refresh token was just rotated; retry", { retryable: true });

  const tokens = await issueSession(user, client, existing.familyId);
  await Session.updateOne({ _id: existing._id }, { $set: { replacedBy: tokens.session._id } });
  return tokens;
}

export async function logoutByRefresh(rawToken: string | undefined) {
  if (!rawToken) return;
  await Session.updateOne({ refreshHash: sha256(rawToken), revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function me(userId: string) {
  const [user, pref] = await Promise.all([User.findById(userId), UserPreference.findOne({ userId }).lean()]);
  if (!user) throw notFound("User");
  return { ...toUserDto(user), preferences: pref?.workspace ?? {} };
}

export async function changePassword(userId: string, input: ChangePasswordInput, client: ClientInfo) {
  const user = await User.findById(userId);
  if (!user) throw notFound("User");
  if (!(await verifyPasswordHash(input.currentPassword, user.passwordHash))) {
    throw new AppError(401, "AUTH_INVALID_CREDENTIALS", "Current password is incorrect");
  }
  user.passwordHash = await hashPassword(input.newPassword);
  user.mustChangePassword = false;
  user.tokenVersion += 1;
  await user.save();
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await audit({ action: "auth.password_changed", entityType: "user", entityId: user._id });
  return { tokens: await issueSession(user, client), user: toUserDto(user) };
}

export async function forgotPassword(emailAddr: string) {
  const user = await User.findOne({ email: emailAddr });
  if (!user || !user.isActive) return; // never reveal whether the account exists
  const token = randomToken(32);
  user.resetTokenHash = sha256(token);
  user.resetTokenExpiry = new Date(Date.now() + 30 * 60_000);
  await user.save();
  const link = `${env.CLIENT_URL.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  await addEmailJob({ to: user.email, template: "reset_password", vars: { fullName: user.fullName, link } });
}

export async function resetPassword(input: ResetPasswordInput) {
  const user = await User.findOne({ resetTokenHash: sha256(input.token), resetTokenExpiry: { $gt: new Date() } });
  if (!user) throw new AppError(400, "AUTH_INVALID_RESET_TOKEN", "Reset link is invalid or has expired");
  user.passwordHash = await hashPassword(input.newPassword);
  user.resetTokenHash = undefined;
  user.resetTokenExpiry = undefined;
  user.mustChangePassword = false;
  user.tokenVersion += 1;
  await user.save();
  await Session.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await audit({ action: "auth.password_reset", entityType: "user", entityId: user._id, actor: { userId: String(user._id), role: user.role } });
}
