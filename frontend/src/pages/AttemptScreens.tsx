import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import { apiRequest } from "../api/client";
import { examGet, examWrite, formatDate, segment } from "../api/examination";
import { Scratchpad } from "../components/Scratchpad";
import type { Stroke } from "../components/Scratchpad";
import { ExamPreferences } from "../components/ExamPreferences";
import { useExamPreferences } from "../store/exam-preferences";
import { ExamMarkdown } from "../components/ExamMarkdown";
import { useAttemptIntegrity } from "../hooks/useAttemptIntegrity";
import { ActionError, DataPanel } from "../components/ExamData";
import { loadAttemptQueue, removeAttemptQueue, saveAttemptQueue, useAttemptRuntime } from "../store/attempt-runtime";
import type { Answer, AnswerChange } from "../store/attempt-runtime";
import { useConnectionStore } from "../store/connection";
import { useAuthStore } from "../store/auth.store";

type Question = {
  id: string; stem: string; type: "SINGLE" | "MULTI" | "WRITTEN"; marks: number;
  options?: { id: string; text: string }[]; maxWords?: number; answer?: Answer; flagged?: boolean;
};
type Attempt = {
  id: string; examTitle: string; status: string; remainingSeconds: number; clientSeq?: number; sessionEpoch?: number;
  integrityAcknowledged?: boolean;
  integrityLevel?: "OFF" | "STANDARD" | "STRICT";
  questions: Question[]; submittedAt?: string; receiptId?: string; notes?: string; sketch?: Stroke[];
  announcements?: { id: string; message: string }[];
};
type Clock = { remainingSeconds: number; receivedAt: number; sessionEpoch?: number };
const isAnswered = (answer: Answer | undefined) => Array.isArray(answer) ? answer.length > 0 : !!answer?.trim();

export function AttemptScreen({ id, review = false, sandbox = false, exit = "/app" }: { id: string; review?: boolean; sandbox?: boolean; exit?: string }) {
  const userId = useAuthStore((state) => state.user?.id);
  const path = "/api/attempts/" + segment(id);
  const query = useQuery({
    queryKey: ["attempt", userId, id],
    queryFn: async ({ signal }) => {
      const attempt = await examGet<Attempt>(path, signal);
      if (!attempt || !Array.isArray(attempt.questions) || !Number.isFinite(attempt.remainingSeconds)) throw new Error("Invalid attempt response");
      if (attempt.questions.some((q) => "isCorrect" in q || "explanation" in q || q.options?.some((o) => "isCorrect" in o))) {
        throw new Error("Candidate question data contains restricted fields");
      }
      return { attempt, clock: { remainingSeconds: attempt.remainingSeconds, sessionEpoch: attempt.sessionEpoch, receivedAt: performance.now() } };
    },
    staleTime: 0,
    refetchOnMount: "always",
  });
  useLiveUpdates(query.data?.attempt.status === "IN_PROGRESS" ? path + "/stream" : undefined, () => void query.refetch());
  const runtimeKey = (userId ?? "") + ":" + id;
  // A fresh server response is required to anchor the timer when reopening a page.
  if (!query.data || (query.isFetching && !query.isFetchedAfterMount && query.data.attempt.status === "IN_PROGRESS")) {
    return <DataPanel pending={!query.data && query.isPending || query.isFetching} error={query.error} retry={() => void query.refetch()} />;
  }
  return <AttemptPaper key={runtimeKey} id={id} path={path} runtimeKey={runtimeKey} attempt={query.data.attempt} initialClock={query.data.clock}
    review={review} sandbox={sandbox} exit={exit} reload={() => void query.refetch()} />;
}

