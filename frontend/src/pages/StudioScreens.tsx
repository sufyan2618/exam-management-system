import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { display, formatDate, examWrite, newOperationKey, segment } from "../api/examination";
import type { Exam } from "../api/examination";
import { ExamMarkdown } from "../components/ExamMarkdown";
import { ActionError, DataPanel } from "../components/ExamData";
import { ActionForm, ResourcePanel } from "../components/ResourcePanel";
import type { Field, Row } from "../components/ResourcePanel";
import { useDownload } from "../hooks/useDownload";
import { useExamData } from "../hooks/useExamData";
import { getApiValidationIssues } from "../utils/api-error";
import { AttemptScreen } from "./AttemptScreens";

const states = ["DRAFT", "PUBLISHED", "ONGOING", "COMPLETED", "ARCHIVED"];
const difficulty = ["EASY", "MEDIUM", "HARD"];
const questionTypes = ["MCQ_SINGLE", "MCQ_MULTI", "WRITTEN"];
const searchFilter = { name: "q", label: "Search" };
const columns = (...entries: [string, string][]) => entries.map(([label, key]) => ({ label, key }));
const examLink = { label: "Examination", render: (row: Row) => <Link to={"/studio/exams/" + segment(row.id)}>{display(row.title)}</Link> };

export function StudioOverview({ list = false }: { list?: boolean }) {
  const query = useExamData<Exam[]>("/api/exams?pageSize=100", { enabled: !list, refreshMs: 30_000 });
  const [stage, setStage] = useState("ALL");
  const [search, setSearch] = useState("");
  const exams = query.data ?? [];
  const filtered = exams.filter((exam) => (stage === "ALL" || exam.state === stage) && exam.title.toLowerCase().includes(search.trim().toLowerCase()));
  const stageName = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();
  if (list) return <ResourcePanel title="Examinations" path="/api/exams" columns={[examLink, ...columns(["Status", "state"], ["Duration", "durationMinutes"])]}
    filters={[searchFilter, { name: "status", label: "Status", options: states }]} empty="No exams match these filters."
    toolbar={<Link className="button button-primary exam-create-button" to="/studio/exams/new">Create exam</Link>} />;
  return <div className="studio-dashboard">
    <section className="studio-welcome">
      <div><p className="eyebrow">Your examiner workspace</p><h2>Make room for<br /><span>great results.</span></h2><p>Build your next examination, keep delivery on track, and bring every result together.</p></div>
      <div className="studio-welcome-actions"><Link className="button button-primary" to="/studio/exams/new"><span aria-hidden="true">＋</span> Create examination</Link><Link className="studio-text-link" to="/studio/questions">Explore question bank →</Link></div>
    </section>
    <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
      {query.data && <>
        <div className="studio-stage-grid" role="group" aria-label="Filter examinations by stage">
          {states.slice(0, 4).map((state, index) => <button type="button" className="studio-stage-card" data-stage={state} key={state} aria-pressed={stage === state} onClick={() => setStage(stage === state ? "ALL" : state)}>
            <span className="studio-stage-label"><span className="studio-stage-dot" />{stageName(state)}<span className="studio-stage-index">0{index + 1}</span></span>
            <strong>{exams.filter((exam) => exam.state === state).length}</strong>
            <span className="studio-stage-hint">{["Prepare & configure", "Ready for candidates", "Monitor delivery", "Review & publish results"][index]}<span aria-hidden="true">↗</span></span>
          </button>)}
        </div>
        <div className="studio-dashboard-grid">
          <section className="studio-examinations">
            <header className="studio-section-heading"><div><h2>Your examinations</h2><p>{exams.length} loaded · Select a stage to focus your view</p></div><Link to="/studio/exams">View all →</Link></header>
            <div className="studio-exam-toolbar"><label><span className="exam-visually-hidden">Search loaded examinations</span><input type="search" placeholder="Search examinations…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select aria-label="Examination stage" value={stage} onChange={(event) => setStage(event.target.value)}><option value="ALL">All stages</option>{states.map((state) => <option value={state} key={state}>{stageName(state)}</option>)}</select></div>
            <div className="studio-exam-list">
              {filtered.map((exam) => {
                const hub = "/studio/exams/" + segment(exam.id);
                const next = exam.state === "DRAFT" ? ["Continue setup", hub + "/questions"] : exam.state === "ONGOING" ? ["Open monitor", hub + "/monitor"] : exam.state === "COMPLETED" ? ["Review grading", hub + "/grading"] : ["View candidates", hub + "/candidates"];
                return <article className="studio-exam-card" key={exam.id}>
                  <div className="studio-exam-card-top"><span className="studio-exam-status" data-stage={exam.state}>{stageName(exam.state)}</span><span className="studio-exam-duration">{exam.durationMinutes != null ? exam.durationMinutes + " min" : "Duration not set"}</span></div>
                  <h3><Link to={hub}>{exam.title}</Link></h3>
                  <p className="studio-exam-schedule">{exam.startsAt ? formatDate(exam.startsAt) : "Schedule not set"}</p>
                  <footer><span>{exam.totalMarks != null ? exam.totalMarks + " total marks" : "Marks not set"}</span><Link to={next[1]}>{next[0]} <span aria-hidden="true">→</span></Link></footer>
                </article>;
              })}
              {!filtered.length && <div className="studio-empty"><h3>{exams.length ? "No matching examinations" : "Your first examination starts here"}</h3><p>{exams.length ? "Try another stage or a different search." : "Create a draft, add your questions, then enroll candidates."}</p>{exams.length ? <button className="button button-ghost" onClick={() => { setStage("ALL"); setSearch(""); }}>Clear filters</button> : <Link className="button button-primary" to="/studio/exams/new">Create examination</Link>}</div>}
            </div>
          </section>
          <aside className="studio-utilities">
            <section className="studio-quick-tools"><p className="eyebrow">Keep things moving</p><h2>Studio essentials</h2>{[["01", "Question bank", "Build and organize reusable questions", "/studio/questions"], ["02", "Import center", "Upload questions from your files", "/studio/imports"], ["03", "Dispute inbox", "Review candidate concerns", "/studio/disputes"]].map(([number, title, description, path]) => <Link key={path} to={path}><span className="studio-tool-number">{number}</span><span><strong>{title}</strong><small>{description}</small></span><span aria-hidden="true">↗</span></Link>)}</section>
            <section className="studio-workflow"><p className="eyebrow">From draft to results</p><h3>A clear path to your next exam</h3><ol><li><strong>Prepare</strong><span>Set the schedule and build your paper.</span></li><li><strong>Deliver</strong><span>Enroll candidates and monitor attempts.</span></li><li><strong>Evaluate</strong><span>Review grades and publish results.</span></li></ol></section>
          </aside>
        </div>
      </>}
    </DataPanel>
  </div>;
}

