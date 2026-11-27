import { useEffect } from "react";
import { useExamData } from "../hooks/useExamData";
import { useMutation } from "@tanstack/react-query";
import { examWrite } from "../api/examination";
import { useExamPreferences } from "../store/exam-preferences";
import { ActionError } from "./ExamData";

export function ExamPreferences({ sync = false }: { sync?: boolean }) {
  const { hideTimer, roomy, singleColumn, keyboardHints, setOption } = useExamPreferences();
  const preferences = useExamData<{showTimer:boolean;layout:string}>("/api/me/preferences", {enabled:sync});
  useEffect(() => { if (preferences.data) {setOption("hideTimer",!preferences.data.showTimer); setOption("singleColumn",preferences.data.layout === "single");} }, [preferences.data,setOption]);
  const save = useMutation({
    mutationFn: () => examWrite("/api/me/preferences", "PUT", {
      showTimer: !hideTimer, layout: singleColumn ? "single" : "split",
      theme: document.documentElement.dataset.theme === "night" ? "dark" : document.documentElement.dataset.theme === "contrast" ? "contrast" : "light",
      fontScale: document.documentElement.dataset.textSize === "large" ? 1.125 : 1,
    }),
  });
  const choices = [
    ["hideTimer", "Show the timer only in the last ten minutes", hideTimer],
    ["roomy", "Use more space between lines", roomy],
    ["singleColumn", "Use a single-column exam layout", singleColumn],
    ["keyboardHints", "Show keyboard shortcuts", keyboardHints],
  ] as const;
  return <section className="exam-record">
    {choices.map(([key, label, checked]) => <label className="exam-inline" key={key}><input type="checkbox" checked={checked} onChange={(event) => setOption(key, event.target.checked)} />{label}</label>)}
    {sync && <div className="exam-record">
      <button className="button" disabled={save.isPending} onClick={() => save.mutate()}>Save display settings to account</button>
      <ActionError error={save.error} />
      {save.isSuccess && <p role="status">Display settings saved to account.</p>}
    </div>}
  </section>;
}
