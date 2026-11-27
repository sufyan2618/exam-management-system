import { useEffect, useState } from "react";
import { examWrite } from "../api/examination";

type Signal = { type: string; at: string };

export function useAttemptIntegrity(path: string, enabled: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let queue: Signal[] = [];
    let syncing = false;
    let recordedAt = 0;
    const add = (type: string) => {
      if (queue.length >= 200 || Date.now() - recordedAt < 250) return;
      recordedAt = Date.now();
      queue.push({ type, at: new Date().toISOString() });
      setCount((value) => value + 1);
    };
    const listeners: Record<string, EventListener> = {
      visibilitychange: () => add(document.hidden ? "TAB_HIDDEN" : "TAB_VISIBLE"),
      fullscreenchange: () => { if (!document.fullscreenElement) add("FULLSCREEN_EXIT"); },
      copy: () => add("COPY"),
      cut: () => add("CUT"),
      paste: () => add("PASTE"),
      contextmenu: () => add("CONTEXT_MENU"),
    };
    Object.entries(listeners).forEach(([event, listener]) => document.addEventListener(event, listener));
    const reconnect = () => add("RECONNECT");
    window.addEventListener("online", reconnect);
    async function flush() {
      if (syncing || !queue.length) return;
      syncing = true;
      const batch = queue.slice(0, 50);
      try {
        await examWrite(path + "/events", "POST", { events: batch });
        queue = queue.slice(batch.length);
      } catch { /* Keep events in memory until the next interval. */ }
      finally { syncing = false; }
    }
    const timer = window.setInterval(() => void flush(), 15_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", reconnect);
      Object.entries(listeners).forEach(([event, listener]) => document.removeEventListener(event, listener));
    };
  }, [enabled, path]);
  return count;
}
