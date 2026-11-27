import type { Request, Response } from "express";
import type Redis from "ioredis";
import { AppError } from "../utils/errors";
import { createSubscriber, redis } from "./redis";
import { logger } from "./logger";

export interface StreamEvent {
  type: string;
  data: unknown;
  id?: string | number;
}

/** Publish an event to every API instance (Redis pub/sub) so SSE stays consistent when scaled out. */
export async function publish(channel: string, event: StreamEvent) {
  try {
    await redis.publish(channel, JSON.stringify(event));
  } catch (err) {
    logger.warn("publish failed", { channel, error: (err as Error).message });
  }
}

type Listener = (event: StreamEvent) => void;

class Hub {
  private sub: Redis | null = null;
  private listeners = new Map<string, Set<Listener>>();

  private ensure() {
    if (this.sub) return this.sub;
    const sub = createSubscriber();
    sub.on("message", (channel, message) => {
      const set = this.listeners.get(channel);
      if (!set) return;
      let event: StreamEvent;
      try {
        event = JSON.parse(message) as StreamEvent;
      } catch {
        return;
      }
      for (const l of set) l(event);
    });
    sub.on("error", (e) => logger.warn("redis subscriber error", { error: e.message }));
    this.sub = sub;
    return sub;
  }

  subscribe(channel: string, listener: Listener) {
    const sub = this.ensure();
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      void sub.subscribe(channel).catch(() => undefined);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(channel);
        void sub.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  async close() {
    await this.sub?.quit().catch(() => undefined);
    this.sub = null;
  }
}

export const hub = new Hub();

const MAX_CONNECTIONS_PER_USER = 3;
const connections = new Map<string, Set<Response>>();

export interface SseOptions {
  userId: string;
  channels: string[];
  /** Events to replay after the client's Last-Event-ID (missed while disconnected). */
  replay?: (lastEventId: string | undefined) => Promise<StreamEvent[]>;
  /** Initial events sent right after connection. */
  hello?: StreamEvent[];
  /** Periodic producer (e.g. monitoring snapshots, time warnings). */
  tick?: { everyMs: number; produce: () => Promise<StreamEvent[]> };
  onClose?: () => void;
}

export function formatEvent(e: StreamEvent) {
  return `${e.id !== undefined ? `id: ${e.id}\n` : ""}event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

const openResponses = new Set<Response>();

export async function openSse(req: Request, res: Response, options: SseOptions) {
  const set = connections.get(options.userId) ?? new Set<Response>();
  if (set.size >= MAX_CONNECTIONS_PER_USER) {
    throw new AppError(429, "TOO_MANY_STREAMS", "Too many open event streams", { retryable: true, headers: { "Retry-After": "10" } });
  }
  set.add(res);
  connections.set(options.userId, set);
  openResponses.add(res);

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write("retry: 3000\n\n");

  const write = (e: StreamEvent) => {
    if (!res.writableEnded) res.write(formatEvent(e));
  };

  const lastEventId = (req.header("last-event-id") ?? (req.query.lastEventId as string | undefined)) || undefined;
  if (options.replay) {
    try {
      for (const e of await options.replay(lastEventId)) write(e);
    } catch (err) {
      logger.warn("sse replay failed", { error: (err as Error).message });
    }
  }
  for (const e of options.hello ?? []) write(e);

  const unsubs = options.channels.map((c) => hub.subscribe(c, write));
  const keepAlive = setInterval(() => !res.writableEnded && res.write(": keep-alive\n\n"), 15_000);
  const ticker = options.tick
    ? setInterval(() => {
        options
          .tick!.produce()
          .then((events) => events.forEach(write))
          .catch(() => undefined);
      }, options.tick.everyMs)
    : undefined;

  const cleanup = () => {
    clearInterval(keepAlive);
    if (ticker) clearInterval(ticker);
    unsubs.forEach((u) => u());
    set.delete(res);
    if (set.size === 0) connections.delete(options.userId);
    openResponses.delete(res);
    options.onClose?.();
  };
  req.on("close", cleanup);
}

/** Tell every open stream to reconnect elsewhere (graceful shutdown). */
export function closeAllStreams() {
  for (const res of openResponses) {
    try {
      res.write("event: shutdown\ndata: {\"retryAfterMs\":3000}\n\n");
      res.end();
    } catch {
      /* ignore */
    }
  }
}
