import type { Request, Response } from "express";
import { send } from "../lib/http";
import * as audit from "../services/audit.service";
import * as users from "../services/users.service";

export async function list(req: Request, res: Response) {
  const { rows, meta } = await users.listUsers(req.query as never);
  send(res, rows, { meta });
}
export const get = async (req: Request, res: Response) => send(res, await users.getUser(req.params.id as string));
export const create = async (req: Request, res: Response) => send(res, await users.createUser(req.body), { status: 201 });
export const update = async (req: Request, res: Response) => send(res, await users.updateUser(req.user!.userId, req.params.id as string, req.body));
export const activate = async (req: Request, res: Response) => send(res, await users.setActive(req.user!.userId, req.params.id as string, true));
export const deactivate = async (req: Request, res: Response) => send(res, await users.setActive(req.user!.userId, req.params.id as string, false));
export const resetPassword = async (req: Request, res: Response) => send(res, await users.adminResetPassword(req.params.id as string));
export const stats = async (_req: Request, res: Response) => send(res, await users.adminStats());
export const deadLetter = async (_req: Request, res: Response) => send(res, await users.deadLetterJobs());
export async function auditLogs(req: Request, res: Response) {
  const { rows, meta } = await audit.listAuditLogs(req.query as never);
  send(res, rows, { meta });
}
export const auditVerify = async (_req: Request, res: Response) => send(res, await audit.verifyAuditChain());
