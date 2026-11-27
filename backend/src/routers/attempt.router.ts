import * as c from "../controllers/attempt.controller";
import { createRouter } from "../lib/router";
import { autosaveLimiter } from "../middlewares/rate-limit.middleware";
import { answerBody, answerParams, batchBody, eventsBody, examIdParams, flagBody, heartbeatBody, meExamsQuery, startAttemptBody } from "../schemas/attempt.schema";
import { preferencesBody, scratchpadBody } from "../services/candidate.service";
import { idParams } from "../utils/validators";

const r = createRouter("Candidate exam delivery");
const C = ["CANDIDATE" as const];
/** Attempt endpoints serve candidates, and examiners for their own sandbox attempts. */
const CE = ["CANDIDATE" as const, "EXAMINER" as const];

r.get("/me/exams", { summary: "Dashboard: available / upcoming / completed exams with access status", access: C, query: meExamsQuery }, c.meExams);
r.get("/me/exams/:examId", { summary: "Exam instructions, rules and eligibility", access: C, params: examIdParams }, c.meExam);
r.get("/me/preferences", { summary: "Workspace preferences (with defaults)", access: "any" }, c.getPreferences);
r.put("/me/preferences", { summary: "Update workspace preferences (allow-listed keys)", access: "any", body: preferencesBody }, c.putPreferences);

r.post("/exams/:examId/attempts", { summary: "Start (or resume) an attempt - idempotent", access: C, params: examIdParams, body: startAttemptBody, idempotent: true }, c.start);
r.post("/exams/:examId/sandbox/attempts", { summary: "Examiner sandbox attempt (isolated from real data)", access: ["EXAMINER" as const], params: examIdParams }, c.startSandbox);
r.delete("/exams/:examId/sandbox/attempts", { summary: "Reset sandbox attempts", access: ["EXAMINER" as const], params: examIdParams }, c.resetSandbox);
r.get("/attempts/:id", { summary: "Attempt state: questions (no keys), saved answers, remaining time", access: CE, params: idParams }, c.get);
r.put("/attempts/:id/answers/:attemptQuestionId", { summary: "Autosave one answer (clientSeq-ordered, idempotent)", access: CE, params: answerParams, body: answerBody, limiter: autosaveLimiter }, c.saveAnswer);
r.put("/attempts/:id/answers\\:batch", { summary: "Flush queued offline answers", access: CE, params: idParams, body: batchBody, limiter: autosaveLimiter }, c.saveBatch);
r.post("/attempts/:id/flags", { summary: "Mark / unmark a question for review", access: CE, params: idParams, body: flagBody }, c.flag);
r.get("/attempts/:id/progress", { summary: "Answered / unanswered / marked counts", access: CE, params: idParams }, c.progress);
r.post("/attempts/:id/submit", { summary: "Final submit (idempotent)", access: CE, params: idParams, idempotent: true }, c.submit);
r.post("/attempts/:id/heartbeat", { summary: "Keep-alive, time sync and announcements since cursor", access: CE, params: idParams, body: heartbeatBody }, c.heartbeat);
r.post("/attempts/:id/events", { summary: "Report integrity / connectivity events (batched, advisory)", access: CE, params: idParams, body: eventsBody }, c.postEvents);
r.post("/attempts/:id/notice-ack", { summary: "Acknowledge the integrity notice", access: C, params: idParams }, c.ackNotice);
r.get("/attempts/:id/scratchpad", { summary: "Read the scratchpad", access: CE, params: idParams }, c.getScratchpad);
r.put("/attempts/:id/scratchpad", { summary: "Save the scratchpad (<=100 KB, last-write-wins)", access: CE, params: idParams, body: scratchpadBody }, c.putScratchpad);
r.get("/attempts/:id/stream", { summary: "SSE: announcements, time warnings, status", access: CE, params: idParams }, c.stream);

export default r.router;
