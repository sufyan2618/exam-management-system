import type { Response } from "express";

export function send(res: Response, data: unknown, options: { status?: number; meta?: unknown } = {}) {
  const body: Record<string, unknown> = { data };
  if (options.meta !== undefined) body.meta = options.meta;
  res.status(options.status ?? 200).json(body);
}

export const noContent = (res: Response) => res.status(204).end();
