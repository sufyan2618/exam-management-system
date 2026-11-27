import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { examWrite, formatDate, newOperationKey, segment } from "../api/examination";
import type { Dispute, Exam, ExamResult, Verification } from "../api/examination";
import { apiRequest } from "../api/client";
import { ResultQuestionReview } from "../components/ResultQuestionReview";
import { ExamMarkdown } from "../components/ExamMarkdown";
import { ActionError, DataPanel, DataTable } from "../components/ExamData";
import { useDownload } from "../hooks/useDownload";
import { useExamData } from "../hooks/useExamData";
import { useAuthStore } from "../store/auth.store";
import { Brand } from "../components/Brand";

export function CandidateDashboard() {
  const [bucket, setBucket] = useState("available");
  const name = useAuthStore((state) => state.user?.firstName);
  const query = useExamData<Exam[]>("/api/me/exams?bucket=" + bucket, { refreshMs: 30_000 });
  return <>
    <p>Welcome, {name}. Choose an examination to review its instructions.</p>
    <div className="exam-tabs" role="group" aria-label="Examination status">
      {[["available", "Available now"], ["upcoming", "Upcoming"], ["completed", "Completed"]].map(([value, label]) =>
        <button key={value} aria-pressed={bucket === value} onClick={() => setBucket(value)}>{label}</button>
      )}
    </div>
    <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}
      empty={query.data?.length === 0 ? "No examinations in this view. Assigned exams appear here when available." : undefined}>
      <div className="exam-card-grid">
        {query.data?.map((exam) => <article className="account-card exam-record" key={exam.id}>
          <span className="exam-stamp">{exam.state}</span>
          <h2>{exam.title}</h2>
          {exam.examinerName && <p>Examiner: {exam.examinerName}</p>}
          <p>{formatDate(exam.startsAt)} to {formatDate(exam.endsAt)}</p>
          {exam.durationMinutes != null && <p>{exam.durationMinutes} minutes</p>}
          {exam.eligibilityMessage && <p>{exam.eligibilityMessage}</p>}
          {exam.activeAttemptId ? <Link to={"/app/attempt/" + segment(exam.activeAttemptId)}>Resume attempt</Link> :
            exam.resultAttemptId ? <Link to={"/app/results/" + segment(exam.resultAttemptId)}>View result</Link> :
              <Link to={"/app/exams/" + segment(exam.id)}>View briefing</Link>}
        </article>)}
      </div>
    </DataPanel>
  </>;
}

export function ExamBriefing({ id }: { id: string }) {
  const navigate = useNavigate();
  const query = useExamData<Exam>("/api/me/exams/" + segment(id));
  const [acknowledged, setAcknowledged] = useState(false);
  const [readiness, setReadiness] = useState<string>();
  const [checking, setChecking] = useState(false);
  const operation = useRef(newOperationKey());
  const start = useMutation({
    mutationFn: () => examWrite<{ attemptId: string }>("/api/exams/" + segment(id) + "/attempts", "POST", { acknowledgeNotice: acknowledged }, operation.current),
    onSuccess: (result) => { if (result?.attemptId) navigate("/app/attempt/" + segment(result.attemptId)); },
  });
  async function check() {
    setChecking(true);
    const started = performance.now();
    try {
      await apiRequest("/api/health/ready", { auth: false, timeoutMs: 4000 });
      setReadiness("Server reached in " + Math.round(performance.now() - started) + " ms. " +
        (typeof indexedDB === "undefined" ? "Local recovery storage is unavailable." : "This browser supports local recovery storage."));
    } catch { setReadiness("The server could not be reached. Check your connection and try again."); }
    finally { setChecking(false); }
  }
  const exam = query.data;
  return <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
    {exam && <>
      <section className="account-card exam-record">
        <h2>{exam.title}</h2>
        <dl className="exam-facts">
          <div><dt>Opens</dt><dd>{formatDate(exam.startsAt)}</dd></div>
          <div><dt>Closes</dt><dd>{formatDate(exam.endsAt)}</dd></div>
          <div><dt>Duration</dt><dd>{exam.durationMinutes ?? "—"} min</dd></div>
          <div><dt>Total marks</dt><dd>{exam.totalMarks ?? "—"}</dd></div>
        </dl>
        <h3>Instructions</h3><ExamMarkdown text={exam.instructions || "No additional instructions were provided."} />
      </section>
      <section className="account-card exam-record">
        <h2>Before you start</h2>
        <button className="button" disabled={checking} onClick={() => void check()}>Run readiness check</button>
        {readiness && <p role="status">{readiness}</p>}
        {exam.integrityNotice && <><p>{exam.integrityNotice}</p>
          <label className="exam-inline"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />I acknowledge the integrity notice.</label>
        </>}
        {exam.eligibilityMessage && <p>{exam.eligibilityMessage}</p>}
        <ActionError error={start.error} />
        {exam.activeAttemptId ? <Link to={"/app/attempt/" + segment(exam.activeAttemptId)}>Resume attempt</Link> :
          <button className="button button-primary" disabled={exam.canStart !== true || (!!exam.integrityNotice && !acknowledged) || start.isPending}
            onClick={() => start.mutate()}>Start exam</button>}
      </section>
    </>}
  </DataPanel>;
}

