import type { Request, Response } from "express";
import { send } from "../lib/http";
import { createRouter } from "../lib/router";
import { importLimiter } from "../middlewares/rate-limit.middleware";
import { requireFile, uploadSingle } from "../middlewares/upload.middleware";
import * as svc from "../services/import.service";
import { idParams } from "../utils/validators";

const r = createRouter("Bulk import");
const A = ["ADMIN" as const];
const E = ["EXAMINER" as const];
const AE = ["ADMIN" as const, "EXAMINER" as const];
const upload = [uploadSingle("file"), requireFile];

function sendCsv(res: Response, csv: string, filename: string) {
  res.status(200);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.end("\uFEFF" + csv);
}

r.post("/imports/candidates", { summary: "Import candidates from CSV/JSON (dry-run by default)", access: A, limiter: importLimiter, pre: upload, body: svc.importOptions }, async (req: Request, res: Response) => {
  const job = await svc.createImport(req.user!, "CANDIDATES", req.file!, req.body);
  send(res, job, { status: job.status === "APPLYING" ? 202 : 200 });
});
r.post("/imports/questions", { summary: "Import questions from CSV/JSON (dry-run by default)", access: E, limiter: importLimiter, pre: upload, body: svc.importOptions }, async (req: Request, res: Response) => {
  const job = await svc.createImport(req.user!, "QUESTIONS", req.file!, req.body);
  send(res, job, { status: job.status === "APPLYING" ? 202 : 200 });
});
r.get("/imports", { summary: "My recent imports", access: AE }, async (req: Request, res: Response) => send(res, await svc.listImports(req.user!)));
r.get("/imports/templates/candidates.csv", { summary: "Candidate CSV template", access: A }, async (_req: Request, res: Response) => sendCsv(res, svc.importTemplate("CANDIDATES"), "candidates-template.csv"));
r.get("/imports/templates/questions.csv", { summary: "Question CSV template", access: E }, async (_req: Request, res: Response) => sendCsv(res, svc.importTemplate("QUESTIONS"), "questions-template.csv"));
r.get("/imports/:id", { summary: "Import status, counts and row errors", access: AE, params: idParams }, async (req: Request, res: Response) => send(res, await svc.getImport(req.user!, req.params.id as string)));
r.post("/imports/:id/commit", { summary: "Commit a validated dry-run", access: AE, params: idParams, idempotent: true }, async (req: Request, res: Response) => send(res, await svc.commitImport(req.user!, req.params.id as string), { status: 202 }));
r.get("/imports/:id/errors.csv", { summary: "Row errors as CSV", access: AE, params: idParams }, async (req: Request, res: Response) => sendCsv(res, await svc.importErrorsCsv(req.user!, req.params.id as string), `import-${req.params.id}-errors.csv`));
r.get("/imports/:id/credentials.csv", { summary: "One-time temporary credentials sheet", access: A, params: idParams }, async (req: Request, res: Response) => sendCsv(res, await svc.importCredentialsCsv(req.user!, req.params.id as string), `import-${req.params.id}-credentials.csv`));

export default r.router;
