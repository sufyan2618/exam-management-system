import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { ZodTypeAny } from "zod";
import type { Role } from "../config/constants";
import { idempotency } from "../middlewares/idempotency.middleware";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { userRateLimiter } from "../middlewares/rate-limit.middleware";
import { validate } from "../utils/validators";

type Method = "get" | "post" | "put" | "patch" | "delete";

export interface RouteSpec {
  summary: string;
  /** "public" = no auth; "any" = any authenticated user; otherwise the allowed roles. */
  access: "public" | "any" | Role[];
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  limiter?: RequestHandler;
  idempotent?: boolean;
  allowMustChangePassword?: boolean;
  /** Extra middleware (e.g. multer) executed before validation. */
  pre?: RequestHandler[];
}

export interface RegisteredRoute {
  method: Method;
  path: string;
  tag: string;
  spec: RouteSpec;
}

export const routeRegistry: RegisteredRoute[] = [];

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;

const wrap =
  (handler: Handler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);
  };

/**
 * Router factory: every route declares its access policy, validation schemas and limits in one
 * place. This also feeds the generated OpenAPI document (Zod -> JSON schema).
 */
export function createRouter(tag: string) {
  const router = Router();
  const add =
    (method: Method) =>
    (path: string, spec: RouteSpec, handler: Handler) => {
      routeRegistry.push({ method, path, tag, spec });
      const chain: RequestHandler[] = [];
      if (spec.access !== "public") {
        chain.push(requireAuth({ allowMustChangePassword: spec.allowMustChangePassword }), userRateLimiter);
        if (Array.isArray(spec.access)) chain.push(requireRole(...spec.access));
      }
      if (spec.limiter) chain.push(spec.limiter);
      if (spec.pre) chain.push(...spec.pre);
      if (spec.body || spec.params || spec.query) {
        chain.push(validate({ body: spec.body, params: spec.params, query: spec.query }));
      }
      if (spec.idempotent) chain.push(idempotency);
      router[method](path, ...chain, wrap(handler));
    };
  return {
    router,
    get: add("get"),
    post: add("post"),
    put: add("put"),
    patch: add("patch"),
    delete: add("delete"),
  };
}
