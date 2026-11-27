import { changePasswordBody, forgotPasswordBody, loginBody, resetPasswordBody } from "../schemas/auth.schema";
import * as c from "../controllers/auth.controller";
import { createRouter } from "../lib/router";
import { loginIpLimiter, passwordResetLimiter, refreshLimiter } from "../middlewares/rate-limit.middleware";

const r = createRouter("Auth");

r.post("/auth/login", { summary: "Sign in with email and password", access: "public", body: loginBody, limiter: loginIpLimiter }, c.login);
r.post("/auth/refresh", { summary: "Rotate the refresh token (cookie) and get a new access token", access: "public", limiter: refreshLimiter, pre: [c.requireXhrHeader] }, c.refresh);
r.post("/auth/logout", { summary: "Revoke the current session", access: "public", pre: [c.requireXhrHeader] }, c.logout);
r.post("/auth/logout-all", { summary: "Revoke all sessions of the current user", access: "any" }, c.logoutAll);
r.get("/auth/me", { summary: "Current profile, role and preferences", access: "any", allowMustChangePassword: true }, c.me);
r.post("/auth/change-password", { summary: "Change password (invalidates other sessions)", access: "any", allowMustChangePassword: true, body: changePasswordBody }, c.changePassword);
r.post("/auth/forgot-password", { summary: "Request a single-use password reset link", access: "public", body: forgotPasswordBody, limiter: passwordResetLimiter }, c.forgotPassword);
r.post("/auth/reset-password", { summary: "Reset password with a single-use token", access: "public", body: resetPasswordBody, limiter: passwordResetLimiter }, c.resetPassword);
r.get("/time", { summary: "Server time (for clock-offset display only)", access: "public" }, c.serverTime);

export default r.router;
