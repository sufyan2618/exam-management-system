import type { Request, Response } from "express";
import { z } from "zod";
import { send } from "../lib/http";
import { createRouter } from "../lib/router";
import { paginationQuery } from "../lib/pagination";
import * as a from "../services/analytics.service";
import { idParams } from "../utils/validators";

const r = createRouter("Analytics");
const EA = ["EXAMINER" as const, "ADMIN" as const];
const id = (req: Request) => req.params.id as string;

r.get("/exams/:id/analytics", { summary: "Exam score distribution, pass rate, participation (cached 60 s)", access: EA, params: idParams }, async (req: Request, res: Response) => send(res, await a.examAnalytics(req.user!, id(req))));
r.get("/exams/:id/analytics/questions", { summary: "Per-question difficulty, discrimination (27% groups), distractors", access: EA, params: idParams }, async (req: Request, res: Response) => send(res, await a.questionAnalyticsForExam(req.user!, id(req))));
r.get(
  "/exams/:id/analytics/candidates",
  { summary: "Per-candidate performance", access: EA, params: idParams, query: z.object(paginationQuery).strict() },
  async (req: Request, res: Response) => {
    const { rows, meta } = await a.candidateAnalytics(req.user!, id(req), req.query as never);
    send(res, rows, { meta });
  },
);
r.get("/questions/:id/analytics", { summary: "Usage and observed difficulty of a bank question across exams", access: EA, params: idParams }, async (req: Request, res: Response) => send(res, await a.questionBankAnalytics(req.user!, id(req))));

export default r.router;