const basicFields: Field[] = [
  { name: "title", label: "Exam title", min: 3, max: 200 },
  { name: "instructions", label: "Instructions", type: "textarea", optional: true },
  { name: "startsAt", label: "Opens (local time)", type: "datetime-local" },
  { name: "endsAt", label: "Closes (local time)", type: "datetime-local" },
  { name: "durationMinutes", label: "Duration in minutes", type: "number", min: 1, max: 600 },
  { name: "totalMarks", label: "Total marks", type: "number", min: 1, step: .25 },
  { name: "passMarks", label: "Pass marks", type: "number", min: 0, step: .25 },
];

function validateExamBasics(body: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  const start = typeof body.startsAt === "string" ? new Date(body.startsAt).getTime() : NaN;
  const end = typeof body.endsAt === "string" ? new Date(body.endsAt).getTime() : NaN;
  const duration = Number(body.durationMinutes);
  const total = Number(body.totalMarks);
  const pass = body.passMarks === undefined ? undefined : Number(body.passMarks);
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start) errors.endsAt = "Choose a closing time after the opening time.";
  if (Number.isFinite(start) && Number.isFinite(end) && end > start && Number.isFinite(duration) && duration * 60_000 > end - start) {
    errors.durationMinutes = "Duration cannot exceed the exam window. Increase the window or shorten the duration.";
  }
  if (pass !== undefined && Number.isFinite(total) && pass > total) errors.passMarks = "Pass marks cannot be greater than total marks.";
  return errors;
}

export function ExamWizard() {
  const [exam, setExam] = useState<Exam>();
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const id = exam ? segment(exam.id) : "";
  const path = "/api/exams" + (id ? "/" + id : "");
  const steps = ["Basics", "Rules", "Questions", "Candidates", "Review and publish"];
  return <>
    <header className="exam-wizard-heading"><p className="eyebrow">EXAMINER WORKSPACE / NEW EXAM</p><h1>{exam ? "Build your examination" : "Create an examination"}</h1><p>Start with the schedule and scoring. You can add questions and candidates in the next steps.</p></header>
    <ol className="exam-steps" aria-label="Creation steps">
      {steps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} aria-label={`Step ${index + 1}: ${label}${index < step ? ", complete" : index === step ? ", current" : ", upcoming"}`}><span className="exam-step-number">{index < step ? "✓" : index + 1}</span><span>{label}</span></li>)}
    </ol>
    <section className="account-card exam-record exam-wizard-card">
      <div className="exam-step-heading"><div><p className="eyebrow">STEP {step + 1} OF {steps.length}</p><h2>{steps[step]}</h2></div><p>{step === 0 ? "Set the exam identity, schedule, and scoring rules." : "Your draft is saved as you move through the setup."}</p></div>
      {step === 0 && <ActionForm action={{ path, method: exam ? "PATCH" : "POST", fields: basicFields, label: "Save draft and continue", validate: validateExamBasics }} done={(data) => {
        if (data && typeof data === "object" && "id" in data && typeof data.id === "string") { setExam(data as Exam); setStep(1); }
      }} />}
      {exam && step === 1 && <ActionForm action={{ path, method: "PATCH", label: "Save rules and continue", fields: [
        { name: "shuffleQuestions", label: "Shuffle questions", type: "checkbox" },
        { name: "shuffleOptions", label: "Shuffle choices", type: "checkbox" },
        { name: "maxAttempts", label: "Maximum attempts", type: "number", min: 1 },
        { name: "negativeMarking", label: "Negative marking", type: "number", min: 0, step: .25, optional: true },
        { name: "integrityLevel", label: "Integrity level", options: ["OFF", "STANDARD", "STRICT"] },
        { name: "multiSelectScheme", label: "Multiple selection scoring", options: ["ALL_OR_NOTHING","PARTIAL_PROPORTIONAL","PARTIAL_PENALTY"] },
        { name: "fairnessMode", label: "Paper fairness", options: ["OFF","BALANCED"] },
        { name: "lateEntryMinutes", label: "Late entry minutes", type: "number", min:0, max:600 },
        { name: "disputeWindowHours", label: "Dispute window (hours)", type:"number",min:1,max:720 },
        { name: "showAnswersAfterPublish", label: "Show answers after publication", type: "checkbox" },
      ] }} done={() => setStep(2)} />}
      {exam && step === 2 && <><ExamQuestions id={exam.id} /><div className="exam-wizard-step-actions"><p>You can return to the question paper and make changes before publishing.</p><button className="button button-primary" onClick={() => setStep(3)}>Continue to candidates <span aria-hidden="true">→</span></button></div></>}
      {exam && step === 3 && <><ExamCandidates id={exam.id} /><button className="button button-primary" onClick={() => setStep(4)}>Review draft</button></>}
      {exam && step === 4 && <PublishChecklist id={exam.id} title={exam.title} onPublished={() => navigate("/studio/exams/" + id)} />}
      {exam && <Link to={"/studio/exams/" + id}>Close wizard and open draft</Link>}
    </section>
  </>;
}