export function CandidateResults({ id }: { id?: string }) {
  const query = useExamData<ExamResult[] | ExamResult>(id ? "/api/me/results/" + segment(id) : "/api/me/results");
  const result = id && !Array.isArray(query.data) ? query.data : undefined;
  const rows = Array.isArray(query.data) ? query.data : [];
  const download = useDownload("/api/me/results/" + segment(id ?? "") + "/report.pdf", "exam-result.pdf");
  return <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}
    empty={!id && query.data && !rows.length ? "No published results yet." : undefined}>
    {result ? <div className="result-review">
      <section className="result-summary">
        <div className="result-summary-copy">
          <Link className="result-back" to="/app/results">← All results</Link>
          <p className="eyebrow">Examination result</p>
          <h2>{result.examTitle}</h2>
          {result.publishedAt && <p className="result-date">Published {formatDate(result.publishedAt)}</p>}
          <div className="exam-actions result-actions">
            {result.reportAvailable && <button className="button button-primary" disabled={download.isPending} onClick={() => download.mutate()}>{download.isPending ? "Downloading…" : "Download PDF"}</button>}
            {result.verificationCode && <Link className="button button-ghost" to={"/verify/" + segment(result.verificationCode)}>Verify result ↗</Link>}
            {result.canDispute && <Link className="result-dispute" to={"/app/disputes?attempt=" + segment(result.attemptId)}>File a dispute</Link>}
          </div>
          <ActionError error={download.error} />
        </div>
        <div className="result-total">
          <span className="result-total-label">Total score</span>
          <p><strong>{result.score}</strong><span> / {result.totalMarks}</span></p>
          <div className="result-total-meta">{result.percentage != null && <span>{result.percentage}%</span>}{result.grade && <span>Grade {result.grade}</span>}</div>
        </div>
      </section>
      {result.sections?.length ? <DataTable label="Section results" columns={["Section", "Score", "Feedback"]}
        rows={result.sections.map((section) => ({ key: section.title, cells: [section.title, section.score + " / " + section.totalMarks, section.feedback ?? "—"] }))} /> : null}
      {!!result.questions?.length && <ResultQuestionReview key={result.attemptId} questions={result.questions} />}
    </div> : rows.length > 0 && <DataTable label="Published results" columns={["Examination", "Score", "Published"]}
      rows={rows.map((row) => ({ key: row.attemptId, cells: [<Link to={"/app/results/" + segment(row.attemptId)}>{row.examTitle}</Link>, row.score + " / " + row.totalMarks, formatDate(row.publishedAt)] }))} />}
  </DataPanel>;
}

