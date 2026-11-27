import { useEffect, useState } from "react";
import { examWrite } from "../api/examination";

type Signal = { type: string; occurredAt: string };
const SIGNAL_TYPES = new Set([
  "TAB_HIDDEN", "WINDOW_BLUR", "FULLSCREEN_EXIT", "COPY", "CUT", "PASTE", "CONTEXT_MENU", "RECONNECT",
]);
const MAX_QUEUED_SIGNALS = 200;

export function useAttemptIntegrity(path: string, enabled: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;

    const storageKey = `attempt-integrity:${path}`;
    let queue: Signal[] = [];
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]") as unknown;
      if (Array.isArray(stored)) {
        queue = stored.filter((value): value is Signal => !!value && typeof value === "object" &&
          "type" in value && typeof value.type === "string" && SIGNAL_TYPES.has(value.type) &&
          "occurredAt" in value && typeof value.occurredAt === "string" && Number.isFinite(Date.parse(value.occurredAt)))
          .slice(-MAX_QUEUED_SIGNALS);
        setCount(queue.length);
      }
    } catch { /* Session storage is optional; reporting continues in memory. */ }

    let syncing = false;
    let flushRequested = false;
    let keepaliveRequested = false;
    let flushTimer: number | undefined;
    let blurTimer: number | undefined;
    const lastRecordedAt = new Map<string, number>();
    const persist = () => {
      try {
        if (queue.length) sessionStorage.setItem(storageKey, JSON.stringify(queue));
        else sessionStorage.removeItem(storageKey);
      } catch { /* The in-memory queue is still sent while this page is open. */ }
    };
    const add = (type: string) => {
      const now = Date.now();
      if (queue.length >= MAX_QUEUED_SIGNALS || now - (lastRecordedAt.get(type) ?? 0) < 250) return;
      lastRecordedAt.set(type, now);
      queue.push({ type, occurredAt: new Date(now).toISOString() });
      persist();
      setCount((value) => value + 1);
      window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => void flush(), 700);
    };

    async function flush(keepalive = false) {
      if (syncing) {
        flushRequested = true;
        keepaliveRequested ||= keepalive;
        return;
      }
      if (!queue.length) return;
      syncing = true;
      let delivered = false;
      const batch = queue.slice(0, 50);
      try {
        await examWrite(path + "/events", "POST", { events: batch }, undefined, undefined, { keepalive });
        queue = queue.slice(batch.length);
        persist();
        delivered = true;
      } catch { /* Retry on visibility, reconnect, or the next interval. */ }
      finally {
        syncing = false;
        if (delivered && flushRequested && queue.length) {
          const useKeepalive = keepalive || keepaliveRequested;
          flushRequested = false;
          keepaliveRequested = false;
          void flush(useKeepalive);
        } else if (!queue.length || !delivered) {
          flushRequested = false;
          keepaliveRequested = false;
        }
      }
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        add("TAB_HIDDEN");
        window.clearTimeout(flushTimer);
        void flush(true);
      } else {
        void flush();
      }
    };
    const onWindowBlur = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        if (!document.hidden) {
          add("WINDOW_BLUR");
          void flush(true);
        }
      }, 250);
    };
    const onWindowFocus = () => window.clearTimeout(blurTimer);
    const onPageHide = () => { window.clearTimeout(flushTimer); void flush(true); };
    const listeners: Record<string, EventListener> = {
      visibilitychange: onVisibilityChange,
      copy: () => add("COPY"),
      cut: () => add("CUT"),
      paste: () => add("PASTE"),
      contextmenu: () => add("CONTEXT_MENU"),
      fullscreenchange: () => { if (!document.fullscreenElement) add("FULLSCREEN_EXIT"); },
    };
    Object.entries(listeners).forEach(([event, listener]) => document.addEventListener(event, listener));
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("pagehide", onPageHide);
    const reconnect = () => { add("RECONNECT"); void flush(); };
    window.addEventListener("online", reconnect);
    const timer = window.setInterval(() => void flush(), 15_000);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(flushTimer);
      window.clearTimeout(blurTimer);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("pagehide", onPageHide);
      Object.entries(listeners).forEach(([event, listener]) => document.removeEventListener(event, listener));
      void flush(true);
    };
  }, [enabled, path]);
  return count;
}