function ExamQuestions({ id }: { id: string }) {
  const path = "/api/exams/" + segment(id);
  const query = useExamData<{questions: {questionId:string; marks:number; section?:string}[]}>(path);
  const bank = useExamData<{id:string;stem:string;defaultMarks:number;type:string;difficulty:string}[]>("/api/questions?pageSize=100");
  const [bankSearch, setBankSearch] = useState("");
  const save = useMutation({mutationFn: (questions: {questionId:string;marks:number;section?:string}[]) => examWrite(path + "/questions", "PUT", {questions, syncTotalMarks:true}), onSuccess: () => void query.refetch()});
  const selected = query.data?.questions ?? [];
  const available = (bank.data ?? []).filter((question) => !selected.some((item) => item.questionId === question.id));
  const filtered = available.filter((question) => question.stem.toLowerCase().includes(bankSearch.trim().toLowerCase()));
  const totalMarks = selected.reduce((total, question) => total + question.marks, 0);
  function moveQuestion(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= selected.length || save.isPending) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target], next[index]];
    save.mutate(next);
  }
  return <div className="question-builder">
    <header className="question-builder-heading"><div><p className="eyebrow">PAPER BUILDER</p><h2>Build your question paper</h2><p>Choose questions from your bank, set their order, and balance the marks for this exam.</p></div>
      <div className="question-builder-summary" aria-label={`${selected.length} questions selected, ${totalMarks} total marks`}><div><strong>{selected.length}</strong><span>{selected.length === 1 ? "question" : "questions"}</span></div><i aria-hidden="true"/><div><strong>{Number(totalMarks.toFixed(2))}</strong><span>total marks</span></div></div>
    </header>
    <ActionError error={save.error}/>
    <DataPanel pending={query.isPending || bank.isPending} error={query.error ?? bank.error} retry={() => {void query.refetch(); void bank.refetch();}}>
      <section className="question-builder-section selected-question-section" aria-labelledby="selected-questions-title">
        <header className="question-builder-section-heading"><div><p className="eyebrow">YOUR PAPER</p><h3 id="selected-questions-title">Selected questions</h3><p>Arrange questions in the order candidates will see them.</p></div><span className="question-count-pill">{selected.length} selected</span></header>
        {selected.length ? <ol className="selected-question-list">{selected.map((question, index) => {
          const bankQuestion = bank.data?.find((item) => item.id === question.questionId);
          return <li className="selected-question-card" key={question.questionId}>
            <div className="selected-question-body"><div className="selected-question-meta"><span className="question-order">{String(index + 1).padStart(2, "0")}</span><span>Question {index + 1}</span>{bankQuestion && <><span className="question-info-tag">{bankQuestion.type.replaceAll("_", " ")}</span><span className="question-info-tag">{bankQuestion.difficulty}</span></>}</div>
              <div className="selected-question-stem"><ExamMarkdown text={bankQuestion?.stem ?? "This question is no longer available in the question bank."}/></div>
            </div>
            <div className="selected-question-actions" role="group" aria-label={`Actions for question ${index + 1}`}>
              <label className="question-mark-editor" key={`${question.questionId}-${question.marks}`}><span>Marks</span><input type="number" min={.25} step={.25} defaultValue={question.marks} disabled={save.isPending} aria-label={`Marks for question ${index + 1}`} onBlur={(event) => {
                const value = Number(event.currentTarget.value);
                if (!event.currentTarget.checkValidity() || !Number.isFinite(value) || value <= 0) { event.currentTarget.value = String(question.marks); return; }
                if (value !== question.marks) save.mutate(selected.map((item) => item.questionId === question.questionId ? { ...item, marks: value } : item));
              }}/></label>
              <button className="button" type="button" aria-label={`Move question ${index + 1} up`} disabled={save.isPending || index === 0} onClick={() => moveQuestion(index, -1)}>↑ <span>Move up</span></button>
              <button className="button" type="button" aria-label={`Move question ${index + 1} down`} disabled={save.isPending || index === selected.length - 1} onClick={() => moveQuestion(index, 1)}>↓ <span>Move down</span></button>
              <button className="button button-ghost question-remove-button" type="button" disabled={save.isPending} onClick={() => save.mutate(selected.filter((item) => item.questionId !== question.questionId))}>Remove</button>
            </div>
          </li>;
        })}</ol> : <div className="question-builder-empty"><span aria-hidden="true">＋</span><div><strong>Your paper is empty</strong><p>Add questions from your bank below or use the blueprint selector.</p></div></div>}
        {save.isPending && <p className="question-save-status" role="status">Saving your paper…</p>}
        {save.isSuccess && <p className="question-save-success" role="status">Your question paper has been updated.</p>}
      </section>
      <BlueprintPicker id={id} done={() => void query.refetch()}/>
      <section className="question-builder-section question-bank-picker" aria-labelledby="question-bank-title">
        <header className="question-bank-heading"><div><p className="eyebrow">QUESTION LIBRARY</p><h3 id="question-bank-title">Add from your question bank</h3><p>{available.length} {available.length === 1 ? "question" : "questions"} available to add to this paper.</p></div>
          <label className="question-bank-search"><span className="exam-visually-hidden">Search available questions</span><input type="search" value={bankSearch} onChange={(event) => setBankSearch(event.target.value)} placeholder="Search question text" /><span aria-hidden="true">⌕</span></label>
        </header>
        {available.length === 0 ? <p className="question-bank-empty">All available questions are already in this paper.</p> : filtered.length === 0 ? <p className="question-bank-empty">No questions match “{bankSearch}”. Try another search.</p> : <div className="question-bank-list">{filtered.map((question) => <article className="question-bank-card" key={question.id}>
          <div className="question-bank-card-text" tabIndex={0} aria-label="Question preview"><ExamMarkdown text={question.stem}/></div><div className="question-bank-card-footer"><div className="question-bank-tags"><span>{question.type.replaceAll("_", " ")}</span><span>{question.difficulty}</span><span>{question.defaultMarks} {question.defaultMarks === 1 ? "mark" : "marks"}</span></div><button className="button button-primary" type="button" disabled={save.isPending} onClick={() => save.mutate([...selected, { questionId: question.id, marks: question.defaultMarks }])}>Add to paper <span aria-hidden="true">＋</span></button></div>
        </article>)}</div>}
      </section>
    </DataPanel>
  </div>;
}

function ExamCandidates({ id }: { id: string }) {
  const path = "/api/exams/" + segment(id) + "/enrollments";
  const [revision, setRevision] = useState(0);
  return <>
    <details className="account-card"><summary>Enroll by email</summary>
      <ActionForm action={{ label: "Enroll candidates", path, fields: [{ name: "emails", label: "Email addresses (one per line)", type: "textarea" }] }} done={() => setRevision((value) => value + 1)} />
    </details>
    <ResourcePanel key={revision} title="Enrolled candidates" path={path} columns={columns(["Candidate", "name"], ["Enrollment", "status"], ["Attempt", "attemptStatus"], ["Extra minutes", "extraMinutes"])} empty="No candidates enrolled."
      toolbar={<Link to="/studio/imports">Import candidates</Link>}
      actions={(row) => row.id ? [
        { label: "Set extra time", method: "PATCH", path: path + "/" + segment(String(row.candidateId)), fields: [{ name: "extraTimeMinutes", label: "Extra minutes", type: "number", min: 0 }, { name: "reason", label: "Reason" }] },
        { label: "Remove enrollment", method: "DELETE", path: path + "/" + segment(String(row.candidateId)), confirm: String(row.name ?? row.id) },
      ] : []} />
  </>;
}

