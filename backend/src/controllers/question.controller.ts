import type { Request, Response } from "express";
import { send, noContent } from "../lib/http";
import * as svc from "../services/question.service";

const ifMatch = (req: Request) => {
  const h = req.header("if-match");
  if (!h) return undefined;
  const n = Number(h.replace(/"/g, ""));
  return Number.isInteger(n) ? n : undefined;
};

export const listCategories = async (req: Request, res: Response) => send(res, await svc.listCategories(req.user!));
export const createCategory = async (req: Request, res: Response) => send(res, await svc.createCategory(req.user!, req.body), { status: 201 });
export const updateCategory = async (req: Request, res: Response) => send(res, await svc.updateCategory(req.user!, req.params.id as string, req.body));
export const deleteCategory = async (req: Request, res: Response) => {
  await svc.deleteCategory(req.user!, req.params.id as string);
  noContent(res);
};

export async function list(req: Request, res: Response) {
  const { rows, meta } = await svc.listQuestions(req.user!, req.query as never);
  send(res, rows, { meta });
}
export const create = async (req: Request, res: Response) => send(res, await svc.createQuestion(req.user!, req.body), { status: 201 });
export const get = async (req: Request, res: Response) => send(res, svc.toQuestionDto((await svc.loadQuestion(req.user!, req.params.id as string)).toObject()));
export async function update(req: Request, res: Response) {
  const out = await svc.updateQuestion(req.user!, req.params.id as string, req.body, ifMatch(req));
  send(res, out.question, { meta: { newVersionCreated: out.newVersionCreated } });
}
export const remove = async (req: Request, res: Response) => send(res, await svc.deleteQuestion(req.user!, req.params.id as string));
export const duplicate = async (req: Request, res: Response) => send(res, await svc.duplicateQuestion(req.user!, req.params.id as string), { status: 201 });
