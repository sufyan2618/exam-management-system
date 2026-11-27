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
const questionTypes = ["SINGLE", "MULTI", "WRITTEN"];
const searchFilter = { name: "q", label: "Search" };
const columns = (...entries: [string, string][]) => entries.map(([label, key]) => ({ label, key }));
const examLink = { label: "Examination", render: (row: Row) => <Link to={"/studio/exams/" + segment(row.id)}>{display(row.title)}</Link> };

export function StudioOverview({ list = false }: { list?: boolean }) {
  const query = useExamData<Exam[]>("/api/exams", { enabled: !list });
  if (list) return <ResourcePanel title="Examinations" path="/api/exams" columns={[examLink, ...columns(["Status", "state"], ["Duration", "durationMinutes"])]}
    filters={[searchFilter, { name: "state", label: "Status", options: states }]} empty="No exams match these filters."
    toolbar={<Link className="button button-primary" to="/studio/exams/new">Create exam</Link>} />;
  return <>
    <div className="exam-actions"><Link className="button button-primary" to="/studio/exams/new">Create exam</Link><Link to="/studio/questions">Open question bank</Link></div>
    <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
      {query.data && <div className="exam-card-grid">{states.slice(0, 4).map((state) => {
        const exams = query.data?.filter((exam) => exam.state === state) ?? [];
        return <section className="account-card exam-record" key={state}>
          <h2>{state.charAt(0) + state.slice(1).toLowerCase()}</h2>
          {exams.length ? <ul>{exams.map((exam) => <li key={exam.id}><Link to={"/studio/exams/" + segment(exam.id)}>{exam.title}</Link></li>)}</ul> : <p>No exams in this stage.</p>}
        </section>;
      })}</div>}
    </DataPanel>
  </>;
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
        { name: "showAnswers", label: "Show answers after publication", type: "checkbox" },
      ] }} done={() => setStep(2)} />}
      {exam && step === 2 && <><ExamQuestions id={exam.id} /><button className="button button-primary" onClick={() => setStep(3)}>Continue to candidates</button></>}
      {exam && step === 3 && <><ExamCandidates id={exam.id} /><button className="button button-primary" onClick={() => setStep(4)}>Review draft</button></>}
      {exam && step === 4 && <PublishChecklist id={exam.id} title={exam.title} onPublished={() => navigate("/studio/exams/" + id)} />}
      {exam && <Link to={"/studio/exams/" + id}>Close wizard and open draft</Link>}
    </section>
  </>;
}

function ExamQuestions({ id }: { id: string }) {
  const path = "/api/exams/" + segment(id) + "/questions";
  return <>
    <ResourcePanel title="Selected questions" path={path} columns={columns(["Question", "stem"], ["Type", "type"], ["Marks", "marks"])} empty="No questions selected." />
    <ResourcePanel title="Question bank" path="/api/questions" columns={columns(["Question", "stem"], ["Type", "type"], ["Marks", "marks"])}
      empty="No bank questions match the filters." filters={[searchFilter, { name: "difficulty", label: "Difficulty", options: difficulty }]}
      actions={(row) => row.canAttach === true ? [{ label: "Add to exam", path, fields: [{ name: "questionId", label: "Question ID" }, { name: "marks", label: "Marks", type: "number", min: .25, step: .25, optional: true }], initial: { questionId: row.id } }] : []} />
  </>;
}