function AnnouncementPanel({ id, state }: { id: string; state?: Exam["state"] }) {
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const path = "/api/exams/" + segment(id) + "/announcements";
  return <section className="announcement-workspace">
    <header className="announcement-heading"><p className="eyebrow">EXAMINER TO CANDIDATE</p><h2>Announcements</h2><p>Send an update to candidates enrolled in this exam. New messages appear in their exam workspace.</p></header>
    {state === "DRAFT" ? <section className="account-card announcement-draft-notice"><h3>Publish this exam to send announcements</h3><p>Announcements become available once the exam is published.</p></section> : <section className="account-card announcement-composer"><h3>Send an update</h3><p>Use a normal message for routine updates or urgent for instructions candidates should notice right away.</p><ActionForm key={revision} action={{ label: "Send to candidates", path, fields: [
      { name: "message", label: "Message", type: "textarea", min: 1, max: 500 },
      { name: "priority", label: "Priority", options: ["NORMAL", "URGENT"] },
    ], initial: { priority: "NORMAL" } }} done={() => { setNotice("Announcement sent to candidates."); setRevision((value) => value + 1); }} />{notice && <p className="announcement-success" role="status">{notice}</p>}</section>}
    <section className="announcement-history"><header><h3>Sent announcements</h3><p>Review the updates sent for this exam.</p></header><ResourcePanel key={revision} title="Announcement history" path={path} empty="No announcements have been sent for this exam yet." columns={[
      { label: "Message", key: "message" },
      { label: "Priority", render: (row) => <span className={`announcement-priority${row.priority === "URGENT" ? " is-urgent" : ""}`}>{String(row.priority ?? "NORMAL")}</span> },
      { label: "Sent", render: (row) => formatDate(String(row.createdAt ?? "")) },
    ]} /></section>
  </section>;
}

function PublishChecklist({ id, title, onPublished }: { id: string; title: string; onPublished: () => void }) {
  const path = "/api/exams/" + segment(id);
  const query = useExamData<{ canPublish: boolean; checks: { id: string; label: string; passed: boolean }[] }>(path + "/preview");
  return <>
    <Link to={"/studio/exams/" + segment(id) + "/sandbox"}>Preview as candidate</Link>
    <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
      {query.data && <>
        <ul>{(query.data.checks ?? []).map((check) => <li key={check.id}>{check.passed ? "Passed" : "Needs attention"} · {check.label}</li>)}</ul>
        {query.data.canPublish && <ActionForm action={{ label: "Publish exam", path: path + "/publish", confirm: title, fields:[{name:"acknowledgeWarnings",label:"I reviewed any warnings",type:"checkbox"}] }} done={onPublished} />}
      </>}
    </DataPanel>
  </>;
}

export function ExamHub({ id, tab }: { id: string; tab: string }) {
  const path = "/api/exams/" + segment(id);
  const query = useExamData<Exam & { canEdit?: boolean; canArchive?: boolean }> (path);
  const exam = query.data;
  const [blind, setBlind] = useState(false);
  const [revision, setRevision] = useState(0);
  switch (tab) {
    case "questions": return <ExamQuestions id={id} />;
    case "candidates": return <ExamCandidates id={id} />;
    case "announcements": return query.isPending || query.error
      ? <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()} />
      : <AnnouncementPanel id={id} state={exam?.state} />;
    case "monitor": return <>
      <p>Integrity indicators are not conclusive evidence of misconduct.</p>
      <ResourcePanel title="Live attempts" path={path + "/monitor/attempts"} refreshMs={5000} stream={path + "/monitor/stream"} empty="No attempts to monitor."
        columns={[...columns(["Candidate", "candidateName"], ["Answered", "answered"], ["Last seen", "lastSeenAt"], ["Connection", "connection"]), {label:"Indicators",render:row=>{const integrity = row.integrity as {band?:string}|undefined; const count = Number(row.incidentCount ?? 0); return <span className={`monitor-indicator-count${count ? " has-events" : ""}`}>{count} open · {integrity?.band ?? "LOW"} band</span>;}}, {label:"Details",render:row=><MonitorDetails id={row.id}/>}]}
        actions={(row) => row.id ? [
          { label: "Extend time", path: "/api/attempts/" + segment(row.id) + "/extend-time", fields: [{ name: "minutes", label: "Extra minutes", type: "number", min: 1 }, { name: "reason", label: "Reason" }] },
          { label: "Force submit", path: "/api/attempts/" + segment(row.id) + "/force-submit", confirm: String(row.candidateName ?? row.id), fields: [{ name: "reason", label: "Reason" }] },
        ] : []} />
    </>;
    case "grading": return <>
      <details className="account-card"><summary>Regrade and moderation</summary>
        <ActionForm action={{label:"Regrade objective answers",path:path+"/regrade",fields:[{name:"reason",label:"Reason",min:5,max:1000}]}} done={()=>setRevision(v=>v+1)}/>
        <ActionForm action={{label:"Apply moderation",path:path+"/moderation",method:"PATCH",fields:[{name:"mode",label:"Mode",options:["NONE","ADDITIVE"]},{name:"offset",label:"Score adjustment",type:"number",step:.25,min:-1000,max:1000},{name:"note",label:"Explanation",min:5,max:500}]}} done={()=>setRevision(v=>v+1)}/>
      </details>
      <label className="exam-inline"><input type="checkbox" checked={blind} onChange={(event) => setBlind(event.target.checked)} /> Blind grading</label>
      <ResourcePanel key={String(blind)+revision} title="Grading queue" path={path + "/grading/queue?blind=" + blind} empty="The grading queue is empty."
        columns={columns(...(blind ? [] : [["Candidate", "candidateName"]] as [string, string][]), ["Question", "question"], ["Answer", "answer"], ["Rubric", "rubric"], ["Status", "status"])}
        actions={(row) => row.id ? [{ label: "Save grade", path: "/api/answers/" + segment(row.id) + "/grade", method: "PUT", fields: [{ name: "score", label: "Marks", type: "number", min: 0, max: typeof row.maxMarks === "number" ? row.maxMarks : undefined, step: .25 }, { name: "feedback", label: "Feedback", type: "textarea", optional: true }] }] : []} />
    </>;
    case "results": return <>
      <ActionForm action={{label:"Publish results",path:path+"/results/publish",confirm:exam?.title,fields:[{name:"acknowledge",label:"I reviewed the grading state and results",type:"checkbox"}]}} done={() => setRevision(v=>v+1)}/>
      <ActionForm action={{label:"Unpublish results",path:path+"/results/unpublish",fields:[{name:"note",label:"Reason",min:5,max:500}]}} done={() => setRevision(v=>v+1)}/>
      <ResourcePanel key={revision} title="Exam results" path={path+"/results"} empty="No results to display." columns={columns(["Candidate","candidateName"],["Score","totalScore"],["Grading","gradingState"],["Published","isPublished"])}/>
    </>;
    case "analytics": return <Analytics id={id} />;
    case "disputes": return <DisputeInbox path={path + "/disputes"} />;
    default: return <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
      {exam && <section className="account-card exam-record">
        <span className="exam-stamp">{exam.state}</span><h2>{exam.title}</h2>
        <p>{formatDate(exam.startsAt)} to {formatDate(exam.endsAt)}</p>{exam.instructions && <ExamMarkdown text={exam.instructions} />}
        {tab === "settings" && exam.state === "DRAFT" && <ActionForm action={{ path, method: "PATCH", label: "Update exam", fields: basicFields, initial: exam }} done={() => void query.refetch()} />}
        {tab === "settings" && exam.state === "COMPLETED" && <ActionForm action={{ path: path + "/archive", label: "Archive exam", confirm: exam.title }} done={() => void query.refetch()} />}
        {tab !== "settings" && <ExamReports id={id} />}
        {tab !== "settings" && exam.state === "DRAFT" && <PublishChecklist id={id} title={exam.title} onPublished={() => void query.refetch()} />}
      </section>}
    </DataPanel>;
  }
}

