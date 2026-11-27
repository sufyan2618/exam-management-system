import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  role?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
export const getContext = () => requestContext.getStore();