function ExamCandidates({ id }: { id: string }) {
  const path = "/api/exams/" + segment(id) + "/candidates";
  const [revision, setRevision] = useState(0);
  return <>
    <details className="account-card"><summary>Enroll by email</summary>
      <ActionForm action={{ label: "Enroll candidates", path, fields: [{ name: "emails", label: "Email addresses (one per line)", type: "textarea" }] }} done={() => setRevision((value) => value + 1)} />
    </details>
    <ResourcePanel key={revision} title="Enrolled candidates" path={path} columns={columns(["Candidate", "name"], ["Enrollment", "status"], ["Attempt", "attemptStatus"], ["Extra minutes", "extraMinutes"])} empty="No candidates enrolled."
      toolbar={<Link to="/studio/imports">Import candidates</Link>}
      actions={(row) => row.canEdit === true ? [
        { label: "Set extra time", method: "PATCH", path: path + "/" + segment(row.id), fields: [{ name: "extraMinutes", label: "Extra minutes", type: "number", min: 0 }, { name: "reason", label: "Reason" }] },
        { label: "Remove enrollment", method: "DELETE", path: path + "/" + segment(row.id), confirm: String(row.name ?? row.id) },
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
        <ul>{query.data.checks.map((check) => <li key={check.id}>{check.passed ? "Passed" : "Needs attention"} · {check.label}</li>)}</ul>
        {query.data.canPublish && <ActionForm action={{ label: "Publish exam", path: path + "/publish", confirm: title }} done={onPublished} />}
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
      <ResourcePanel title="Live attempts" path={path + "/monitor"} refreshMs={5000} stream={path + "/monitor/stream"} empty="No attempts to monitor."
        columns={columns(["Candidate", "candidateName"], ["Answered", "answered"], ["Last seen", "lastSeenAt"], ["Connection", "connection"], ["Indicators", "incidentCount"])}
        actions={(row) => row.canManage === true ? [
          { label: "Extend time", path: "/api/attempts/" + segment(row.id) + "/extend", fields: [{ name: "minutes", label: "Extra minutes", type: "number", min: 1 }, { name: "reason", label: "Reason" }] },
          { label: "Force submit", path: "/api/attempts/" + segment(row.id) + "/force-submit", confirm: String(row.candidateName ?? row.id), fields: [{ name: "reason", label: "Reason" }] },
        ] : []} />
    </>;
    case "grading": return <>
      <label className="exam-inline"><input type="checkbox" checked={blind} onChange={(event) => setBlind(event.target.checked)} /> Blind grading</label>
      <ResourcePanel key={String(blind)} title="Grading queue" path={path + "/grading?blind=" + blind} empty="The grading queue is empty."
        columns={columns(...(blind ? [] : [["Candidate", "candidateName"]] as [string, string][]), ["Question", "question"], ["Answer", "answer"], ["Rubric", "rubric"], ["Status", "status"])}
        actions={(row) => row.canGrade === true ? [{ label: "Save grade", path: path + "/grading/" + segment(row.id), method: "PUT", fields: [{ name: "score", label: "Marks", type: "number", min: 0, max: typeof row.maxMarks === "number" ? row.maxMarks : undefined, step: .25 }, { name: "feedback", label: "Feedback", type: "textarea", optional: true }] }] : []} />
    </>;
    case "results": return <ResourcePanel title="Exam results" path={path + "/results" } empty="No results to display."
      columns={columns(["Candidate", "candidateName"], ["Score", "score"], ["Status", "status"])}
      actions={(row) => row.canPublish === true ? [{ label: "Publish result", path: path + "/results/" + segment(row.id) + "/publish", confirm: String(row.candidateName ?? row.id) }] : row.canUnpublish === true ? [{ label: "Unpublish result", path: path + "/results/" + segment(row.id) + "/unpublish", fields: [{ name: "reason", label: "Reason" }] }] : []} />;
    case "analytics": return <Analytics id={id} />;
    case "disputes": return <DisputeInbox path={path + "/disputes"} />;
    default: return <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
      {exam && <section className="account-card exam-record">
        <span className="exam-stamp">{exam.state}</span><h2>{exam.title}</h2>
        <p>{formatDate(exam.startsAt)} to {formatDate(exam.endsAt)}</p>{exam.instructions && <ExamMarkdown text={exam.instructions} />}
        {tab === "settings" && exam.canEdit && <ActionForm action={{ path, method: "PATCH", label: "Update exam", fields: basicFields.slice(0, 2), initial: exam }} done={() => void query.refetch()} />}
        {tab === "settings" && exam.canArchive && <ActionForm action={{ path: path + "/archive", label: "Archive exam", confirm: exam.title }} done={() => void query.refetch()} />}
        {tab !== "settings" && <ExamReports id={id} />}
        {tab !== "settings" && exam.state === "DRAFT" && <PublishChecklist id={id} title={exam.title} onPublished={() => void query.refetch()} />}
      </section>}
    </DataPanel>;
  }
}

function ExamReports({ id }: { id: string }) {
  const path = "/api/reports/exams/" + segment(id);
  const pdf = useDownload(path + "/pdf", "examination.pdf");
  const csv = useDownload(path + "/results.csv", "examination-results.csv");
  return <div className="exam-actions">
    <button className="button" disabled={pdf.isPending} onClick={() => pdf.mutate()}>Download exam PDF</button>
    <button className="button" disabled={csv.isPending} onClick={() => csv.mutate()}>Download results CSV</button>
    <ActionError error={pdf.error ?? csv.error} />
  </div>;
}

function Analytics({ id }: { id: string }) {
  const path = "/api/exams/" + segment(id) + "/analytics";
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
    <ResourcePanel title="Question analytics" path={path + "/questions"} empty="No question statistics are available."
      columns={columns(["Question", "stem"], ["Correctness", "correctRate"], ["Skip rate", "skipRate"], ["Discrimination", "discrimination"])} />
  </DataPanel>;
}

export function DisputeInbox({ path }: { path: string }) {
  return <ResourcePanel title="Dispute inbox" path={path} empty="No disputes in this inbox."
    filters={[{ name: "status", label: "Status", options: ["OPEN", "ESCALATED", "RESOLVED"] }]}
    columns={columns(["Exam", "examTitle"], ["Type", "type"], ["Reason", "reason"], ["Status", "status"], ["Due", "dueAt"])}
    actions={(row) => [
      ...(row.canResolve === true ? [{ label: "Resolve dispute", path: "/api/disputes/" + segment(row.id) + "/resolve", fields: [
        { name: "decision", label: "Decision", options: ["ACCEPT", "REJECT", "PARTIAL"] },
        { name: "score", label: "Revised score", type: "number" as const, min: 0, step: .25, optional: true },
        { name: "note", label: "Reviewer note", type: "textarea" as const },
      ] }] : []),
      ...(row.canEscalate === true ? [{ label: "Escalate", path: "/api/disputes/" + segment(row.id) + "/escalate", fields: [{ name: "note", label: "Reason", type: "textarea" as const }] }] : []),
    ]} />;
}

export function QuestionBank() {
  const path = "/api/questions";
  const [revision, setRevision] = useState(0);
  const [show, setShow] = useState(false);
  const fields: Field[] = [
    { name: "stem", label: "Question text", type: "textarea" },
    { name: "type", label: "Question type", options: questionTypes },
    { name: "difficulty", label: "Difficulty", options: difficulty },
    { name: "marks", label: "Marks", type: "number", min: .25, step: .25 },
    { name: "tags", label: "Tags (comma separated)", optional: true },
    { name: "explanation", label: "Explanation", type: "textarea", optional: true },
  ];
  return <>
    <button className="button button-primary" onClick={() => setShow(!show)}>{show ? "Close question editor" : "New question"}</button>
    {show && <section className="account-card exam-record"><QuestionEditor onSave={() => { setShow(false); setRevision((value) => value + 1); }} /></section>}
    <ResourcePanel key={revision} title="Question bank" path={path} columns={columns(["Question", "stem"], ["Type", "type"], ["Difficulty", "difficulty"], ["Marks", "marks"], ["Version", "version"])}
      empty="No questions match these filters." filters={[searchFilter, { name: "category", label: "Category" }, { name: "difficulty", label: "Difficulty", options: difficulty }, { name: "type", label: "Type", options: questionTypes }]}
      actions={(row) => row.canEdit === true ? [
        { label: "Edit question", method: "PATCH", path: path + "/" + segment(row.id), fields, initial: row },
        { label: "Duplicate question", path: path + "/" + segment(row.id) + "/duplicate" },
        { label: "Archive question", path: path + "/" + segment(row.id) + "/archive", confirm: row.id },
      ] : []} />
  </>;
}

function QuestionEditor({ onSave }: { onSave: () => void }) {
  const [kind, setKind] = useState("SINGLE");
  const [options, setOptions] = useState([{ id: newOperationKey(), text: "", isCorrect: false }, { id: newOperationKey(), text: "", isCorrect: false }]);
  const [stem, setStem] = useState("");
  const save = useMutation({
    mutationFn: (body: unknown) => examWrite("/api/questions", "POST", body),
    onSuccess: onSave,
  });
  const enough = kind === "WRITTEN" || options.every((o) => o.text.trim()) && options.some((o) => o.isCorrect);
  return <form className="exam-form" onSubmit={(event) => {
    event.preventDefault();
    if (!enough) return;
    const data = new FormData(event.currentTarget);
    save.mutate({ stem: stem.trim(), type: kind, marks: Number(data.get("marks")), difficulty: data.get("difficulty"),
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
    <label>Tags<input name="tags" /></label>
    {kind === "WRITTEN" ? <label>Rubric<textarea name="rubric" required /></label> : <fieldset className="exam-form">
      <legend>Answer options</legend>
      {options.map((option, index) => <div key={option.id} className="exam-actions">
        <label>Option {index + 1}<input required value={option.text} onChange={(event) => setOptions((items) => items.map((item) => item.id === option.id ? { ...item, text: event.target.value } : item))} /></label>
        <label className="exam-inline"><input type={kind === "SINGLE" ? "radio" : "checkbox"} name="correct" checked={option.isCorrect}
          onChange={(event) => setOptions((items) => items.map((item) => item.id === option.id ? { ...item, isCorrect: event.target.checked } : kind === "SINGLE" ? { ...item, isCorrect: false } : item))} />Correct</label>
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
    mutationFn: () => examWrite<{ attemptId: string }>("/api/exams/" + segment(id) + "/sandbox", "POST", {}, key),
    onSuccess: (data) => { if (data?.attemptId) setAttemptId(data.attemptId); setKey(newOperationKey()); },
  });
  const exit = "/studio/exams/" + segment(id);
  if (attemptId) return <AttemptScreen id={attemptId} sandbox exit={exit} />;
  return <section className="account-card exam-record"><p>This preview uses a sandbox attempt. It does not affect real results.</p>
    <button className="button button-primary" disabled={launch.isPending} onClick={() => launch.mutate()}>Start candidate preview</button>
    <ActionError error={launch.error} /><Link to={exit}>Return to exam</Link>
  </section>;
}
