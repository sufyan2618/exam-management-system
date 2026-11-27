import { create } from "zustand";
import { persist } from "zustand/middleware";

type Preferences = { hideTimer: boolean; roomy: boolean; singleColumn: boolean; keyboardHints: boolean };
export const useExamPreferences = create<Preferences & { setOption: (key: keyof Preferences, value: boolean) => void }>()(persist(
  (set) => ({ hideTimer: false, roomy: false, singleColumn: false, keyboardHints: true, setOption: (key, value) => set({ [key]: value }) }),
  { name: "exam-display-options" }
));
