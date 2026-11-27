import type { Request, Response } from "express";
import { env } from "../config/env";
import { send } from "../lib/http";
import * as auth from "../services/auth.service";
import { clearAuthCookie, getRefreshCookie, setRefreshTokenCookie } from "../utils/jwt";
import { AppError } from "../utils/errors";

const client = (req: Request) => ({ ip: req.ip, userAgent: req.header("user-agent") });

/** CSRF defence in depth for cookie-authenticated routes: SameSite=Strict + a custom header. */
export function requireXhrHeader(req: Request, _res: Response, next: (err?: unknown) => void) {
  if (!req.header("x-requested-with")) {
    next(new AppError(403, "CSRF_CHECK_FAILED", "Missing X-Requested-With header"));
    return;
  }
  next();
}

export async function login(req: Request, res: Response) {
  const { tokens, user } = await auth.login(req.body, client(req));
  setRefreshTokenCookie(res, tokens.refreshToken);
  send(res, { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, user: { id: user.id, fullName: user.fullName, role: user.role, mustChangePassword: user.mustChangePassword } });
}

export async function refresh(req: Request, res: Response) {
  const tokens = await auth.refresh(getRefreshCookie(req), client(req));
  setRefreshTokenCookie(res, tokens.refreshToken);
  send(res, { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn });
}

export async function logout(req: Request, res: Response) {
  await auth.logoutByRefresh(getRefreshCookie(req));
  clearAuthCookie(res);
  send(res, { loggedOut: true });
}

export async function logoutAll(req: Request, res: Response) {
  await auth.revokeAllSessions(req.user!.userId);
  clearAuthCookie(res);
  send(res, { loggedOut: true });
}

export async function me(req: Request, res: Response) {
  send(res, await auth.me(req.user!.userId));
}

export async function changePassword(req: Request, res: Response) {
  const { tokens, user } = await auth.changePassword(req.user!.userId, req.body, client(req));
  setRefreshTokenCookie(res, tokens.refreshToken);
  send(res, { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, user: { id: user.id, fullName: user.fullName, role: user.role, mustChangePassword: false } });
}

export async function forgotPassword(req: Request, res: Response) {
  await auth.forgotPassword(req.body.email);
  send(res, { message: "If an account exists for that email, a reset link has been sent." }, { status: 202 });
}

export async function resetPassword(req: Request, res: Response) {
  await auth.resetPassword(req.body);
  send(res, { message: "Password updated. Please sign in." });
}

export function serverTime(_req: Request, res: Response) {
  send(res, { serverTime: new Date().toISOString(), monotonicMs: Math.round(performance.now()), env: env.NODE_ENV === "production" ? undefined : env.NODE_ENV });
}
