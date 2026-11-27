import * as c from "../controllers/users.controller";
import { createRouter } from "../lib/router";
import { createUserBody, listUsersQuery, updateUserBody } from "../schemas/user.schema";
import { auditQuery } from "../services/audit.service";
import { idParams } from "../utils/validators";

const r = createRouter("Users & Admin");
const A = ["ADMIN" as const];

r.get("/users", { summary: "List users", access: A, query: listUsersQuery }, c.list);
r.post("/users", { summary: "Create a user with a temporary password", access: A, body: createUserBody }, c.create);
r.get("/users/:id", { summary: "Get a user", access: A, params: idParams }, c.get);
r.patch("/users/:id", { summary: "Update name, role, active flag", access: A, params: idParams, body: updateUserBody }, c.update);
r.post("/users/:id/activate", { summary: "Activate a user", access: A, params: idParams }, c.activate);
r.post("/users/:id/deactivate", { summary: "Deactivate a user and revoke sessions", access: A, params: idParams }, c.deactivate);
r.post("/users/:id/reset-password", { summary: "Admin-initiated password reset", access: A, params: idParams }, c.resetPassword);
r.get("/admin/stats", { summary: "Platform counts and health", access: A }, c.stats);
r.get("/admin/jobs/dead-letter", { summary: "Failed background jobs", access: A }, c.deadLetter);
r.get("/audit-logs", { summary: "Audit log search", access: A, query: auditQuery }, c.auditLogs);
r.get("/audit-logs/verify", { summary: "Verify the audit hash chain", access: A }, c.auditVerify);

export default r.router;
