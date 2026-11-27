import type { Request, Response } from "express";
import { z } from "zod";
import { send } from "../lib/http";
import { createRouter } from "../lib/router";
import { commentBody, createDisputeBody, disputeAttemptParams, disputeListQuery, resolveBody } from "../schemas/dispute.schema";
import * as d from "../services/dispute.service";
import { fairnessReport } from "../services/fairness.service";
import { idParams, text } from "../utils/validators";

const r = createRouter("Disputes & fairness");
const C = ["CANDIDATE" as const];
const E = ["EXAMINER" as const];
const EA = ["EXAMINER" as const, "ADMIN" as const];
const ALL = ["CANDIDATE" as const, "EXAMINER" as const, "ADMIN" as const];
const id = (req: Request) => req.params.id as string;

r.post("/me/results/:attemptId/disputes", { summary: "Raise a dispute (within the window, max 3 open per exam)", access: C, params: disputeAttemptParams, body: createDisputeBody, idempotent: true }, async (req: Request, res: Response) =>
  send(res, await d.createDispute(req.user!, req.params.attemptId as string, req.body), { status: 201 }),
);
r.get("/me/disputes", { summary: "My disputes", access: C }, async (req: Request, res: Response) => send(res, await d.listMyDisputes(req.user!)));
r.post("/disputes/:id/withdraw", { summary: "Withdraw an open dispute", access: C, params: idParams }, async (req: Request, res: Response) => send(res, await d.withdrawDispute(req.user!, id(req))));

r.get("/disputes/:id", { summary: "Dispute detail with timeline", access: ALL, params: idParams }, async (req: Request, res: Response) => send(res, await d.getDispute(req.user!, id(req))));
r.post("/disputes/:id/comments", { summary: "Add a comment", access: ALL, params: idParams, body: commentBody }, async (req: Request, res: Response) => send(res, await d.addComment(req.user!, id(req), req.body), { status: 201 }));

r.get("/exams/:id/disputes", { summary: "Disputes for an exam (SLA ordered)", access: EA, params: idParams, query: disputeListQuery }, async (req: Request, res: Response) => {
  const { rows, meta } = await d.listExamDisputes(req.user!, id(req), req.query as never);
  send(res, rows, { meta });
});
r.post("/disputes/:id/review", { summary: "Start reviewing a dispute", access: E, params: idParams }, async (req: Request, res: Response) => send(res, await d.startReview(req.user!, id(req))));
r.post("/disputes/:id/escalate", { summary: "Escalate to an administrator", access: E, params: idParams, body: z.object({ note: text(3, 1000).optional() }).strict() }, async (req: Request, res: Response) => send(res, await d.escalate(req.user!, id(req), req.body.note)));
r.post("/disputes/:id/resolve", { summary: "Resolve (grading fix, key policy or re-attempt); four-eyes when re-scoring own grading", access: E, params: idParams, body: resolveBody }, async (req: Request, res: Response) => send(res, await d.resolveDispute(req.user!, id(req), req.body)));
r.post("/disputes/:id/countersign", { summary: "Countersign a proposed resolution", access: EA, params: idParams }, async (req: Request, res: Response) => send(res, await d.countersign(req.user!, id(req))));
r.post("/disputes/:id/reject-proposal", { summary: "Reject a proposed resolution", access: EA, params: idParams, body: z.object({ note: text(3, 1000) }).strict() }, async (req: Request, res: Response) => send(res, await d.rejectProposal(req.user!, id(req), req.body.note)));

r.get("/exams/:id/fairness", { summary: "Paper difficulty fairness report", access: EA, params: idParams }, async (req: Request, res: Response) => send(res, await fairnessReport(req.user!, id(req))));

export default r.router;
