import { useAuthStore } from "../store/auth.store";
import { ApiError } from "../utils/api-error";

const buildBase = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || "/api/v1";
let specApi = false;
export function setSpecApi(active: boolean) { specApi = active; }
export function authPath(current: string, versioned: string) { return specApi ? versioned : current; }

let base = buildBase.replace(/\/+$/, "");

export function setApiBaseUrl(value: string) {
  base = value.trim().replace(/\/+$/, "");
}

export function getApiBaseUrl() {
  return new URL(base || "/", window.location.origin).href;
}

export function apiUrl(path: string, override?: string) {
  // Existing endpoint modules use /api-prefixed paths. A configured API
  // prefix replaces /api, while a configured origin keeps it.
  const url = new URL((override ?? base) || "/", window.location.origin);
  const prefix = url.pathname.replace(/\/+$/, "");
  return prefix
    ? url.origin + prefix + path.replace(/^\/api(?=\/)/, "")
    : url.origin + path;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
  idempotencyKey?: string;
  timeoutMs?: number;
  keepalive?: boolean;
  sessionEpoch?: number;
  version?: number;
  responseType?: "json" | "blob";
};

let refreshRequest: Promise<string> | null = null;

export function refreshAccessToken() {
  if (!refreshRequest) {
    refreshRequest = apiRequest<{ data: { accessToken: string } }>("/api/auth/refresh", {
      method: "POST",
      auth: false,
      body: {},
    }).then(({ data: { accessToken } }) => {
      useAuthStore.getState().setAccessToken(accessToken);
      return accessToken;
    }).finally(() => { refreshRequest = null; });
  }
  return refreshRequest;
}

function requestId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, signal, idempotencyKey, timeoutMs = 10_000, responseType = "json", keepalive = false } = options;
  const id = requestId();
  const send = async (token: string | null) => {
    const headers = new Headers({ Accept: responseType === "blob" ? "*/*" : "application/json", "X-Request-Id": id });
    if (path.endsWith("/auth/refresh") || path.endsWith("/auth/logout")) headers.set("X-Requested-With", "XMLHttpRequest");
    if (options.sessionEpoch != null) headers.set("X-Session-Epoch", String(options.sessionEpoch));
    if (options.version != null) headers.set("If-Match", String(options.version));
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) headers.set("Content-Type", "application/json");
    if (auth && token) headers.set("Authorization", "Bearer " + token);
    if (idempotencyKey) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(idempotencyKey));
      const hex = Array.from(new Uint8Array(digest), b=>b.toString(16).padStart(2,"0")).join("");
      headers.set("Idempotency-Key", `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`);
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetch(apiUrl(path), {
        method,
        credentials: "include",
        headers,
        body: multipart ? body : body === undefined ? undefined : JSON.stringify(body),
        keepalive,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (response.ok && responseType === "blob") return await response.blob() as T;
      if (response.status === 204 && responseType === "json") return undefined as T;
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || payload === null) {
        const wrapped = payload as { error?: { message?: string; code?: string; details?: unknown[]; requestId?: string }; message?: string; code?: string; details?: unknown[] } | null;
        const error = wrapped?.error ?? wrapped;
        throw new ApiError(error?.message || "The service could not complete this request.", response.status,
          error?.code, (error as { requestId?: string } | undefined)?.requestId ?? response.headers.get("X-Request-Id") ?? id, error?.details);
      }
      return payload as T;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof ApiError) throw error;
      throw new ApiError(timeout.aborted ? "The request timed out. Try again." :
        "Could not reach the server. Check your connection and try again.", 0, undefined, id);
    }
  };

  const token = useAuthStore.getState().accessToken;
  try {
    return await send(token);
  } catch (error) {
    if (!auth || !(error instanceof ApiError) || error.status !== 401 || (error.code && !["AUTH_TOKEN_EXPIRED","AUTH_INVALID_TOKEN","AUTH_REQUIRED"].includes(error.code))) throw error;
    let nextToken: string;
    try {
      const currentToken = useAuthStore.getState().accessToken;
      nextToken = currentToken && currentToken !== token ? currentToken : await refreshAccessToken();
    } catch (refreshError) {
      if (isSessionExpired(refreshError)) useAuthStore.getState().clearSession();
      throw refreshError;
    }
    return send(nextToken);
  }
}

export function isSessionExpired(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 404);
}
