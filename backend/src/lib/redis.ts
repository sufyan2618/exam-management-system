import Redis from "ioredis";
import { env } from "../config/env";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: env.IS_TEST,
  enableOfflineQueue: !env.IS_TEST,
  retryStrategy: env.IS_TEST ? () => null : undefined,
});

/** Dedicated connection for SUBSCRIBE (a subscribed connection cannot issue other commands). */
export const createSubscriber = () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: env.IS_TEST });

/** Small Redis mutex used for the audit hash chain. */
export async function withLock<T>(key: string, fn: () => Promise<T>, ttlMs = 10_000, waitMs = 8_000): Promise<T> {
  const token = Math.random().toString(36).slice(2);
  const lockKey = `lock:${key}`;
  const start = Date.now();
  while (true) {
    const ok = await redis.set(lockKey, token, "PX", ttlMs, "NX");
    if (ok === "OK") break;
    if (Date.now() - start > waitMs) throw new Error(`Could not acquire lock ${key}`);
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 25));
  }
  try {
    return await fn();
  } finally {
    const script = "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
    await redis.eval(script, 1, lockKey, token).catch(() => undefined);
  }
}

export async function cached<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit) as T;
  const value = await loader();
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  return value;
}

export async function invalidatePrefix(prefix: string) {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
    cursor = next;
    if (keys.length) await redis.del(...keys);
  } while (cursor !== "0");
}