function ExamReports({ id }: { id: string }) {
  const path = "/api/exams/" + segment(id);
  const pdf = useDownload(path + "/report.pdf", "examination.pdf");
  const csv = useDownload(path + "/results.csv", "examination-results.csv");
  return <div className="exam-actions">
    <button className="button" disabled={pdf.isPending} onClick={() => pdf.mutate()}>Download exam PDF</button>
    <button className="button" disabled={csv.isPending} onClick={() => csv.mutate()}>Download results CSV</button>
    <ActionError error={pdf.error ?? csv.error} />
  </div>;
}

function Analytics({ id }: { id: string }) {
  const path = "/api/exams/" + segment(id) + "/analytics";
  const fairness = useExamData<{mode:string;attempts:number;difficultyIndex:{mean:number;spread:number};note:string}>("/api/exams/"+segment(id)+"/fairness");
  const query = useExamData<{ mean?: number; median?: number; passRate?: number; completionRate?: number; distribution?: { range: string; count: number }[]; fairness?: string }>(path);
  return <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
    {query.data && <section className="account-card exam-record">
      <h2>Score summary</h2>
      <dl className="exam-facts">{([["Mean", query.data.mean], ["Median", query.data.median], ["Pass rate", query.data.passRate], ["Completion rate", query.data.completionRate]] as const).map(([label, value]) =>
        <div key={label}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>)}</dl>
      {!!query.data.distribution?.length && <><h3>Score distribution</h3><ul className="exam-histogram">
        {query.data.distribution.map((bin) => <li key={bin.range}><span>{bin.range}</span><meter min={0} max={Math.max(1, ...query.data!.distribution!.map((entry) => entry.count))} value={bin.count} aria-label={bin.range} /><span>{bin.count}</span></li>)}
      </ul></>}
      {query.data.fairness && <><h3>Fairness</h3><p>{query.data.fairness}</p></>}
    </section>}
    {fairness.data && <section className="account-card exam-record"><h2>Paper fairness</h2><p>{fairness.data.mode} · {fairness.data.attempts} completed attempts</p><p>Mean difficulty {fairness.data.difficultyIndex.mean} · Spread {fairness.data.difficultyIndex.spread}</p><p>{fairness.data.note}</p></section>}
    <ResourcePanel title="Question analytics" path={path + "/questions"} empty="No question statistics are available."
      columns={columns(["Question", "stem"], ["Correctness", "correctRate"], ["Skip rate", "skipRate"], ["Discrimination", "discrimination"])} />
  </DataPanel>;
}

export function DisputeInbox({ path }: { path: string }) {
  return <ResourcePanel title="Dispute inbox" path={path} empty="No disputes in this inbox."
    filters={[{ name: "status", label: "Status", options: ["OPEN", "UNDER_REVIEW", "ESCALATED", "RESOLVED_ACCEPTED", "RESOLVED_REJECTED"] }]}
    columns={[...columns(["Exam", "examId"], ["Type", "type"], ["Reason", "reason"], ["Status", "status"], ["Due", "slaDueAt"]),{label:"Evidence",render:row=><DisputeDetails id={row.id}/>}]}
    actions={(row) => [
      ...(row.canResolve === row.id ? [{ label: "Resolve dispute", path: "/api/disputes/" + segment(row.id) + "/resolve", fields: [
        { name: "outcome", label: "Decision", options: ["ACCEPT", "REJECT", "PARTIAL"] },
        { name: "newScore", label: "Revised score", type: "number" as const, min: 0, step: .25, optional: true },
        { name: "note", label: "Reviewer note", type: "textarea" as const },
      ] }] : []),
      ...(row.canEscalate === row.id ? [{ label: "Escalate", path: "/api/disputes/" + segment(row.id) + "/escalate", fields: [{ name: "note", label: "Reason", type: "textarea" as const }] }] : []),
    ]} />;
}

