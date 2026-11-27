import { create } from "zustand";

export type ConnectionStatus = "Connecting" | "Connected" | "Service degraded" | "Reconnecting" | "Offline";
export const useConnectionStore = create<{
  status: ConnectionStatus;
  latencyMs?: number;
  setStatus: (status: ConnectionStatus, latencyMs?: number) => void;
}>((set) => ({
  status: "Connecting",
  setStatus: (status, latencyMs) => set({ status, latencyMs }),
}));
