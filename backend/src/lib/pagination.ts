import { z } from "zod";
import { MAX_PAGE_SIZE } from "../config/constants";

export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  sort: z.string().max(60).optional(),
  q: z.string().trim().max(100).optional(),
};

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
}

export function pageParams(query: { page?: number; pageSize?: number }): PageParams {
  const page = query.page ?? 1;
  const pageSize = Math.min(query.pageSize ?? 20, MAX_PAGE_SIZE);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export const pageMeta = (p: PageParams, total: number) => ({ page: p.page, pageSize: p.pageSize, total });

/** `-createdAt,title` -> { createdAt: -1, title: 1 } restricted to an allow-list. */
export function buildSort(sort: string | undefined, allowed: string[], fallback: Record<string, 1 | -1>) {
  if (!sort) return fallback;
  const out: Record<string, 1 | -1> = {};
  for (const part of sort.split(",")) {
    const desc = part.startsWith("-");
    const field = desc ? part.slice(1) : part;
    if (allowed.includes(field)) out[field] = desc ? -1 : 1;
  }
  return Object.keys(out).length ? out : fallback;
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
