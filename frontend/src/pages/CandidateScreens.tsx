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
    {attempt && !id && <form className="account-card exam-record exam-form" onSubmit={(event) => { event.preventDefault(); if (reason.trim().length >= 20) change.mutate(); }}>
      <h2>File a dispute</h2>
      <label>Dispute type<select value={type} onChange={(event) => setType(event.target.value)}>
        <option value="TECHNICAL_INCIDENT">Technical incident</option><option value="GRADING_ERROR">Grading error</option><option value="AMBIGUOUS_QUESTION">Ambiguous question</option>
      </select></label>
      {type !== "TECHNICAL_INCIDENT" && <label>Question<select required value={questionId} onChange={e=>setQuestionId(e.target.value)}><option value="">Select question</option>{result.data?.questions.map(q=><option key={q.attemptQuestionId} value={q.attemptQuestionId}>Question {q.position+1}: {q.stem.slice(0,80)}</option>)}</select></label>}
      <label>Reason<textarea required minLength={20} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <small>{reason.length} / 2,000 characters</small>
      <button className="button button-primary" disabled={reason.trim().length < 20 || change.isPending}>Submit dispute</button>
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
  return <main className="account-page" id="main-content">
    <h1>Verify a result</h1>
    <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
      {data && <section className="account-card exam-record">
        {data.status === "VALID" ? <>
          <span className="exam-stamp">Valid</span><h2>{data.examTitle}</h2>
          <p>{data.institution}</p><p>Candidate: {data.maskedName ?? "—"}</p>
          <p>Issued {formatDate(data.issuedAt)}{data.percentage != null ? " · " + data.percentage + "%" : ""}</p>
        </> : data.status === "SUPERSEDED" && data.replacementCode ? <>
          <h2>This result has been replaced</h2><Link to={"/verify/" + segment(data.replacementCode)}>Check the current result</Link>
        </> : <p>This result could not be verified.</p>}
      </section>}
    </DataPanel>
  </main>;
}
