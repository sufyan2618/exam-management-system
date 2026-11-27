import type { Request, Response } from "express";
import { noContent, send } from "../lib/http";
import * as enr from "../services/enrollment.service";
import * as svc from "../services/exam.service";

const id = (req: Request) => req.params.id as string;
const ifMatch = (req: Request) => {
  const h = req.header("if-match");
  const n = h ? Number(h.replace(/"/g, "")) : NaN;
  return Number.isInteger(n) ? n : undefined;
};

export const create = async (req: Request, res: Response) => send(res, await svc.createExam(req.user!, req.body), { status: 201 });
export async function list(req: Request, res: Response) {
  const { rows, meta } = await svc.listExams(req.user!, req.query as never);
  send(res, rows, { meta });
}
export const get = async (req: Request, res: Response) => send(res, await svc.getExam(req.user!, id(req)));
export const update = async (req: Request, res: Response) => send(res, await svc.updateExam(req.user!, id(req), req.body, ifMatch(req)));
export const remove = async (req: Request, res: Response) => {
  await svc.deleteExam(req.user!, id(req));
  noContent(res);
};
export const setQuestions = async (req: Request, res: Response) => send(res, await svc.setExamQuestions(req.user!, id(req), req.body));
export const autoSelect = async (req: Request, res: Response) => send(res, await svc.autoSelect(req.user!, id(req), req.body));
export const preview = async (req: Request, res: Response) => send(res, await svc.previewExam(req.user!, id(req)));
export const publish = async (req: Request, res: Response) => send(res, await svc.publishExam(req.user!, id(req), req.body.acknowledgeWarnings));
export const unpublish = async (req: Request, res: Response) => send(res, await svc.unpublishExam(req.user!, id(req)));
export const close = async (req: Request, res: Response) => send(res, await svc.closeExam(req.user!, id(req)));
export const archive = async (req: Request, res: Response) => send(res, await svc.archiveExam(req.user!, id(req)));

export async function listEnrollments(req: Request, res: Response) {
  const { rows, meta } = await enr.listEnrollments(req.user!, id(req), req.query as never);
  send(res, rows, { meta });
}
export const enroll = async (req: Request, res: Response) => send(res, await enr.enroll(req.user!, id(req), req.body), { status: 201 });
export const withdraw = async (req: Request, res: Response) => {
  await enr.withdraw(req.user!, id(req), req.params.cid as string);
  noContent(res);
};
export const patchEnrollment = async (req: Request, res: Response) => send(res, await enr.patchEnrollment(req.user!, id(req), req.params.cid as string, req.body));
export const createAnnouncement = async (req: Request, res: Response) => send(res, await enr.createAnnouncement(req.user!, id(req), req.body), { status: 201 });
export const listAnnouncements = async (req: Request, res: Response) => send(res, await enr.listAnnouncements(req.user!, id(req), (req.query as { since?: number }).since));
