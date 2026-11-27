import * as c from "../controllers/monitoring.controller";
import { createRouter } from "../lib/router";
import { notificationsQuery } from "../services/notification.service";
import { extendTimeBody, forceSubmitBody, interruptionParams, monitorListQuery, reviewEventBody, reviewInterruptionBody } from "../schemas/attempt.schema";
import { idParams } from "../utils/validators";

import { openSse } from "../lib/sse";

const r = createRouter("Monitoring");
const E = ["EXAMINER" as const];
const EA = ["EXAMINER" as const, "ADMIN" as const];

r.get("/exams/:id/monitor/summary", { summary: "Live counts: enrolled, online, submitted, open flags", access: EA, params: idParams }, c.summary);
r.get("/exams/:id/monitor/attempts", { summary: "Per-candidate live table", access: EA, params: idParams, query: monitorListQuery }, c.attemptsTable);
r.get("/exams/:id/monitor/stream", { summary: "SSE: live monitoring updates", access: EA, params: idParams }, c.stream);
r.get("/attempts/:id/monitor", { summary: "Attempt detail with integrity timeline (advisory)", access: EA, params: idParams }, c.detail);
r.post("/attempts/:id/extend-time", { summary: "Extend one attempt's time (audited)", access: E, params: idParams, body: extendTimeBody }, c.extendTime);
r.post("/attempts/:id/force-submit", { summary: "Force-submit an attempt (audited)", access: E, params: idParams, body: forceSubmitBody }, c.forceSubmit);
r.patch("/integrity-events/:id", { summary: "Review / dismiss an integrity event", access: E, params: idParams, body: reviewEventBody }, c.reviewEvent);
r.get("/attempts/:id/interruptions", { summary: "Detected interruptions for an attempt", access: EA, params: idParams }, c.listInterruptions);
r.post("/attempts/:id/interruptions/:iid/review", { summary: "Approve (credit) or reject an interruption", access: E, params: interruptionParams, body: reviewInterruptionBody }, c.reviewInterruption);

r.get("/me/notifications/stream", {summary:"Live user notifications",access:"any"}, async(req,res)=>openSse(req,res,{userId:req.user!.userId,channels:[`user:${req.user!.userId}`],hello:[{type:"hello",data:{connected:true}}]}));
r.get("/me/notifications", { summary: "My notifications", access: "any", query: notificationsQuery }, c.notifications);
r.patch("/me/notifications/:id/read", { summary: "Mark a notification read", access: "any", params: idParams }, c.readNotification);
r.patch("/me/notifications/read-all", { summary: "Mark all my notifications read", access: "any" }, c.readAllNotifications);

export default r.router;
