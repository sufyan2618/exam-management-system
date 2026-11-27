import type { Role } from "../config/constants";

export interface AuthUser {
  userId: string;
  role: Role;
  sessionId: string;
  email: string;
  fullName: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

export {};
