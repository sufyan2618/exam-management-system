import { useEffect, useRef } from "react";
import { apiUrl, refreshAccessToken } from "../api/client";
import { useAuthStore } from "../store/auth.store";

export function useLiveUpdates(path: string | undefined, update: () => void) {
  const callback = useRef(update);
  useEffect(() => { callback.current = update; }, [update]);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let reconnect: number | undefined;
    let eventId = "";
    let delay = 1000;
    let attemptedRefresh = false;
    let dispatchTimer: number | undefined;

    async function connect() {
      try {
        const headers = new Headers({ Accept: "text/event-stream" });
        const token = useAuthStore.getState().accessToken;
        if (token) headers.set("Authorization", "Bearer " + token);
        if (eventId) headers.set("Last-Event-ID", eventId);
        const response = await fetch(apiUrl(path!), { credentials: "include", headers, signal: controller.signal });
        if (response.status === 401 && !attemptedRefresh) {
          attemptedRefresh = true;
          await refreshAccessToken();
          if (!controller.signal.aborted) void connect();
          return;
        }
        if ([400, 401, 403, 404, 405].includes(response.status)) return;
        if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) throw new Error("Stream unavailable");
        attemptedRefresh = false;
        delay = 1000;
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        try {
          while (!controller.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let eventMatch = /\r?\n\r?\n/.exec(buffer);
            while (eventMatch) {
              const event = buffer.slice(0, eventMatch.index);
              buffer = buffer.slice(eventMatch.index + eventMatch[0].length);
              const id = /^id: ?([^\r\n]*)/m.exec(event)?.[1];
              if (id !== undefined && !id.includes("\0")) eventId = id;
              if (/^data:/m.test(event) && dispatchTimer === undefined) {
                dispatchTimer = window.setTimeout(() => { dispatchTimer = undefined; callback.current(); }, 250);
              }
              eventMatch = /\r?\n\r?\n/.exec(buffer);
            }
            if (buffer.length > 256_000) throw new Error("Stream event exceeds limit");
          }
        } finally {
          void reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      } catch {
        // Polling reads continue while the stream reconnects.
      }
      if (!controller.signal.aborted) {
        reconnect = window.setTimeout(() => void connect(), delay);
        delay = Math.min(15_000, delay * 2);
      }
    }
    void connect();
    return () => {
      controller.abort();
      window.clearTimeout(reconnect);
      window.clearTimeout(dispatchTimer);
    };
  }, [path]);
}
