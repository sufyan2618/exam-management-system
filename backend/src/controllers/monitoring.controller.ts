import type { Request, Response } from "express";
import { send } from "../lib/http";
import { openSse } from "../lib/sse";
import * as attempts from "../services/attempt.service";
import * as integrity from "../services/integrity.service";
import * as mon from "../services/monitoring.service";
import * as notif from "../services/notification.service";
import * as res_ from "../services/resilience.service";
import { loadManagedExam } from "../policies/exam.policy";

const id = (req: Request) => req.params.id as string;

export const summary = async (req: Request, res: Response) => send(res, await mon.monitorSummary(req.user!, id(req)));
export async function attemptsTable(req: Request, res: Response) {
  const { rows, meta } = await mon.monitorAttempts(req.user!, id(req), req.query as never);
  send(res, rows, { meta });
}
export const detail = async (req: Request, res: Response) => send(res, await mon.monitorAttemptDetail(req.user!, id(req)));
export const extendTime = async (req: Request, res: Response) => send(res, await attempts.extendTime(req.user!, id(req), req.body));
export const forceSubmit = async (req: Request, res: Response) => send(res, await attempts.forceSubmit(req.user!, id(req), req.body));
export const reviewEvent = async (req: Request, res: Response) => send(res, await integrity.reviewEvent(req.user!, id(req), req.body));
export const listInterruptions = async (req: Request, res: Response) => send(res, await res_.listInterruptions(req.user!, id(req)));
export const reviewInterruption = async (req: Request, res: Response) => send(res, await res_.reviewInterruption(req.user!, id(req), req.params.iid as string, req.body));

export async function notifications(req: Request, res: Response) {
  const { rows, meta } = await notif.listNotifications(req.user!.userId, req.query as never);
  send(res, rows, { meta });
}
export const readNotification = async (req: Request, res: Response) => send(res, await notif.markRead(req.user!.userId, id(req)));
export const readAllNotifications = async (req: Request, res: Response) => send(res, await notif.markAllRead(req.user!.userId));

export async function stream(req: Request, res: Response) {
  const examId = id(req);
  await loadManagedExam(req.user!, examId, "read");
  await openSse(req, res, {
    userId: req.user!.userId,
    channels: [mon.monitorChannel(examId)],
    hello: [{ type: "summary", data: await mon.monitorSummary(req.user!, examId) }],
    tick: { everyMs: 10_000, produce: async () => [{ type: "summary", data: await mon.monitorSummary(req.user!, examId) }] },
  });
}
