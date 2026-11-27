import { z } from "zod";
import { publish } from "../lib/sse";
import { pageMeta, pageParams, paginationQuery } from "../lib/pagination";
import { Notification } from "../models/system.model";
import { notFound } from "../utils/errors";
import { boolQuery } from "../utils/validators";

export async function notify(userId: string | { toString(): string }, type: string, payload: Record<string, unknown> = {}) {
  const id = String(userId);
  const doc = await Notification.create({ userId: id, type, payload });
  await publish(`user:${id}`, { type, data: { ...payload, notificationId: String(doc._id) }, id: String(doc._id) });
  return doc;
}

export const notificationsQuery = z.object({ ...paginationQuery, unread: boolQuery.optional() }).strict();

export async function listNotifications(userId: string, query: z.infer<typeof notificationsQuery>) {
  const p = pageParams(query);
  const filter: Record<string, unknown> = { userId };
  if (query.unread) filter.readAt = null;
  const [rows, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.pageSize).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId, readAt: null }),
  ]);
  return { rows, meta: { ...pageMeta(p, total), unread } };
}

export async function markRead(userId: string, id: string) {
  const doc = await Notification.findOneAndUpdate({ _id: id, userId }, { $set: { readAt: new Date() } }, { new: true }).lean();
  if (!doc) throw notFound("Notification");
  return doc;
}
