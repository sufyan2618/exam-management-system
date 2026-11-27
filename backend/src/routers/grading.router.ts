import { z } from "zod";
import * as c from "../controllers/grading.controller";
import { createRouter } from "../lib/router";
import { attemptIdParams, gradeBody, gradingQueueQuery, keyOverrideBody, keyOverrideParams, moderationBody, publishResultsBody, regradeBody, resultsListQuery, unpublishResultsBody } from "../schemas/grading.schema";
import { boolQuery, idParams, text } from "../utils/validators";

const r = createRouter("Grading & results");
const E = ["EXAMINER" as const];
const EA = ["EXAMINER" as const, "ADMIN" as const];

r.get("/exams/:id/grading/queue", { summary: "Written answers awaiting grading (blind by default)", access: EA, params: idParams, query: gradingQueueQuery }, c.queue);
r.get("/exams/:id/grading/status", { summary: "Grading progress per question", access: EA, params: idParams }, c.status);
r.get("/answers/:id", { summary: "One answer with rubric and revision history", access: EA, params: idParams, query: z.object({ blind: boolQuery.optional() }).strict() }, c.getAnswer);
r.put("/answers/:id/grade", { summary: "Grade a written answer (0..marks, 0.25 steps; audited, revisioned)", access: E, params: idParams, body: gradeBody }, c.grade);
r.post("/exams/:id/regrade", { summary: "Re-run auto-grading for all finalized attempts", access: E, params: idParams, body: regradeBody }, c.regrade);
r.get("/exams/:id/key-overrides", { summary: "Answer-key overrides", access: EA, params: idParams }, c.listOverrides);
r.put("/exams/:id/questions/:questionId/key-override", { summary: "Accept all / alternate key / void question, then regrade", access: E, params: keyOverrideParams, body: keyOverrideBody }, c.putOverride);
r.delete("/exams/:id/questions/:questionId/key-override", { summary: "Remove an override and regrade", access: E, params: keyOverrideParams, body: z.object({ reason: text(5, 1000) }).strict() }, c.deleteOverride);
r.patch("/exams/:id/moderation", { summary: "Apply a transparent additive moderation offset", access: E, params: idParams, body: moderationBody }, c.moderation);

r.get("/exams/:id/results", { summary: "Results table with rank and verification codes", access: EA, params: idParams, query: resultsListQuery }, c.listResults);
r.post("/exams/:id/results/publish", { summary: "Publish results (all, or selected candidates)", access: E, params: idParams, body: publishResultsBody }, c.publish);
r.post("/exams/:id/results/unpublish", { summary: "Unpublish results (revokes codes)", access: E, params: idParams, body: unpublishResultsBody }, c.unpublish);

r.get("/me/results", { summary: "My published results", access: ["CANDIDATE"], }, c.myResults);
r.get("/me/results/:attemptId", { summary: "Detailed published result with review", access: ["CANDIDATE"], params: attemptIdParams }, c.myResult);

export default r.router;
