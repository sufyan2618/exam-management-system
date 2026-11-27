import { useState } from "react";
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
    toolbar={<Link className="button button-primary" to="/studio/exams/new">Create exam</Link>} />;
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

export function ExamWizard() {
  const [exam, setExam] = useState<Exam>();
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const id = exam ? segment(exam.id) : "";
  const path = "/api/exams" + (id ? "/" + id : "");
  const steps = ["Basics", "Rules", "Questions", "Candidates", "Review and publish"];
  return <>
    <ol className="exam-steps" aria-label="Creation steps">
      {steps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}>{index + 1}. {label}</li>)}
    </ol>
    <section className="account-card exam-record">
      <h2>{steps[step]}</h2>
      {step === 0 && <ActionForm action={{ path, method: exam ? "PATCH" : "POST", fields: basicFields, label: "Save draft and continue" }} done={(data) => {
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
      {exam && step === 2 && <><ExamQuestions id={exam.id} /><button className="button button-primary" onClick={() => setStep(3)}>Continue to candidates</button></>}
      {exam && step === 3 && <><ExamCandidates id={exam.id} /><button className="button button-primary" onClick={() => setStep(4)}>Review draft</button></>}
      {exam && step === 4 && <PublishChecklist id={exam.id} title={exam.title} onPublished={() => navigate("/studio/exams/" + id)} />}
      {exam && <Link to={"/studio/exams/" + id}>Close wizard and open draft</Link>}
    </section>
  </>;
}

function ExamQuestions({ id }: { id: string }) {
  const path = "/api/exams/" + segment(id);
  const query = useExamData<{questions: {questionId:string; marks:number; section?:string}[]}>(path);
  const bank = useExamData<{id:string;stem:string;defaultMarks:number}[]>("/api/questions?pageSize=100");
  const save = useMutation({mutationFn: (questions: {questionId:string;marks:number;section?:string}[]) => examWrite(path + "/questions", "PUT", {questions, syncTotalMarks:true}), onSuccess: () => void query.refetch()});
  const selected = query.data?.questions ?? [];
  return <><ActionError error={save.error}/><DataPanel pending={query.isPending || bank.isPending} error={query.error ?? bank.error} retry={() => {void query.refetch(); void bank.refetch();}}>
    <h2>Selected questions</h2><ol>{selected.map((q,index) => <li key={q.questionId}>{bank.data?.find(b => b.id === q.questionId)?.stem ?? q.questionId} · {q.marks} marks
      <button className="button" disabled={save.isPending || index===0} onClick={() => {const next=[...selected]; [next[index-1],next[index]]=[next[index],next[index-1]]; save.mutate(next);}}>Move up</button>
      <button className="button" disabled={save.isPending} onClick={() => save.mutate(selected.filter(item => item.questionId!==q.questionId))}>Remove</button></li>)}</ol>
    <BlueprintPicker id={id} done={()=>void query.refetch()}/>
    {!selected.length && <p>Select questions from your bank below.</p>}<h2>Question bank</h2>
    {bank.data?.filter(q => !selected.some(s => s.questionId===q.id)).map(q => <article className="account-card exam-record" key={q.id}><ExamMarkdown text={q.stem}/><button className="button" disabled={save.isPending} onClick={() => save.mutate([...selected,{questionId:q.id,marks:q.defaultMarks}])}>Add · {q.defaultMarks} marks</button></article>)}
  </DataPanel></>;
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
    case "monitor": return <>
      <p>Integrity indicators are not conclusive evidence of misconduct.</p>
      <details className="account-card"><summary>Send an announcement</summary>
        <ActionForm action={{ label: "Send announcement", path: path + "/announcements", fields: [
          { name: "message", label: "Message", type: "textarea", max: 500 }, { name: "priority", label: "Priority", options: ["NORMAL", "URGENT"] },
        ] }} done={() => setRevision((value) => value + 1)} />
      </details>
      {!!revision && <p role="status">Announcement sent.</p>}
      <ResourcePanel title="Live attempts" path={path + "/monitor/attempts"} refreshMs={5000} stream={path + "/monitor/stream"} empty="No attempts to monitor."
        columns={[...columns(["Candidate", "candidateName"], ["Answered", "answered"], ["Last seen", "lastSeenAt"], ["Connection", "connection"], ["Indicators", "incidentCount"]), {label:"Details",render:row=><MonitorDetails id={row.id}/>}]}
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
  const [editor, setEditor] = useState<{ mode: "create" | "edit" | "duplicate"; question?: Record<string, unknown> }>();
  const fields: Field[] = [
    { name: "stem", label: "Question text", type: "textarea" },
    { name: "difficulty", label: "Difficulty", options: difficulty },
    { name: "defaultMarks", label: "Marks", type: "number", min: .25, step: .25 },
    { name: "tags", label: "Tags (comma separated)", optional: true },
    { name: "explanation", label: "Explanation", type: "textarea", optional: true },
  ];
  const category = categories.data?.find((item) => item.id === categoryId);
  return <div className="question-bank">
    <header className="bank-intro"><div><p className="eyebrow">Your teaching library</p><h2>Great examinations start here.</h2><p>Organize your topics, build questions, and keep your next paper within reach.</p></div><button className="button button-primary" onClick={() => setEditor({ mode: "create" })}>+ New question</button></header>
    {editor && <section className="account-card question-editor-panel">
      <button className="button button-ghost" onClick={() => setEditor(undefined)}>Close editor</button>
      <QuestionEditor onSave={() => { setEditor(undefined); setRevision((value) => value + 1); }} />
    </section>}
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
          empty="No questions match this view. Adjust your filters or create a new question." filters={[searchFilter, { name: "difficulty", label: "Difficulty", options: difficulty }, { name: "type", label: "Type", options: questionTypes }]}
            actions={(row) => row.id ? [
            { label: "Edit question", method: "PATCH", path: path + "/" + segment(row.id), fields, initial: row },
            { label: "Duplicate question", path: path + "/" + segment(row.id) + "/duplicate" },
            { label: "Archive question", method: "DELETE", path: path + "/" + segment(row.id), confirm: row.id },
          ] : []} />
      </section>
    </div>
  </div>;
}

function QuestionEditor({ onSave }: { onSave: () => void }) {
  const [kind, setKind] = useState("MCQ_SINGLE");
  const [options, setOptions] = useState([{ id: newOperationKey(), text: "", isCorrect: false }, { id: newOperationKey(), text: "", isCorrect: false }]);
  const [stem, setStem] = useState("");
  const categories = useExamData<{id:string;name:string}[]>("/api/categories");
  const save = useMutation({
    mutationFn: (body: unknown) => examWrite("/api/questions", "POST", body),
    onSuccess: onSave,
  });
  const enough = kind === "WRITTEN" || options.every((o) => o.text.trim()) && options.some((o) => o.isCorrect);
  return <form className="exam-form" onSubmit={(event) => {
    event.preventDefault();
    if (!enough) return;
    const data = new FormData(event.currentTarget);
    save.mutate({ stem: stem.trim(), type: kind, categoryId: data.get("categoryId"), defaultMarks: Number(data.get("marks")), difficulty: data.get("difficulty"),
      tags: String(data.get("tags")).split(",").map((tag) => tag.trim()).filter(Boolean),
      ...(kind === "WRITTEN" ? { rubric: data.get("rubric") } : { options: options.map(({ text, isCorrect }) => ({ text: text.trim(), isCorrect })) }) });
  }}>
    <h2>New question</h2>
    <label>Question type<select value={kind} onChange={(event) => {
      setKind(event.target.value);
      setOptions((items) => items.map((item) => ({ ...item, isCorrect: false })));
    }}>{questionTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
    <label>Question text<textarea required value={stem} onChange={(event) => setStem(event.target.value)} /></label>
    {stem && <details><summary>Preview</summary><ExamMarkdown text={stem} /></details>}
    <label>Marks<input type="number" name="marks" min=".25" step=".25" required /></label>
    <label>Difficulty<select name="difficulty">{difficulty.map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>Category<select name="categoryId" required><option value="">Select category</option>{categories.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Tags<input name="tags" /></label>
    {kind === "WRITTEN" ? <label>Rubric<textarea name="rubric" required /></label> : <fieldset className="exam-form">
      <legend>Answer options</legend>
      {options.map((option, index) => <div key={option.id} className="exam-actions">
        <label>Option {index + 1}<input required value={option.text} onChange={(event) => setOptions((items) => items.map((item) => item.id === option.id ? { ...item, text: event.target.value } : item))} /></label>
        <label className="exam-inline"><input type={kind === "MCQ_SINGLE" ? "radio" : "checkbox"} name="correct" checked={option.isCorrect}
          onChange={(event) => setOptions((items) => items.map((item) => item.id === option.id ? { ...item, isCorrect: event.target.checked } : kind === "MCQ_SINGLE" ? { ...item, isCorrect: false } : item))} />Correct</label>
        <button type="button" className="button" disabled={options.length <= 2} onClick={() => setOptions((items) => items.filter((item) => item.id !== option.id))}>Remove</button>
      </div>)}
      <button type="button" className="button" disabled={options.length >= 6} onClick={() => setOptions((items) => [...items, { id: newOperationKey(), text: "", isCorrect: false }])}>Add option</button>
    </fieldset>}
    <ActionError error={save.error} /><button className="button button-primary" disabled={!enough || !stem.trim() || save.isPending}>Save question</button>
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
 const query=useExamData<{candidate?:{fullName:string};status:string;answered:number;remainingSeconds:number;events:{id:string;type:string;severity:string;occurredAt:string;reviewStatus:string}[]}>("/api/attempts/"+segment(id)+"/monitor",{enabled:open});
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>Attempt timeline</summary>{open && <DataPanel pending={query.isPending} error={query.error} retry={()=>void query.refetch()}><h3>{query.data?.candidate?.fullName}</h3><p>{query.data?.status} · {query.data?.answered} answered · {query.data?.remainingSeconds} seconds remaining</p>{query.data?.events.map(e=><article key={e.id}><p>{formatDate(e.occurredAt)} · {e.type} · {e.severity} · {e.reviewStatus}</p><ActionForm action={{label:"Review indicator",path:"/api/integrity-events/"+segment(e.id),method:"PATCH",fields:[{name:"status",label:"Review",options:["REVIEWED","DISMISSED","CONFIRMED"]},{name:"note",label:"Review note",min:3,max:1000}]}} done={()=>void query.refetch()}/></article>)}<ResourcePanel title="Interruptions" path={"/api/attempts/"+segment(id)+"/interruptions"} empty="No interruptions recorded." columns={columns(["Started","startedAt"],["Gap seconds","gapSeconds"],["Status","status"])} actions={row=>[{label:"Review interruption",path:"/api/attempts/"+segment(id)+"/interruptions/"+segment(row.id)+"/review",fields:[{name:"approve",label:"Approve interruption credit",type:"checkbox"},{name:"note",label:"Reason"}]}]}/></DataPanel>}</details>;
}

function BlueprintPicker({id,done}:{id:string;done:()=>void}) {
 const categories=useExamData<{id:string;name:string}[]>("/api/categories");
 const [categoryId,setCategory]=useState("");const [difficulty,setDifficulty]=useState("MEDIUM");const [count,setCount]=useState(1);const [marksEach,setMarks]=useState(1);
 const select=useMutation({mutationFn:()=>examWrite("/api/exams/"+segment(id)+"/questions/auto-select","POST",{slots:[{categoryId,difficulty,count,marksEach}],replace:false,syncTotalMarks:true}),onSuccess:done});
 return <details className="account-card"><summary>Select questions by blueprint</summary><form className="exam-form" onSubmit={e=>{e.preventDefault();select.mutate();}}><label>Category<select required value={categoryId} onChange={e=>setCategory(e.target.value)}><option value="">Select category</option>{categories.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Difficulty<select value={difficulty} onChange={e=>setDifficulty(e.target.value)}>{["EASY","MEDIUM","HARD"].map(d=><option key={d}>{d}</option>)}</select></label><label>Count<input required type="number" min={1} max={500} value={count} onChange={e=>setCount(Number(e.target.value))}/></label><label>Marks each<input required type="number" min={.25} step={.25} value={marksEach} onChange={e=>setMarks(Number(e.target.value))}/></label><button className="button" disabled={select.isPending}>Add blueprint questions</button><ActionError error={select.error}/></form></details>;
}
