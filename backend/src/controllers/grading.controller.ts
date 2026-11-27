import type { Request, Response } from "express";
import { send } from "../lib/http";
import * as g from "../services/grading.service";
import * as results from "../services/results.service";

const id = (req: Request) => req.params.id as string;

export async function queue(req: Request, res: Response) {
  const { rows, meta } = await g.gradingQueue(req.user!, id(req), req.query as never);
  send(res, rows, { meta });
}
export const getAnswer = async (req: Request, res: Response) => send(res, await g.getAnswerForGrading(req.user!, id(req), (req.query as { blind?: boolean }).blind ?? true));
export const grade = async (req: Request, res: Response) => send(res, await g.gradeAnswer(req.user!, id(req), req.body));
export const regrade = async (req: Request, res: Response) => send(res, await g.regradeExam(req.user!, id(req), req.body));
export const status = async (req: Request, res: Response) => send(res, await g.gradingStatus(req.user!, id(req)));
export const listOverrides = async (req: Request, res: Response) => send(res, await g.listKeyOverrides(req.user!, id(req)));
export const putOverride = async (req: Request, res: Response) => send(res, await g.setKeyOverride(req.user!, id(req), req.params.questionId as string, req.body));
export async function deleteOverride(req: Request, res: Response) {
  send(res, await g.removeKeyOverride(req.user!, id(req), req.params.questionId as string, String(req.body?.reason ?? "Override removed")));
}
export const moderation = async (req: Request, res: Response) => send(res, await g.setModeration(req.user!, id(req), req.body));

export async function listResults(req: Request, res: Response) {
  const { rows, meta } = await results.listExamResults(req.user!, id(req), req.query as never);
  send(res, rows, { meta });
}
export const publish = async (req: Request, res: Response) => send(res, await results.publishResults(req.user!, id(req), req.body));
export const unpublish = async (req: Request, res: Response) => send(res, await results.unpublishResults(req.user!, id(req), req.body));
export const myResults = async (req: Request, res: Response) => send(res, await results.listMyResults(req.user!.userId));
export const myResult = async (req: Request, res: Response) => send(res, await results.getMyResult(req.user!.userId, req.params.attemptId as string));
