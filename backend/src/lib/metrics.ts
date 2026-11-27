import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const autosaveCounter = new client.Counter({
  name: "autosave_total",
  help: "Autosave outcomes",
  labelNames: ["outcome"],
  registers: [registry],
});

export const finalizeCounter = new client.Counter({
  name: "attempt_finalized_total",
  help: "Attempts finalized by reason",
  labelNames: ["reason"],
  registers: [registry],
});

export const autoSubmitLag = new client.Histogram({
  name: "auto_submit_lag_seconds",
  help: "Seconds between deadline and finalization",
  buckets: [1, 5, 10, 30, 60, 300],
  registers: [registry],
});