function AttemptPaper({ id, path, runtimeKey, attempt, initialClock, review, sandbox, exit, reload }: {
  id: string; path: string; runtimeKey: string; attempt: Attempt; initialClock: Clock; review: boolean;
  sandbox: boolean; exit: string; reload: () => void;
}) {
  const [params] = useSearchParams();
  const { hideTimer, roomy, singleColumn, keyboardHints } = useExamPreferences();
  const connection = useConnectionStore((state) => state.status);
  const latency = useConnectionStore((state) => state.latencyMs);
  const runtime = useAttemptRuntime((state) => state.attempts[runtimeKey]);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [saveError, setSaveError] = useState<unknown>();
  const [now, setNow] = useState(() => performance.now());
  const [latestClock, setClock] = useState(initialClock);
  const clock = initialClock.receivedAt > latestClock.receivedAt ? initialClock : latestClock;
  const [selected, setSelected] = useState(() => {
    const index = Number(params.get("question")) - 1;
    return Number.isInteger(index) && index >= 0 && index < attempt.questions.length ? index : 0;
  });
  const [filter, setFilter] = useState("all");
  const [confirm, setConfirm] = useState(false);
  const [lockReady, setLockReady] = useState(() => !("locks" in navigator));
  const [takenOver, setTakenOver] = useState(false);


  const [announcements, setAnnouncements] = useState(attempt.announcements ?? []);
  const [receipt, setReceipt] = useState<{ receiptId?: string; submittedAt?: string }>();
  const [sessionEpoch] = useState(attempt.sessionEpoch);
  const pending = runtime?.pending;
  const remaining = Math.max(0, Math.ceil(clock.remainingSeconds - (now - clock.receivedAt) / 1000));
  const active = attempt.status === "IN_PROGRESS" && !receipt;
  const staleSession = sessionEpoch != null && attempt.sessionEpoch != null && sessionEpoch !== attempt.sessionEpoch;
  const integrityEnabled = !sandbox && active && !takenOver && !staleSession && attempt.integrityAcknowledged === true &&
    (attempt.integrityLevel === "STANDARD" || attempt.integrityLevel === "STRICT");
  const recordedSignals = useAttemptIntegrity(path, integrityEnabled);
  const saveBusy = useRef(false);
  const lastSentSequence = useRef(0);
  const writing = useRef(Promise.resolve<unknown>(undefined));
  const [answerOverrides, setAnswerOverrides] = useState<Record<string, AnswerChange>>({});
  const submit = useMutation({
    mutationFn: () => examWrite<{ receiptId?: string; submittedAt?: string }>(path + "/submit", "POST", { sessionEpoch: sessionEpoch }, "submit-" + id),
    onSuccess: (data) => {
      setReceipt(data ?? {});
      useAttemptRuntime.getState().update(runtimeKey, { pending: [], sequence: 0 });
      void writing.current.then(() => removeAttemptQueue(runtimeKey)).catch(() => undefined);
      reload();
    },
  });
  useEffect(() => {
    let live = true;
    void loadAttemptQueue(runtimeKey).then((stored) => {
      if (live) {
        const current = useAttemptRuntime.getState();
        const existing = current.attempts[runtimeKey] ?? stored;
        const recoverable = existing?.sessionEpoch === sessionEpoch ? existing : undefined;
        const confirmed = attempt.clientSeq ?? 0;
        current.update(runtimeKey, {
          sessionEpoch,
          pending: recoverable?.pending.filter((item) => item.clientSeq > confirmed) ?? [],
          sequence: Math.max(recoverable?.sequence ?? 0, confirmed),
        });
      }
    }).catch(() => { if (live) setStorageError(true); }).finally(() => { if (live) setHydrated(true); });
    const timer = window.setInterval(() => setNow(performance.now()), 500);
    return () => { live = false; window.clearInterval(timer); };
  }, [runtimeKey, attempt.clientSeq, sessionEpoch]);

  useEffect(() => {
    if (!active || !("locks" in navigator)) return;
    const controller = new AbortController();
    void navigator.locks.request("exam:" + runtimeKey, { ifAvailable: true }, async (lock) => {
      if (controller.signal.aborted) return;
      if (!lock) { setTakenOver(true); return; }
      setLockReady(true);
      await new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
    });
    return () => controller.abort();
  }, [active, runtimeKey]);

  useEffect(() => {
    if (!active || !lockReady || takenOver || staleSession) return;
    let live = true;
    const beat = async () => {
      try {
        const data = await examWrite<Clock & { status?: string; announcements?: Attempt["announcements"] }>(path + "/heartbeat", "POST", { sessionEpoch: sessionEpoch });
        if (!live || !data) return;
        if (sessionEpoch != null && data.sessionEpoch != null && data.sessionEpoch !== sessionEpoch) { setTakenOver(true); return; }
        if (Number.isFinite(data.remainingSeconds)) setClock({ ...data, receivedAt: performance.now() });
        if (data.announcements) setAnnouncements(data.announcements);
        if (data.status && data.status !== "IN_PROGRESS") reload();
      } catch { /* The existing timer continues while the server is unreachable. */ }
    };
    const timer = window.setInterval(() => void beat(), 10_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [active, lockReady, path, reload, sessionEpoch, staleSession, takenOver]);

  useEffect(() => {
    if (!active || !hydrated || !lockReady || takenOver || staleSession || !pending?.length) return;
    let live = true;
    const flush = async () => {
      if (saveBusy.current) return;
      const item = useAttemptRuntime.getState().attempts[runtimeKey]?.pending[0];
      if (!item) return;
      saveBusy.current = true;
      lastSentSequence.current = Math.max(lastSentSequence.current, item.clientSeq);
      try {
        const result = await apiRequest<{ data?: Clock }>(path + "/answers/" + segment(item.questionId), {
          method: "PUT", body: { ...item, sessionEpoch: sessionEpoch }, timeoutMs: 5000,
        });
        if (result.data?.sessionEpoch != null && sessionEpoch != null && result.data.sessionEpoch !== sessionEpoch) {
          if (live) setTakenOver(true);
          return;
        }
        const state = useAttemptRuntime.getState();
        const current = state.attempts[runtimeKey];
        if (!current || current.sessionEpoch !== sessionEpoch) return;
        setAnswerOverrides((answers) => ({ ...answers, [item.questionId]: item }));
        const next = { ...current, pending: current.pending.filter((entry) => entry.clientSeq !== item.clientSeq) };
        state.update(runtimeKey, next);
        writing.current = writing.current.catch(() => undefined).then(() => saveAttemptQueue(runtimeKey, next));
        void writing.current.catch(() => { if (live) setStorageError(true); });
        if (live) {
          setSaveError(undefined);
          if (result.data && Number.isFinite(result.data.remainingSeconds)) setClock({ ...result.data, receivedAt: performance.now() });
        }
      } catch (error) { if (live) setSaveError(error); }
      finally { saveBusy.current = false; }
    };
    const timer = window.setTimeout(() => void flush(), 600);
    const retry = window.setInterval(() => void flush(), 5000);
    window.addEventListener("online", flush);
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      live = false;
      window.clearTimeout(timer);
      window.clearInterval(retry);
      window.removeEventListener("online", flush);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [active, hydrated, lockReady, path, pending, runtimeKey, sessionEpoch, staleSession, takenOver]);

  const canSubmit = lockReady && !staleSession && active && hydrated && !takenOver && !pending?.length && !submit.isPending;
  useEffect(() => {
    if (remaining === 0 && canSubmit && submit.isIdle) submit.mutate();
  }, [canSubmit, remaining, submit]);

  const locked = !lockReady || staleSession || !active || !hydrated || takenOver || remaining === 0 || submit.isPending;
  const question = attempt.questions[selected];
  const answerFor = (q: Question) => pending?.findLast((item) => item.questionId === q.id) ?? answerOverrides[q.id] ?? q;
  const answered = attempt.questions.filter((q) => isAnswered(answerFor(q).answer)).length;
  const marked = attempt.questions.filter((q) => answerFor(q).flagged).length;
  function change(q: Question, answer: Answer, flagged: boolean) {
    if (locked) return;
    const store = useAttemptRuntime.getState();
    const current = store.attempts[runtimeKey] ?? { pending: [], sequence: attempt.clientSeq ?? 0 };
    const tail = current.pending.at(-1);
    const replaceTail = tail?.questionId === q.id && tail.clientSeq > lastSentSequence.current && q.type === "WRITTEN";
    const item = { questionId: q.id, answer, flagged, clientSeq: replaceTail ? tail.clientSeq : current.sequence + 1 };
    const next = { sessionEpoch, sequence: item.clientSeq, pending: [...(replaceTail ? current.pending.slice(0, -1) : current.pending), item] };
    store.update(runtimeKey, next);
    writing.current = writing.current.catch(() => undefined).then(() => saveAttemptQueue(runtimeKey, next));
    void writing.current.catch(() => setStorageError(true));
  }

  const questionCount = attempt.questions.length;
  useEffect(() => {
    if (!active || review || questionCount === 0) return;
    const move = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || !(event.target instanceof HTMLElement) ||
        event.target.closest("input, textarea, select, button, summary, a, [contenteditable]")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        setSelected((index) => Math.min(questionCount - 1, Math.max(0, index + direction)));
      }
    };
    window.addEventListener("keydown", move);
    return () => window.removeEventListener("keydown", move);
  }, [active, review, questionCount]);

  if (!active) return <section className="account-card exam-record">
    <span className="exam-stamp">{receipt ? "SUBMITTED" : attempt.status}</span><h2>{attempt.examTitle}</h2>
    {(receipt?.submittedAt || attempt.submittedAt) && <p>Submitted {formatDate(receipt?.submittedAt ?? attempt.submittedAt)}</p>}
    {(receipt?.receiptId || attempt.receiptId) && <p>Receipt: {receipt?.receiptId ?? attempt.receiptId}</p>}
    <Link to={exit}>Return to examinations</Link>
  </section>;

  const timer = [Math.floor(remaining / 60), remaining % 60].map((value) => String(value).padStart(2, "0")).join(":");
  return <>
    {sandbox && <div className="account-card" role="status"><strong>Sandbox</strong> · This attempt does not affect real results. <Link to={exit}>Exit preview</Link></div>}
    <header className="account-card exam-attempt-header">
      <h2>{attempt.examTitle}</h2><span className="connection-pill">{connection}{latency != null && " · " + latency + " ms"}</span>{(!hideTimer || remaining <= 600) && <span className="exam-timer" role="timer" aria-label="Time remaining">{timer}</span>}
      {!review && !sandbox && <Link className="button" to={"/app/attempt/" + segment(id) + "/review"}>Review and submit</Link>}
      {!review && sandbox && <button className="button" disabled={!canSubmit} onClick={() => setConfirm(true)}>Finish preview</button>}
    </header>
    <p role="status">{takenOver || staleSession ? "This attempt is active in another window or device." : storageError ? "Local recovery storage is unavailable. Keep this tab open." :
      saveError ? "Could not sync answers. They will retry automatically." : pending?.length ? pending.length + " changes waiting to sync" : hydrated ? "All answers synced" : "Restoring pending answers…"}</p>
    {!review && <details className="account-card">
      <summary>Display options</summary>
      <ExamPreferences />
      {keyboardHints && <p>Use the left and right arrow keys to move between questions when outside a control.</p>}
    </details>}
    {integrityEnabled && <details className="account-card">
      <summary>What is being recorded?</summary>
      <p>Recorded indicators include tab visibility, fullscreen exits, clipboard actions, context menu use and reconnections. Clipboard contents are not collected.</p>
      <p>Indicators are not conclusive evidence of misconduct. This session recorded {recordedSignals} events.</p>
    </details>}
    {!review && typeof document.documentElement.requestFullscreen === "function" &&
      <button className="button" onClick={() => { void document.documentElement.requestFullscreen().catch(() => undefined); }}>Enter fullscreen</button>}
    {announcements.length > 0 && <details className="account-card"><summary>Announcements ({announcements.length})</summary>
      {announcements.map((item) => <p key={item.id}>{item.message}</p>)}</details>}
    {connection === "Offline" && !storageError && <p role="status">The connection is offline. Pending answers stay on this device. The exam timer continues.</p>}
    <span className="exam-visually-hidden" aria-live="polite">{remaining === 0 ? "Time is up" :
      remaining <= 60 ? "One minute or less remaining" : remaining <= 300 ? "Five minutes or less remaining" :
      remaining <= 600 ? "Ten minutes or less remaining" : ""}</span>
    {remaining === 0 && <p role="status">Time is up. Waiting for final confirmation from the server.</p>}
    <ActionError error={submit.error} />
    {submit.isError && remaining === 0 && <button className="button" disabled={!canSubmit} onClick={() => submit.mutate()}>Retry submission</button>}
    {review ? <section className="account-card exam-record">
      <h2>Answer review</h2><p>{answered} answered · {marked} marked · {attempt.questions.length - answered} unanswered</p>
      <label>Show <select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All questions</option><option value="unanswered">Unanswered</option><option value="marked">Marked</option></select></label>
      <ol className="exam-review-list">{attempt.questions.map((q, index) => {
        const value = answerFor(q);
        if (filter === "unanswered" && isAnswered(value.answer) || filter === "marked" && !value.flagged) return null;
        return <li key={q.id}><Link to={"/app/attempt/" + segment(id) + "?question=" + (index + 1)} onClick={() => { setSelected(index); setConfirm(false); }}>Question {index + 1}</Link> · {isAnswered(value.answer) ? "Answered" : "Unanswered"}{value.flagged && " · Marked"}</li>;
      })}</ol>
      <button className="button button-primary" disabled={!canSubmit} onClick={() => setConfirm(true)}>Submit attempt</button>
    </section> : <div className="exam-paper-grid" data-single-column={singleColumn} data-roomy={roomy}>
      <aside className="account-card exam-record"><h2>Questions</h2><div className="exam-navigator">
        {attempt.questions.map((q, index) => <button key={q.id} type="button" aria-current={index === selected ? "step" : undefined} onClick={() => setSelected(index)}
          aria-label={`Question ${index + 1}, ${isAnswered(answerFor(q).answer) ? "answered" : "unanswered"}${answerFor(q).flagged ? ", marked" : ""}`}>
          {index + 1}{isAnswered(answerFor(q).answer) && " ✓"}{answerFor(q).flagged && " ★"}
        </button>)}
      </div></aside>
      {question && <section className="account-card exam-record exam-paper">
        <h2>Question {selected + 1} of {attempt.questions.length}</h2><p>{question.marks} marks</p>
        <ExamMarkdown text={question.stem} />
        <fieldset disabled={locked} className="exam-form">
          <legend>{question.type === "WRITTEN" ? "Write your answer" : question.type === "MULTI" ? "Select all that apply" : "Select one answer"}</legend>
          {question.type === "WRITTEN" ? <>
            <textarea aria-label="Written answer" value={typeof answerFor(question).answer === "string" ? String(answerFor(question).answer) : ""} onChange={(event) => change(question, event.target.value, !!answerFor(question).flagged)} />
            {question.maxWords && <small>Word limit: {question.maxWords}</small>}
          </> : question.options?.map((option) => {
            const value = answerFor(question).answer;
            const checked = Array.isArray(value) ? value.includes(option.id) : value === option.id;
            return <label className="exam-inline exam-option" key={option.id}>
              <input type={question.type === "MULTI" ? "checkbox" : "radio"} name={question.id} checked={checked} onChange={() => {
                const previous = Array.isArray(value) ? value : [];
                change(question, question.type === "MULTI" ? checked ? previous.filter((entry) => entry !== option.id) : [...previous, option.id] : option.id, !!answerFor(question).flagged);
              }} />{option.text}
            </label>;
          })}
        </fieldset>
        <div className="exam-actions">
          <button className="button" disabled={selected === 0} onClick={() => setSelected(selected - 1)}>Previous</button>
          <button className="button" disabled={locked} onClick={() => change(question, answerFor(question).answer ?? null, !answerFor(question).flagged)}>
            {answerFor(question).flagged ? "Remove mark" : "Mark for review"}
          </button>
          <button className="button" disabled={locked} onClick={() => change(question, null, !!answerFor(question).flagged)}>Clear answer</button>
          <button className="button" disabled={selected >= attempt.questions.length - 1} onClick={() => setSelected(selected + 1)}>Next</button>
        </div>
      </section>}
      <Scratchpad path={path} disabled={locked} initialNotes={attempt.notes} initialSketch={attempt.sketch} />
    </div>}
    {confirm && <section className="account-card exam-record">
      <h2>Confirm submission</h2><p>{attempt.questions.length - answered} unanswered. You cannot edit a submitted attempt.</p>
      <div className="exam-actions"><button className="button button-primary" disabled={!canSubmit} onClick={() => submit.mutate()}>Confirm submit</button>
        <button className="button" onClick={() => setConfirm(false)}>Cancel</button></div>
    </section>}
  </>;
}
