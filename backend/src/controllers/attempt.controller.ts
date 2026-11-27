import type { Request, Response } from "express";
import { send } from "../lib/http";
import { openSse } from "../lib/sse";
import { remainingSeconds } from "../lib/time";
import { Announcement as ExamAnnouncement } from "../models/exam.model";
import * as answers from "../services/answer.service";
import * as svc from "../services/attempt.service";
import * as cand from "../services/candidate.service";
import { toAnnouncementDto } from "../services/enrollment.service";
import { recordClientEvents } from "../services/integrity.service";
import { liveAttempt, loadOwnAttempt } from "../services/attempt.service";

const id = (req: Request) => req.params.id as string;
const epoch = (req: Request) => svc.epochFrom(req.header("x-session-epoch"));

export async function start(req: Request, res: Response) {
  const { attempt, resumed } = await svc.startAttempt(req.user!, req.params.examId as string, req.body, req.ip);
  send(res, { resumed, attempt: await svc.toCandidateAttemptDto(attempt as never, new Date()) }, { status: resumed ? 200 : 201 });
}

export const get = async (req: Request, res: Response) => send(res, await svc.getAttempt(req.user!, id(req), req.ip));
export const progress = async (req: Request, res: Response) => send(res, await svc.attemptProgress(req.user!, id(req)));
export const flag = async (req: Request, res: Response) => send(res, await svc.setReviewFlag(req.user!, id(req), req.body, epoch(req)));
export const submit = async (req: Request, res: Response) => send(res, await svc.submitAttempt(req.user!, id(req), epoch(req)));
export const heartbeat = async (req: Request, res: Response) => send(res, await svc.heartbeat(req.user!, id(req), req.body, req.ip, epoch(req)));
export const ackNotice = async (req: Request, res: Response) => send(res, await svc.acknowledgeNotice(req.user!, id(req)));

export const saveAnswer = async (req: Request, res: Response) =>
  send(res, await answers.saveAnswer(req.user!, id(req), req.params.attemptQuestionId as string, req.body, epoch(req)));
export const saveBatch = async (req: Request, res: Response) => send(res, await answers.saveBatch(req.user!, id(req), req.body.items, epoch(req)));

export async function postEvents(req: Request, res: Response) {
  const attempt = await liveAttempt(req.user!, id(req), new Date());
  const count = await recordClientEvents(attempt, req.body.events);
  send(res, { recorded: count, serverTime: new Date().toISOString() }, { status: 202 });
}

export const getScratchpad = async (req: Request, res: Response) => send(res, await cand.getScratchpad(req.user!, id(req)));
export const putScratchpad = async (req: Request, res: Response) => send(res, await cand.putScratchpad(req.user!, id(req), req.body, epoch(req)));

export const meExams = async (req: Request, res: Response) => send(res, await cand.listMyExams(req.user!, (req.query as { bucket?: never }).bucket));
export const meExam = async (req: Request, res: Response) => send(res, await cand.getMyExam(req.user!, req.params.examId as string));
export const getPreferences = async (req: Request, res: Response) => send(res, await cand.getPreferences(req.user!.userId));
export const putPreferences = async (req: Request, res: Response) => send(res, await cand.putPreferences(req.user!.userId, req.body));

export async function stream(req: Request, res: Response) {
  const attempt = await loadOwnAttempt(req.user!, id(req));
  const warned = new Set<number>();
  let ticks = 0;
  const snapshot = async () => {
    const fresh = await loadOwnAttempt(req.user!, id(req));
    return { status: fresh.status, deadlineAt: fresh.deadlineAt, remainingSeconds: fresh.status === "IN_PROGRESS" ? remainingSeconds(fresh.deadlineAt, new Date()) : 0, serverTime: new Date().toISOString(), sessionEpoch: fresh.sessionEpoch };
  };
  await openSse(req, res, {
    userId: req.user!.userId,
    channels: [`attempt:${id(req)}`, `exam:${String(attempt.examId)}`, `user:${req.user!.userId}`],
    replay: async (last) => {
      const n = Number(last);
      if (!Number.isFinite(n) || n <= 0) return [];
      const rows = await ExamAnnouncement.find({ examId: attempt.examId, seq: { $gt: n } }).sort({ seq: 1 }).limit(100).lean();
      return rows.map((a) => ({ type: "announcement", id: a.seq, data: toAnnouncementDto(a) }));
    },
    hello: [{ type: "hello", data: await snapshot() }],
    tick: {
      everyMs: 5000,
      produce: async () => {
        const s = await snapshot();
        const events = [] as { type: string; data: unknown }[];
        if (s.status !== "IN_PROGRESS") return [{ type: "attempt_status", data: s }];
        for (const threshold of [600, 300, 60]) {
          if (s.remainingSeconds <= threshold && !warned.has(threshold)) {
            warned.add(threshold);
            // only warn for the tightest threshold already crossed
            if (s.remainingSeconds > threshold - 20) events.push({ type: "time_warning", data: { minutes: threshold / 60, ...s } });
          }
        }
        if (++ticks % 6 === 0) events.push({ type: "time_sync", data: s });
        return events;
      },
    },
  });
}
export async function startSandbox(req: Request, res: Response) {
  const { attempt, resumed } = await svc.startSandboxAttempt(req.user!, req.params.examId as string, req.ip);
  send(res, { resumed, sandbox: true, attempt: await svc.toCandidateAttemptDto(attempt as never, new Date()) }, { status: resumed ? 200 : 201 });
}
export const resetSandbox = async (req: Request, res: Response) => send(res, await svc.resetSandbox(req.user!, req.params.examId as string));
