import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { env } from "../config/env";
import type { Role } from "../config/constants";

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  sid: string;
  ver: number;
  tokenType: "access";
  iat?: number;
  exp?: number;
}

export function signAccessToken(input: { userId: string; role: Role; sessionId: string; tokenVersion: number }) {
  return jwt.sign(
    { sub: input.userId, role: input.role, sid: input.sessionId, ver: input.tokenVersion, tokenType: "access" },
    env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: env.ACCESS_TOKEN_TTL_SECONDS },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }) as AccessTokenPayload;
  if (decoded.tokenType !== "access") throw new Error("Invalid token type");
  return decoded;
}

export const REFRESH_COOKIE = "refreshToken";
const COOKIE_PATH = "/api/v1/auth";

export function setRefreshTokenCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "strict",
    path: COOKIE_PATH,
    domain: env.COOKIE_DOMAIN,
    maxAge: env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "strict",
    path: COOKIE_PATH,
    domain: env.COOKIE_DOMAIN,
  });
}

export const getRefreshCookie = (req: Request): string | undefined => req.cookies?.[REFRESH_COOKIE];
