import { create } from "zustand";

export type Answer = string | string[] | null;
export type AnswerChange = { questionId: string; answer: Answer; flagged: boolean; clientSeq: number };
type Runtime = { pending: AnswerChange[]; sequence: number; sessionEpoch?: number };
export const useAttemptRuntime = create<{ attempts: Record<string, Runtime>; update: (key: string, data: Runtime) => void; clear: () => void }>((set) => ({
  attempts: {},
  update: (key, data) => set((state) => ({ attempts: { ...state.attempts, [key]: data } })),
  clear: () => set({ attempts: {} }),
}));

const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("exam-answer-recovery", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("queues");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("queues", mode);
      const request = action(tx.objectStore("queues"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export const loadAttemptQueue = (key: string) => transaction("readonly", (store) => store.get(key)) as Promise<Runtime | undefined>;
export const saveAttemptQueue = (key: string, data: Runtime) => transaction("readwrite", (store) => store.put(data, key));
export const loadAttemptSnapshot = (key: string) => transaction("readonly", store => store.get("snapshot:" + key));
export const saveAttemptSnapshot = (key: string, value: unknown) => transaction("readwrite", store => store.put(value, "snapshot:" + key));
export async function removeAttemptQueue(key: string) {
  await transaction("readwrite", store=>store.delete(key));
  await transaction("readwrite", store=>store.delete("snapshot:"+key));
  const separator = key.lastIndexOf(":");
  if(separator >= 0) await transaction("readwrite", store=>store.delete("snapshot:scratchpad:"+key.slice(0,separator)+"/api/attempts/"+key.slice(separator+1)));
}
export async function clearAttemptQueues() {
  useAttemptRuntime.getState().clear();
  if (typeof indexedDB !== "undefined") await transaction("readwrite", (store) => store.clear());
}
