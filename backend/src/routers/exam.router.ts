import * as c from "../controllers/exam.controller";
import { createRouter } from "../lib/router";
import {
  announcementBody,
  announcementsQuery,
  autoSelectBody,
  createExamBody,
  enrollBody,
  examCandidateParams,
  listEnrollmentsQuery,
  listExamsQuery,
  patchEnrollmentBody,
  publishBody,
  setQuestionsBody,
  updateExamBody,
} from "../schemas/exam.schema";
import { idParams } from "../utils/validators";

const r = createRouter("Exams");
const E = ["EXAMINER" as const];
const EA = ["EXAMINER" as const, "ADMIN" as const];

r.post("/exams", { summary: "Create a draft exam", access: E, body: createExamBody }, c.create);
r.get("/exams", { summary: "List exams (own; admin: all)", access: EA, query: listExamsQuery }, c.list);
r.get("/exams/:id", { summary: "Exam detail", access: EA, params: idParams }, c.get);
r.patch("/exams/:id", { summary: "Edit exam (If-Match, lock rules)", access: E, params: idParams, body: updateExamBody }, c.update);
r.delete("/exams/:id", { summary: "Delete a draft exam", access: E, params: idParams }, c.remove);
r.put("/exams/:id/questions", { summary: "Set the ordered question list with marks and optional blueprint", access: E, params: idParams, body: setQuestionsBody }, c.setQuestions);
r.post("/exams/:id/questions/auto-select", { summary: "Pick questions from the bank by category/difficulty quotas", access: E, params: idParams, body: autoSelectBody }, c.autoSelect);
r.get("/exams/:id/preview", { summary: "Validation report and readiness checklist", access: EA, params: idParams }, c.preview);
r.post("/exams/:id/publish", { summary: "Publish (runs all validations)", access: E, params: idParams, body: publishBody }, c.publish);
r.post("/exams/:id/unpublish", { summary: "Return to draft if no attempts exist", access: E, params: idParams }, c.unpublish);
r.post("/exams/:id/close", { summary: "Close early and finalize active attempts", access: E, params: idParams }, c.close);
r.post("/exams/:id/archive", { summary: "Archive a completed exam", access: E, params: idParams }, c.archive);

r.get("/exams/:id/enrollments", { summary: "Enrollments with attempt status", access: EA, params: idParams, query: listEnrollmentsQuery }, c.listEnrollments);
r.post("/exams/:id/enrollments", { summary: "Enroll candidates by id or email (idempotent)", access: E, params: idParams, body: enrollBody, idempotent: true }, c.enroll);
r.patch("/exams/:id/enrollments/:cid", { summary: "Accommodations / block (audited)", access: E, params: examCandidateParams, body: patchEnrollmentBody }, c.patchEnrollment);
r.delete("/exams/:id/enrollments/:cid", { summary: "Withdraw if no attempt exists", access: E, params: examCandidateParams }, c.withdraw);

r.post("/exams/:id/announcements", { summary: "Broadcast to candidates", access: E, params: idParams, body: announcementBody }, c.createAnnouncement);
r.get("/exams/:id/announcements", { summary: "Announcements (examiners; enrolled candidates)", access: ["EXAMINER", "ADMIN", "CANDIDATE"], params: idParams, query: announcementsQuery }, c.listAnnouncements);

export default r.router;
