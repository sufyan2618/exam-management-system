import { useMutation } from "@tanstack/react-query";
import { examWrite } from "../api/examination";
import { useExamPreferences } from "../store/exam-preferences";
import { ActionError } from "./ExamData";

export function ExamPreferences({ sync = false }: { sync?: boolean }) {
  const { hideTimer, roomy, singleColumn, keyboardHints, setOption } = useExamPreferences();
  const save = useMutation({
    mutationFn: () => examWrite("/api/me/preferences", "PUT", {
      hideTimer, roomy, singleColumn, keyboardHints,
      theme: document.documentElement.dataset.theme,
      textSize: document.documentElement.dataset.textSize,
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