export function CandidateDisputes({ id, attempt }: { id?: string; attempt?: string }) {
  const navigate = useNavigate();
  const [reason, setReason] = useState("");
  const [disputeErrors, setDisputeErrors] = useState<{ reason?: string; question?: string }>({});
  const [type, setType] = useState("TECHNICAL_INCIDENT");
  const [confirm, setConfirm] = useState(false);
  const [questionId,setQuestionId] = useState("");
  const result = useExamData<{questions:{attemptQuestionId:string;position:number;stem:string}[]}>("/api/me/results/" + segment(attempt ?? ""), {enabled:!!attempt});
  const key = useRef(newOperationKey());
  const path = id ? "/api/disputes/" + segment(id) : "/api/me/disputes";
  const query = useExamData<Dispute | Dispute[]>(path);
  const change = useMutation({
    mutationFn: () => id ? examWrite(path + "/withdraw", "POST") : examWrite<{ id: string }>("/api/me/results/" + segment(attempt ?? "") + "/disputes", "POST", { type, reason: reason.trim(), ...(questionId ? {attemptQuestionId:questionId} : {}) }, key.current),
    onSuccess: (value) => {
      setConfirm(false);
      setReason("");
      key.current = newOperationKey();
      void query.refetch();
      if (value && typeof value === "object" && "id" in value && typeof value.id === "string") navigate("/app/disputes/" + segment(value.id));
    },
  });
  const dispute = Array.isArray(query.data) ? undefined : query.data;
  return <>
    {attempt && !id && <form className="account-card exam-record exam-form" noValidate onSubmit={(event) => {
      event.preventDefault();
      const errors = {
        ...(reason.trim().length < 20 ? { reason: "Explain the issue in at least 20 characters." } : {}),
        ...(type !== "TECHNICAL_INCIDENT" && !questionId ? { question: "Choose the question this dispute is about." } : {}),
      };
      setDisputeErrors(errors);
      if (!Object.keys(errors).length) change.mutate();
    }}>
      <h2>File a dispute</h2>
      <label>Dispute type<select value={type} onChange={(event) => setType(event.target.value)}>
        <option value="TECHNICAL_INCIDENT">Technical incident</option><option value="GRADING_ERROR">Grading error</option><option value="AMBIGUOUS_QUESTION">Ambiguous question</option>
      </select></label>
      {type !== "TECHNICAL_INCIDENT" && <label>Question<select required aria-invalid={!!disputeErrors.question} value={questionId} onChange={e=>{setQuestionId(e.target.value); setDisputeErrors((current) => ({...current, question: undefined}));}}><option value="">Select question</option>{result.data?.questions.map(q=><option key={q.attemptQuestionId} value={q.attemptQuestionId}>Question {q.position+1}: {q.stem.slice(0,80)}</option>)}</select>{disputeErrors.question && <span className="exam-field-error">{disputeErrors.question}</span>}</label>}
      <label>Reason<textarea required minLength={20} maxLength={2000} aria-invalid={!!disputeErrors.reason} aria-describedby={disputeErrors.reason ? "dispute-reason-error" : undefined} value={reason} onChange={(event) => {setReason(event.target.value); setDisputeErrors((current) => ({...current, reason: undefined}));}} />{disputeErrors.reason && <span id="dispute-reason-error" className="exam-field-error">{disputeErrors.reason}</span>}</label>
      <small>{reason.length} / 2,000 characters</small>
      <button className="button button-primary" disabled={change.isPending}>Submit dispute</button>
      <ActionError error={change.error} />
    </form>}
    <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}
      empty={Array.isArray(query.data) && !query.data.length ? "No disputes have been filed." : undefined}>
      {dispute && <section className="account-card exam-record">
        <h2>{dispute.examTitle}</h2><span className="exam-stamp">{dispute.status}</span>
        <p className="exam-prose">{dispute.reason}</p>
        <ol>{dispute.timeline?.map((event) => <li key={event.id}>{formatDate(event.at)}: {event.message}</li>)}</ol>
        {dispute.canWithdraw && (confirm ?
          <div className="exam-actions"><button className="button button-primary" disabled={change.isPending} onClick={() => change.mutate()}>Confirm withdrawal</button>
            <button className="button" onClick={() => setConfirm(false)}>Cancel</button></div> :
          <button className="button" onClick={() => setConfirm(true)}>Withdraw dispute</button>)}
        <ActionError error={change.error} />
      </section>}
      {Array.isArray(query.data) && query.data.length > 0 && <DataTable label="My disputes" columns={["Exam", "Status", "Filed"]}
        rows={query.data.map((item) => ({ key: item.id, cells: [<Link to={"/app/disputes/" + segment(item.id)}>{item.examTitle}</Link>, item.status, formatDate(item.createdAt)] }))} />}
    </DataPanel>
  </>;
}

