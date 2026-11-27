import { useEffect, useRef, useState } from "react";
import { apiUrl, setApiBaseUrl, setSpecApi } from "../api/client";
import { queryClient } from "../api/query-client";

import { useConnectionStore } from "../store/connection";

export function useConnection() {
  const [configured, setConfigured] = useState(false);
  const [ready, setReady] = useState(false);
  const status = useConnectionStore((state) => state.status);
  const [lastCheck, setLastCheck] = useState<Date>();
  const [nextCheck, setNextCheck] = useState<number>();
  const [diagnostic, setDiagnostic] = useState("Waiting for first check");
  const retry = useRef<() => void>(() => undefined);

  useEffect(() => {
    const { setStatus } = useConnectionStore.getState();
    let disposed = false;
    let active = false;
    let wasHealthy = false;
    let failedSince: number | undefined;
    let timer: number | undefined;
    let delay = 1000;
    let explicitBase = Boolean(import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL);
    let selected: { path: string; base?: string; versioned: boolean } | undefined;
    const controller = new AbortController();

    async function probe() {
      if (disposed || active) return;
      window.clearTimeout(timer);
      active = true;
      setNextCheck(undefined);
      setLastCheck(new Date());
      const started = performance.now();
      let healthy = false;
      let degraded = false;
      const candidates = selected ? [selected] : [
        { path: "/api/health/ready", base: explicitBase ? undefined : "/api/v1", versioned: true },
        { path: "/api/health", versioned: false },
      ];
      for (const candidate of candidates) {
        try {
          const response = await fetch(apiUrl(candidate.path, candidate.base), {
            cache: "no-store",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]),
          });
          const envelope = await response.json().catch(() => null);
          const data = envelope?.data ?? envelope;
          if (disposed) return;
          setDiagnostic("HTTP " + response.status + " · " + Math.round(performance.now() - started) + " ms");
          degraded = candidate.versioned && data?.status?.toLowerCase() === "degraded";
          healthy = degraded || (response.ok && (data?.success === true ||
            (candidate.versioned && ["ready", "ok", "healthy"].includes(data?.status?.toLowerCase() ?? ""))));
          if (healthy) {
            selected = candidate;
            if (candidate.base) setApiBaseUrl(candidate.base);
            setSpecApi(candidate.versioned);
            break;
          }
        } catch {
          if (!disposed) setDiagnostic("No response");
        }
      }
      active = false;
      if (disposed) return;
      if (healthy) {
        setReady(true);
        const latency = Math.round(performance.now() - started);
        setStatus(degraded || latency > 1500 ? "Service degraded" : "Connected", latency);
        if (!wasHealthy) {
          void queryClient.invalidateQueries();
          void queryClient.resumePausedMutations();
        }
        failedSince = undefined;
        delay = 1000;
      } else {
        failedSince ??= Date.now();
        setStatus(!navigator.onLine || Date.now() - failedSince >= 30_000 ? "Offline" : "Reconnecting");
      }
      wasHealthy = healthy;
      const wait = healthy ? 15_000 : Math.min(15_000, delay + Math.random() * 350);
      if (!healthy) delay = Math.min(delay * 2, 15_000);
      setNextCheck(Date.now() + wait);
      timer = window.setTimeout(() => void probe(), wait);
    }

    const wake = () => { void probe(); };
    const visible = () => { if (document.visibilityState === "visible") wake(); };
    const offline = () => setStatus("Offline");
    async function boot() {
      try {
        const response = await fetch("/config.json", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]),
        });
        const config = response.ok ? await response.json() as { apiBaseUrl?: unknown } : null;
        if (!disposed && typeof config?.apiBaseUrl === "string" && config.apiBaseUrl.trim()) {
          const url = new URL(config.apiBaseUrl, window.location.origin);
          if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) {
            setApiBaseUrl(url.href);
            explicitBase = true;
          }
        }
      } catch {
        // Missing or invalid runtime config leaves the build or same-origin default in place.
      }
      if (disposed) return;
      retry.current = wake;
      window.addEventListener("online", wake);
      window.addEventListener("offline", offline);
      document.addEventListener("visibilitychange", visible);
      setConfigured(true);
      wake();
    }
    void boot();
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timer);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  return { configured, ready, status, lastCheck, nextCheck, diagnostic, retry };
}