export function QuestionBank() {
  const path = "/api/questions";
  const categories = useExamData<{id: string; name: string; parentId?: string}[]>("/api/categories");
  const [categoryId, setCategoryId] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const fields: Field[] = [
    { name: "stem", label: "Question text", type: "textarea" },
    { name: "difficulty", label: "Difficulty", options: difficulty },
    { name: "defaultMarks", label: "Marks", type: "number", min: .25, step: .25 },
    { name: "tags", label: "Tags (comma separated)", optional: true },
    { name: "explanation", label: "Explanation", type: "textarea", optional: true },
  ];
  const category = categories.data?.find((item) => item.id === categoryId);
  return <div className="question-bank">
    <header className="bank-intro"><div><p className="eyebrow">Your teaching library</p><h2>Great examinations start here.</h2><p>Organize your topics, build questions, and keep your next paper within reach.</p></div><button className="button button-primary" onClick={() => setEditorOpen(true)}>+ New question</button></header>
    {editorOpen && <QuestionEditorDialog onClose={() => setEditorOpen(false)} onSave={() => { setEditorOpen(false); setRevision((value) => value + 1); }} />}
    <div className="bank-layout">
      <aside className="bank-categories">
        <header><h2>Categories</h2><span>{categories.data?.length ?? "—"}</span></header>
        <DataPanel pending={categories.isPending} error={categories.error} retry={() => void categories.refetch()}>
          <nav aria-label="Question categories"><button className="bank-category" aria-pressed={!categoryId} onClick={() => setCategoryId("")}><span className="bank-category-symbol" aria-hidden="true">▦</span><span>All categories</span></button>
          {categories.data?.map((item) => <button className="bank-category" key={item.id} aria-pressed={categoryId === item.id} onClick={() => setCategoryId(item.id)}><span className="bank-category-symbol" aria-hidden="true">{item.parentId ? "↳" : "#"}</span><span>{item.name}</span></button>)}</nav>
          {categories.data?.length === 0 && <p className="bank-category-empty">Add a category to organize your first questions.</p>}
        </DataPanel>
        <button className="button button-ghost bank-add-category" aria-expanded={creatingCategory} onClick={() => setCreatingCategory(!creatingCategory)}>{creatingCategory ? "Cancel" : "+ Add category"}</button>
        {creatingCategory && <ActionForm action={{label:"Create category",path:"/api/categories",fields:[{name:"name",label:"Category name",min:1,max:100}]}} done={() => { void categories.refetch(); setCreatingCategory(false); }} />}
        <p className="bank-category-note">Select a category to focus your library. Categories are also available when creating a question.</p>
      </aside>
      <section className="bank-questions" aria-label="Questions">
        <header className="bank-section-heading"><div><h2>{category?.name ?? "All questions"}</h2><p>Search, review, and manage your reusable questions.</p></div>{categoryId && <button className="button button-ghost" onClick={() => setCategoryId("")}>Clear category</button>}</header>
        <ResourcePanel key={revision + categoryId} title="Question bank" path={path + (categoryId ? "?categoryId=" + segment(categoryId) : "")}
          columns={[{label:"Question",render:(row) => <div className="bank-question-cell"><ExamMarkdown text={String(row.stem ?? "")} /><span>{categories.data?.find((item) => item.id === row.categoryId)?.name ?? "Category unavailable"}</span></div>}, ...columns(["Type", "type"], ["Difficulty", "difficulty"], ["Marks", "defaultMarks"], ["Version", "version"])]}
          empty="No questions match this view. Adjust your filters or create a new question." filters={[searchFilter, { name: "difficulty", label: "Difficulty", options: difficulty }, { name: "type", label: "Type", options: questionTypes }]} modalActions
            actions={(row) => row.id ? [
            { label: "Edit question", method: "PATCH", path: path + "/" + segment(row.id), fields, initial: row },
            { label: "Duplicate question", path: path + "/" + segment(row.id) + "/duplicate" },
            { label: "Archive question", method: "DELETE", path: path + "/" + segment(row.id), confirm: "ARCHIVE" },
          ] : []} />
      </section>
    </div>
  </div>;
}

function QuestionEditorDialog({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const current = dialog.current;
    if (current && !current.open) current.showModal();
  }, []);
  return <dialog ref={dialog} className="question-editor-dialog question-create-dialog" aria-labelledby="question-create-title" onClose={onClose}>
    <header className="question-dialog-header"><p className="eyebrow">QUESTION BANK / NEW</p><button type="button" className="button button-ghost question-editor-close" onClick={() => dialog.current?.close()}>Close</button></header>
    <QuestionEditor onSave={onSave} title="New question" titleId="question-create-title" />
    <button type="button" className="button question-dialog-cancel" onClick={() => dialog.current?.close()}>Cancel</button>
  </dialog>;
}

