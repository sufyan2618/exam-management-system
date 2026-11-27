import type { NextFunction, Request, Response } from "express";
import type { Role } from "../config/constants";
import { getContext } from "../lib/context";
import { Session, User } from "../models/user.model";
import { AppError, forbidden, unauthorized } from "../utils/errors";
import { verifyAccessToken } from "../utils/jwt";

export interface AuthOptions {
  /** Allow users who must still change their temporary password (e.g. change-password, me, logout). */
  allowMustChangePassword?: boolean;
}

export function requireAuth(options: AuthOptions = {}) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization;
      if (!header || !header.startsWith("Bearer ")) throw unauthorized();
      const token = header.slice(7).trim();

      let payload;
      try {
        payload = verifyAccessToken(token);
      } catch (err) {
        const expired = (err as Error).name === "TokenExpiredError";
        throw unauthorized(expired ? "Access token expired" : "Invalid access token", expired ? "AUTH_TOKEN_EXPIRED" : "AUTH_INVALID_TOKEN");
      }

      const [user, session] = await Promise.all([
        User.findById(payload.sub).select("email fullName role isActive tokenVersion mustChangePassword").lean(),
        Session.exists({ _id: payload.sid, userId: payload.sub, revokedAt: null }),
      ]);
      if (!user || !user.isActive || user.tokenVersion !== payload.ver || !session) {
        throw unauthorized("Session is no longer valid", "AUTH_INVALID_TOKEN");
      }
      if (user.mustChangePassword && !options.allowMustChangePassword) {
        throw new AppError(403, "PASSWORD_CHANGE_REQUIRED", "You must change your temporary password before continuing");
      }

      req.user = {
        userId: String(user._id),
        role: user.role as Role,
        sessionId: payload.sid,
        email: user.email,
        fullName: user.fullName,
      };
      const ctx = getContext();
      if (ctx) {
        ctx.userId = req.user.userId;
        ctx.role = req.user.role;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(forbidden());
      return;
    }
    next();
  };
}
