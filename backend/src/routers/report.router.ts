import type { Request, Response } from "express";
import { z } from "zod";
import { send } from "../lib/http";
import { createRouter } from "../lib/router";
import { verifyLimiter } from "../middlewares/rate-limit.middleware";
import { verifyCode } from "../services/results.service";
import * as rep from "../services/report.service";
import { attemptIdParams } from "../schemas/grading.schema";
import { idParams } from "../utils/validators";

const r = createRouter("Reports & verification");
const EA = ["EXAMINER" as const, "ADMIN" as const];

function sendPdf(res: Response, out: { buffer: Buffer; filename: string; contentHash: string }) {
  res.status(200);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
  res.setHeader("X-Content-SHA256", out.contentHash);
  res.setHeader("Cache-Control", "private, no-store");
  res.end(out.buffer);
}

r.get("/exams/:id/report.pdf", { summary: "Exam report (PDF)", access: EA, params: idParams }, async (req: Request, res: Response) => sendPdf(res, await rep.examReportPdf(req.user!, req.params.id as string)));
r.get("/exams/:id/results.csv", { summary: "Results export (CSV, formula-injection safe)", access: EA, params: idParams }, async (req: Request, res: Response) => {
  const out = await rep.resultsCsv(req.user!, req.params.id as string);
  res.status(200);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.end(out.csv);
});
r.get("/attempts/:id/report.pdf", { summary: "Attempt result report with QR (examiner)", access: EA, params: idParams }, async (req: Request, res: Response) => sendPdf(res, await rep.attemptReportForExaminer(req.user!, req.params.id as string)));
r.get("/me/results/:attemptId/report.pdf", { summary: "My published result report with QR", access: ["CANDIDATE"], params: attemptIdParams }, async (req: Request, res: Response) => sendPdf(res, await rep.attemptReportForCandidate(req.user!, req.params.attemptId as string)));

r.get("/verify/:code", { summary: "Public: verify a result code (masked name only)", access: "public", params: z.object({ code: z.string().min(8).max(32) }).strict(), limiter: verifyLimiter }, async (req: Request, res: Response) => {
  send(res, await verifyCode(req.params.code as string));
});

export default r.router;
