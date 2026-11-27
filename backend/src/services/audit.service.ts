import { sha256 } from "../lib/crypto";
import { getContext } from "../lib/context";
import { logger } from "../lib/logger";
import { withLock } from "../lib/redis";
import { pageMeta, pageParams, paginationQuery } from "../lib/pagination";
import { AuditLog } from "../models/system.model";
import { User } from "../models/user.model";
import { z } from "zod";
import { objectId } from "../utils/validators";

const GENESIS = "0".repeat(64);

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: unknown;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  actor?: { userId?: string; role?: string };
}

const plain = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/**
 * Appends a tamper-evident audit record. Each row hashes its predecessor, so any later
 * modification or deletion breaks the chain (verifiable via `verifyAuditChain`).
 * Call after the business transaction commits; failures are logged, never thrown.
 */
export async function audit(entry: AuditEntry) {
  try {
    const ctx = getContext();
    const actorId = entry.actor?.userId ?? ctx?.userId;
    const actorRole = entry.actor?.role ?? ctx?.role;
    const createdAt = new Date();
    const before = plain(entry.before);
    const after = plain(entry.after);
    const meta = plain(entry.meta);
    const entityId = entry.entityId ? String(entry.entityId) : undefined;

    await withLock("audit-chain", async () => {
      const last = await AuditLog.findOne().sort({ seq: -1 }).select("seq hash").lean();
      const seq = (last?.seq ?? 0) + 1;
      const prevHash = last?.hash ?? GENESIS;
      const hash = sha256(
        [prevHash, seq, actorId ?? "", entry.action, entry.entityType, entityId ?? "", JSON.stringify(before ?? null), JSON.stringify(after ?? null), createdAt.toISOString()].join("|"),
      );
      await AuditLog.create({
        seq,
        actorId,
        actorRole,
        action: entry.action,
        entityType: entry.entityType,
        entityId,
        before,
        after,
        meta,
        ip: ctx?.ip,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        prevHash,
        hash,
        createdAt,
      });
    });
  } catch (err) {
    logger.error("audit write failed", { error: (err as Error).message, action: entry.action });
  }
}

export async function verifyAuditChain(limit = 5000) {
  const rows = await AuditLog.find().sort({ seq: 1 }).limit(limit).lean();
  let prev = rows[0]?.prevHash ?? GENESIS;
  for (const r of rows) {
    const expected = sha256(
      [prev, r.seq, r.actorId ? String(r.actorId) : "", r.action, r.entityType, r.entityId ?? "", JSON.stringify(r.before ?? null), JSON.stringify(r.after ?? null), (r.createdAt as Date).toISOString()].join("|"),
    );
    if (r.prevHash !== prev || r.hash !== expected) return { valid: false, brokenAtSeq: r.seq, checked: rows.length };
    prev = r.hash;
  }
  return { valid: true, checked: rows.length };
}

export const auditQuery = z
  .object({
    ...paginationQuery,
    entityType: z.string().max(60).optional(),
    entityId: z.string().max(60).optional(),
    actorId: objectId.optional(),
    action: z.string().max(80).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();

export async function listAuditLogs(query: z.infer<typeof auditQuery>) {
  const p = pageParams(query);
  const filter: Record<string, unknown> = {};
  if (query.entityType) filter.entityType = query.entityType;
  if (query.entityId) filter.entityId = query.entityId;
  if (query.actorId) filter.actorId = query.actorId;
  if (query.action) filter.action = query.action;
  if (query.from || query.to) filter.createdAt = { ...(query.from && { $gte: query.from }), ...(query.to && { $lte: query.to }) };
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ seq: -1 }).skip(p.skip).limit(p.pageSize).lean(),
    AuditLog.countDocuments(filter),
  ]);
  const actorIds = [...new Set(rows.flatMap((row) => row.actorId ? [String(row.actorId)] : []))];
  const actors = actorIds.length ? await User.find({ _id: { $in: actorIds } }).select("fullName role").lean() : [];
  const actorById = new Map(actors.map((actor) => [String(actor._id), actor]));
  return { rows: rows.map((row) => ({ ...row, actorName: row.actorId ? actorById.get(String(row.actorId))?.fullName ?? null : null })), meta: pageMeta(p, total) };
}