function QuestionEditor({ onSave, title = "New question", titleId }: { onSave: () => void; title?: string; titleId?: string }) {
  const [kind, setKind] = useState("MCQ_SINGLE");
  const [options, setOptions] = useState([{ id: newOperationKey(), text: "", isCorrect: false }, { id: newOperationKey(), text: "", isCorrect: false }]);
  const [stem, setStem] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const categories = useExamData<{id:string;name:string}[]>("/api/categories");
  const save = useMutation({
    mutationFn: (body: unknown) => examWrite("/api/questions", "POST", body),
    onSuccess: onSave,
  });
  const serverErrors = Object.fromEntries(getApiValidationIssues(save.error).map((issue) => [
    issue.field.startsWith("options") ? "options" : issue.field === "defaultMarks" ? "marks" : issue.field,
    issue.message,
  ]));
  const errors = { ...serverErrors, ...formErrors };
  const clearError = (field: string) => {
    save.reset();
    setFormErrors((current) => ({ ...current, [field]: "" }));
  };
  const fieldIds: Record<string, string> = { stem: "question-stem", marks: "question-marks", difficulty: "question-difficulty", categoryId: "question-category", rubric: "question-rubric", tags: "question-tags", options: "question-options" };
  const fieldId = (field: string) => /^options\.\d+\.text$/.test(field) ? `question-option-${field.split(".")[1]}` : fieldIds[field] ?? field;
  return <form className="exam-form" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const categoryId = String(data.get("categoryId") ?? "");
    const marks = Number(data.get("marks"));
    const rubric = String(data.get("rubric") ?? "").trim();
    const tags = String(data.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
    const validation: Record<string, string> = {};
    if (stem.trim().length < 3) validation.stem = "Enter at least 3 characters for the question.";
    else if (stem.trim().length > 10_000) validation.stem = "Keep question text under 10,000 characters.";
    if (!Number.isFinite(marks) || marks <= 0) validation.marks = "Enter a marks value greater than 0.";
    else if (marks > 10_000) validation.marks = "Marks cannot exceed 10,000.";
    else if (Math.abs(marks * 4 - Math.round(marks * 4)) > 1e-8) validation.marks = "Marks must use increments of 0.25.";
    if (!categoryId) validation.categoryId = "Choose a category for this question.";
    if (kind === "WRITTEN" && !rubric) validation.rubric = "Add a marking rubric for written questions.";
    else if (rubric.length > 5000) validation.rubric = "Keep the marking rubric under 5,000 characters.";
    if (tags.length > 20 || tags.some((tag) => tag.length > 40)) validation.tags = "Use at most 20 tags, each 40 characters or fewer.";
    if (kind !== "WRITTEN") {
      if (options.length < 2 || options.length > 10) validation.options = "Add between 2 and 10 answer options.";
      else if (options.some((option) => !option.text.trim())) validation.options = "Fill in the text for every answer option.";
      else if (options.some((option) => option.text.trim().length > 1000)) validation.options = "Keep each answer option under 1,000 characters.";
      else if (new Set(options.map((option) => option.text.trim().toLocaleLowerCase())).size !== options.length) validation.options = "Make each answer option unique.";
      else if (kind === "MCQ_SINGLE" && options.filter((option) => option.isCorrect).length !== 1) validation.options = "Select exactly one correct answer.";
      else if (kind === "MCQ_MULTI" && !options.some((option) => option.isCorrect)) validation.options = "Select at least one correct answer.";
    }
    setFormErrors(validation);
    if (Object.keys(validation).length) {
      const first = Object.keys(validation)[0];
      document.getElementById(fieldIds[first] ?? "question-options")?.focus();
      return;
    }
    save.mutate({ stem: stem.trim(), type: kind, categoryId, defaultMarks: marks, difficulty: data.get("difficulty"),
      tags,
      ...(kind === "WRITTEN" ? { rubric } : { options: options.map(({ text, isCorrect }) => ({ text: text.trim(), isCorrect })) }) });
  }} noValidate>
    {Object.entries(formErrors).some(([, message]) => !!message) && <div className="exam-validation-summary" role="alert" aria-live="assertive"><strong>Check these fields before saving:</strong><ul>{Object.entries(formErrors).filter(([, message]) => !!message).map(([field, message]) => <li key={field}><a href={`#${fieldId(field)}`}>{({stem:"Question text",marks:"Marks",categoryId:"Category",rubric:"Marking rubric",tags:"Tags",options:"Answer options"} as Record<string,string>)[field] ?? field}: {message}</a></li>)}</ul></div>}
    <h2 id={titleId}>{title}</h2>
    {categories.error && <><ActionError error={categories.error} /><button type="button" className="button" onClick={() => void categories.refetch()}>Retry loading categories</button></>}
    {!categories.isPending && !categories.error && categories.data?.length === 0 && <p className="exam-field-error" role="status">Create a category from the Question bank panel before saving a question.</p>}
    <label>Question type<select value={kind} onChange={(event) => {
      clearError("type"); clearError("options"); clearError("rubric");
      setKind(event.target.value);
      setOptions((items) => items.map((item) => ({ ...item, isCorrect: false })));
    }}>{questionTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
    <label htmlFor="question-stem">Question text<textarea id="question-stem" aria-invalid={!!errors.stem} aria-describedby={errors.stem ? "question-stem-error" : undefined} required value={stem} onChange={(event) => { setStem(event.target.value); clearError("stem"); }} /></label>{errors.stem && <span id="question-stem-error" className="exam-field-error">{errors.stem}</span>}
    {stem && <details><summary>Preview</summary><ExamMarkdown text={stem} /></details>}
    <label htmlFor="question-marks">Marks<input id="question-marks" aria-invalid={!!errors.marks} aria-describedby={errors.marks ? "question-marks-error" : undefined} type="number" name="marks" min=".25" step=".25" required onChange={() => clearError("marks")} /></label>{errors.marks && <span id="question-marks-error" className="exam-field-error">{errors.marks}</span>}
    <label htmlFor="question-difficulty">Difficulty<select id="question-difficulty" name="difficulty" aria-invalid={!!errors.difficulty} onChange={() => clearError("difficulty")}>{difficulty.map((value) => <option key={value}>{value}</option>)}</select>{errors.difficulty && <span className="exam-field-error">{errors.difficulty}</span>}</label>
    <label htmlFor="question-category">Category<select id="question-category" aria-invalid={!!errors.categoryId} aria-describedby={errors.categoryId ? "question-category-error" : undefined} name="categoryId" required onChange={() => clearError("categoryId")}><option value="">Select category</option>{categories.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{errors.categoryId && <span id="question-category-error" className="exam-field-error">{errors.categoryId}</span>}<label htmlFor="question-tags">Tags<input id="question-tags" aria-invalid={!!errors.tags} aria-describedby={errors.tags ? "question-tags-error" : undefined} name="tags" onChange={() => clearError("tags")} />{errors.tags && <span id="question-tags-error" className="exam-field-error">{errors.tags}</span>}</label>
    {kind === "WRITTEN" ? <label htmlFor="question-rubric">Rubric<textarea id="question-rubric" aria-invalid={!!errors.rubric} aria-describedby={errors.rubric ? "question-rubric-error" : undefined} name="rubric" required onChange={() => clearError("rubric")} />{errors.rubric && <span id="question-rubric-error" className="exam-field-error">{errors.rubric}</span>}</label> : <fieldset id="question-options" tabIndex={-1} aria-invalid={!!errors.options} aria-describedby={errors.options ? "question-options-error" : undefined} className="exam-form">
      <legend>Answer options</legend>
      {options.map((option, index) => <div key={option.id} className="exam-actions">
        <label htmlFor={`question-option-${index}`}>Option {index + 1}<input id={`question-option-${index}`} required aria-invalid={!!errors.options} value={option.text} onChange={(event) => { setOptions((items) => items.map((item) => item.id === option.id ? { ...item, text: event.target.value } : item)); clearError("options"); }} /></label>
        <label className="exam-inline"><input type={kind === "MCQ_SINGLE" ? "radio" : "checkbox"} name="correct" checked={option.isCorrect}
          onChange={(event) => { setOptions((items) => items.map((item) => item.id === option.id ? { ...item, isCorrect: event.target.checked } : kind === "MCQ_SINGLE" ? { ...item, isCorrect: false } : item)); clearError("options"); }} />Correct</label>
        <button type="button" className="button" disabled={options.length <= 2} onClick={() => { setOptions((items) => items.filter((item) => item.id !== option.id)); clearError("options"); }}>Remove</button>
      </div>)}
      {errors.options && <span id="question-options-error" className="exam-field-error">{errors.options}</span>}
      <button type="button" className="button" disabled={options.length >= 10} onClick={() => { setOptions((items) => [...items, { id: newOperationKey(), text: "", isCorrect: false }]); clearError("options"); }}>Add option</button>
    </fieldset>}
    <ActionError error={save.error} fields={[{name:"stem",label:"Question text"},{name:"type",label:"Question type"},{name:"categoryId",label:"Category"},{name:"difficulty",label:"Difficulty"},{name:"defaultMarks",label:"Marks"},{name:"options",label:"Answer options"},{name:"rubric",label:"Marking rubric"},{name:"tags",label:"Tags"}]} /><button className="button button-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save question"}</button>
  </form>;
}

