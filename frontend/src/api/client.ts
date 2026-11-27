import { useAuthStore } from "../store/auth.store";
import { ApiError } from "../utils/api-error";

const buildBase = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || "";
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
  responseType?: "json" | "blob";
};

let refreshRequest: Promise<string> | null = null;

export function refreshAccessToken() {
  if (!refreshRequest) {
    refreshRequest = apiRequest<{ accessToken: string }>(authPath("/api/auth/refresh-token", "/api/auth/refresh"), {
      method: "POST",
      auth: false,
      body: {},
    }).then(({ accessToken }) => {
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
  const { method = "GET", body, auth = true, signal, idempotencyKey, timeoutMs = 10_000, responseType = "json" } = options;
  const id = requestId();
  const send = async (token: string | null) => {
    const headers = new Headers({ Accept: responseType === "blob" ? "*/*" : "application/json", "X-Request-Id": id });
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) headers.set("Content-Type", "application/json");
    if (auth && token) headers.set("Authorization", "Bearer " + token);
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetch(apiUrl(path), {
        method,
        credentials: "include",
        headers,
        body: multipart ? body : body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (response.ok && responseType === "blob") return await response.blob() as T;
      if (response.status === 204 && responseType === "json") return undefined as T;
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || payload === null) {
        const error = payload as { message?: string; code?: string; details?: unknown[] } | null;
        throw new ApiError(error?.message || "The service could not complete this request.", response.status,
          error?.code, response.headers.get("X-Request-Id") ?? id, error?.details);
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
    if (!auth || !(error instanceof ApiError) || error.status !== 401) throw error;
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