export function VerifyResult({ code }: { code: string }) {
  const query = useExamData<Verification>("/api/verify/" + segment(code), { auth: false });
  const data = query.data;
  const [actionMessage, setActionMessage] = useState("");
  const isValid = data?.valid ?? data?.status === "VALID";
  const score = data && data.percentage != null ? Math.min(100, Math.max(0, data.percentage)) : undefined;
  async function copyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setActionMessage(`${label} copied to clipboard.`);
    } catch {
      setActionMessage("Clipboard access is unavailable in this browser. You can copy the address from the browser bar.");
    }
  }
  return <main className="public-verify-page" id="main-content">
    <div className="public-verify-shell">
      <header className="public-verify-topbar"><Brand /><span>PUBLIC CREDENTIAL CHECK</span></header>
      <div className="public-verify-intro"><p className="eyebrow">VERITY · SECURE EXAMINATION</p><h1>Verify a result</h1><p>Confirm that an examination result was issued by Verity and check its current status.</p></div>
      <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
        {data && <section className={`public-verify-card${isValid ? " is-valid" : " is-invalid"}`} aria-labelledby="verify-record-title">
          <div className="verify-card-status">
            <span className={`verify-status-pill${isValid ? " is-valid" : data.status === "SUPERSEDED" ? " is-replaced" : " is-invalid"}`}>
              <span aria-hidden="true">{isValid ? "✓" : data.status === "SUPERSEDED" ? "↻" : "!"}</span>
              {isValid ? "Authentic result" : data.status === "SUPERSEDED" ? "Replaced result" : data.status === "REVOKED" ? "Revoked result" : "Not verified"}
            </span>
            <span className="verify-check-caption">{isValid ? "Record signature matched" : "Please review the status below"}</span>
          </div>
          {isValid ? <>
            <div className="verify-result-grid">
              <div className="verify-score-panel">
                <p className="verify-label">FINAL RESULT</p>
                <h2 id="verify-record-title">{data.examTitle ?? "Verified examination"}</h2>
                {score != null ? <div className="verify-score-display"><div className="verify-score-ring" role="img" aria-label={`Final score: ${score}%`} style={{ background: `conic-gradient(var(--success) ${score}%, var(--line) ${score}% 100%)` }}><span>{score}<small>%</small></span></div><p>Final score</p></div> : <p className="verify-score-unavailable">Score details were not included in this verification record.</p>}
              </div>
              <div className="verify-record-details"><p className="verify-label">ISSUED RECORD</p><h3>Examination details</h3>
                <dl>
                  {data.institution && <div><dt>Issuing institution</dt><dd>{data.institution}</dd></div>}
                  <div><dt>Candidate</dt><dd>{data.maskedName ?? "Identity withheld"}<small>Candidate identity is partially masked for privacy.</small></dd></div>
                  <div><dt>Date issued</dt><dd>{data.issuedAt ? <time dateTime={data.issuedAt}>{formatDate(data.issuedAt)}</time> : "Not provided"}</dd></div>
                  <div><dt>Verification reference</dt><dd className="verify-reference">{code.toUpperCase()}</dd></div>
                </dl>
              </div>
            </div>
            <div className="verify-authenticity-note"><span aria-hidden="true">✓</span><p><strong>This result is currently valid.</strong> The reference matches an issued record and its integrity check passed.</p></div>
          </> : <div className="verify-exception">
            <h2 id="verify-record-title">{data.status === "SUPERSEDED" ? "A newer result has been issued" : data.status === "REVOKED" ? "This result is no longer valid" : "No matching result found"}</h2>
            <p>{data.status === "SUPERSEDED" ? "This reference belongs to an earlier result. Use the current reference below to verify the latest issued record." : data.status === "REVOKED" ? "The issuing institution has revoked this result. Do not use it as proof of a current qualification." : "We could not find an issued result matching this reference. Check the code and try again, or contact the issuing institution."}</p>
            {data.status === "SUPERSEDED" && data.replacementCode && <Link className="button button-primary" to={"/verify/" + segment(data.replacementCode)}>Verify the current result <span aria-hidden="true">→</span></Link>}
            <div className="verify-old-reference"><span>Checked reference</span><code>{code.toUpperCase()}</code></div>
          </div>}
          <footer className="verify-card-footer"><div><strong>Verity Secure Examination</strong><span>Public result verification</span></div>
            <div className="verify-actions"><button className="button" onClick={() => void copyValue(window.location.href, "Verification link")}>Copy verification link</button><button className="button" onClick={() => void copyValue(code.toUpperCase(), "Reference code")}>Copy reference</button><button className="button" onClick={() => window.print()}>Print result</button></div>
            <p className="verify-action-message" role="status" aria-live="polite">{actionMessage}</p>
          </footer>
        </section>}
      </DataPanel>
      <p className="public-verify-help">Only limited candidate information is shown on this public page. For questions about a result, contact the institution listed on the record.</p>
    </div>
  </main>;
}