export function Sandbox({ id }: { id: string }) {
  const [key, setKey] = useState(newOperationKey);
  const [attemptId, setAttemptId] = useState<string>();
  const launch = useMutation({
    mutationFn: () => examWrite<{ attemptId: string }>("/api/exams/" + segment(id) + "/sandbox/attempts", "POST", {}, key),
    onSuccess: (data) => { if (data?.attemptId) setAttemptId(data.attemptId); setKey(newOperationKey()); },
  });
  const exit = "/studio/exams/" + segment(id);
  const reset = useMutation({mutationFn:()=>examWrite("/api/exams/"+segment(id)+"/sandbox/attempts","DELETE"), onSuccess:()=>setAttemptId(undefined)});
  if (attemptId) return <><button className="button" disabled={reset.isPending} onClick={()=>reset.mutate()}>Reset sandbox</button><ActionError error={reset.error}/><AttemptScreen id={attemptId} sandbox exit={exit} /></>;
  return <section className="account-card exam-record"><p>This preview uses a sandbox attempt. It does not affect real results.</p>
    <button className="button button-primary" disabled={launch.isPending} onClick={() => launch.mutate()}>Start candidate preview</button>
    <ActionError error={launch.error} /><Link to={exit}>Return to exam</Link>
  </section>;
}

function DisputeDetails({id}:{id:string}) {
 const [open,setOpen]=useState(false);
 const query=useExamData<{question?:{stem:string;currentScore:number;marks:number};events:{at:string;action:string;note?:string}[];awaitingCountersign?:boolean}>("/api/disputes/"+segment(id),{enabled:open});
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>Open case</summary>{open && <DataPanel pending={query.isPending} error={query.error} retry={()=>void query.refetch()}>{query.data?.question && <><ExamMarkdown text={query.data.question.stem}/><p>{query.data.question.currentScore} / {query.data.question.marks}</p></>}<ol>{query.data?.events.map((e,i)=><li key={i}>{formatDate(e.at)} · {e.action} {e.note}</li>)}</ol><ActionForm action={{label:"Add comment",path:"/api/disputes/"+segment(id)+"/comments",fields:[{name:"note",label:"Comment",min:2,max:2000}]}} done={()=>void query.refetch()}/>{query.data?.awaitingCountersign && <><ActionForm action={{label:"Countersign resolution",path:"/api/disputes/"+segment(id)+"/countersign",confirm:id}} done={()=>void query.refetch()}/><ActionForm action={{label:"Reject proposal",path:"/api/disputes/"+segment(id)+"/reject-proposal",fields:[{name:"note",label:"Reason",min:3,max:1000}]}} done={()=>void query.refetch()}/></>}</DataPanel>}</details>;
}
function MonitorDetails({id}:{id:string}) {
 const [open,setOpen]=useState(false);
 const query=useExamData<{candidate?:{fullName:string};status:string;answered:number;remainingSeconds:number;events:{id:string;type:string;severity:string;occurredAt:string;reviewStatus:string}[]}>("/api/attempts/"+segment(id)+"/monitor",{enabled:open,refreshMs:5000});
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>Attempt timeline</summary>{open && <DataPanel pending={query.isPending} error={query.error} retry={()=>void query.refetch()}><h3>{query.data?.candidate?.fullName}</h3><p>{query.data?.status} · {query.data?.answered} answered · {query.data?.remainingSeconds} seconds remaining</p>{query.data?.events.map(e=><article key={e.id}><p>{formatDate(e.occurredAt)} · {e.type} · {e.severity} · {e.reviewStatus}</p><ActionForm action={{label:"Review indicator",path:"/api/integrity-events/"+segment(e.id),method:"PATCH",fields:[{name:"status",label:"Review",options:["REVIEWED","DISMISSED","CONFIRMED"]},{name:"note",label:"Review note",min:3,max:1000}]}} done={()=>void query.refetch()}/></article>)}<ResourcePanel title="Interruptions" path={"/api/attempts/"+segment(id)+"/interruptions"} empty="No interruptions recorded." columns={columns(["Started","startedAt"],["Gap seconds","gapSeconds"],["Status","status"])} actions={row=>[{label:"Review interruption",path:"/api/attempts/"+segment(id)+"/interruptions/"+segment(row.id)+"/review",fields:[{name:"approve",label:"Approve interruption credit",type:"checkbox"},{name:"note",label:"Reason"}]}]}/></DataPanel>}</details>;
}

function BlueprintPicker({id,done}:{id:string;done:()=>void}) {
 const categories=useExamData<{id:string;name:string}[]>("/api/categories");
 const [categoryId,setCategory]=useState("");const [difficulty,setDifficulty]=useState("MEDIUM");const [count,setCount]=useState(1);const [marksEach,setMarks]=useState(1);
 const select=useMutation({mutationFn:()=>examWrite("/api/exams/"+segment(id)+"/questions/auto-select","POST",{slots:[{categoryId,difficulty,count,marksEach}],replace:false,syncTotalMarks:true}),onSuccess:done});
 return <details className="account-card blueprint-picker"><summary><span><strong>Select questions by blueprint</strong><small>Automatically choose questions by category and difficulty.</small></span><span className="blueprint-toggle" aria-hidden="true">＋</span></summary><form className="exam-form blueprint-form" onSubmit={e=>{e.preventDefault();select.mutate();}}><label>Category<select required disabled={categories.isPending || !!categories.error || !categories.data?.length} value={categoryId} onChange={e=>setCategory(e.target.value)}><option value="">{categories.isPending ? "Loading categories…" : categories.error ? "Could not load categories" : categories.data?.length ? "Select category" : "No categories available"}</option>{categories.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Difficulty<select value={difficulty} onChange={e=>setDifficulty(e.target.value)}>{["EASY","MEDIUM","HARD"].map(d=><option key={d}>{d}</option>)}</select></label><label>Number of questions<input required type="number" min={1} max={500} value={count} onChange={e=>setCount(Number(e.target.value))}/></label><label>Marks per question<input required type="number" min={.25} step={.25} value={marksEach} onChange={e=>setMarks(Number(e.target.value))}/></label>{categories.error && <p className="blueprint-category-error" role="alert">Categories could not be loaded. <button className="button" type="button" onClick={() => void categories.refetch()}>Try again</button></p>}{!categories.isPending && !categories.error && !categories.data?.length && <p className="blueprint-category-error">Add at least one category to your question bank before using blueprint selection.</p>}<button className="button button-primary" disabled={select.isPending || !categoryId || !!categories.error}>{select.isPending ? "Selecting questions…" : "Add blueprint questions"}</button><ActionError error={select.error}/></form></details>;
}
