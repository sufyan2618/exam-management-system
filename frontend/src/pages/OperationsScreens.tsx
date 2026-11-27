import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useAuthStore } from "../store/auth.store";
import { apiRequest } from "../api/client";
import { examWrite, formatDate, newOperationKey, segment } from "../api/examination";
import { ActionError, DataPanel, DataTable } from "../components/ExamData";
import { ActionForm, ResourcePanel } from "../components/ResourcePanel";
import type { Field, Row } from "../components/ResourcePanel";
import { useExamData } from "../hooks/useExamData";

const roles = ["CANDIDATE", "EXAMINER", "ADMIN"];
const columns = (...entries: [string, string][]) => entries.map(([label, key]) => ({ label, key }));

export function AdminOverview() {
  const query = useExamData<{ users?: number; exams?: number; activeAttempts?: number; queuedJobs?: number; database?: string; status?: string }>("/api/admin/stats", { refreshMs: 15_000 });
  const database = query.data?.database ?? "Unknown";
  const databaseState = database.toLowerCase() === "up" ? "healthy" : database.toLowerCase() === "down" ? "error" : "unknown";
  const metrics = [
    ["Users", query.data?.users],
    ["Examinations", query.data?.exams],
    ["Active attempts", query.data?.activeAttempts],
    ["Jobs waiting", query.data?.queuedJobs],
  ] as const;
  return <div className="admin-overview">
    <header className="admin-overview-heading">
      <div><p className="eyebrow">ADMINISTRATION</p><h2>Operations at a glance</h2><p>Service health and current activity across Verity.</p></div>
      <nav className="admin-overview-actions" aria-label="Administration shortcuts">
        <Link to="/admin/users"><span><strong>Manage users</strong><small>Accounts and roles</small></span><span aria-hidden="true">↗</span></Link>
        <Link to="/admin/audit"><span><strong>View audit log</strong><small>Recent system changes</small></span><span aria-hidden="true">↗</span></Link>
        <Link to="/admin/system"><span><strong>System health</strong><small>Queues and service details</small></span><span aria-hidden="true">↗</span></Link>
      </nav>
    </header>
    <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
      {query.data && <div className="admin-overview-data">
        <section className="admin-health-panel" aria-label="System health">
          <div className="admin-health-heading"><div><p className="eyebrow">LIVE STATUS</p><h3>System health</h3></div><span className="admin-refresh-note">Refreshes every 15 seconds</span></div>
          <div className="admin-health-checks">
            <div data-state="healthy"><span className="admin-health-dot" aria-hidden="true"/><span>API service</span><strong>Responding</strong></div>
            <div data-state={databaseState}><span className="admin-health-dot" aria-hidden="true"/><span>Database</span><strong>{database}</strong></div>
          </div>
        </section>
        <section className="admin-metrics" aria-label="Platform activity">
          {metrics.map(([label, value], index) => <article className="admin-metric" key={label}>
            <span className="admin-metric-index">0{index + 1}</span><p>{label}</p><strong>{value ?? "—"}</strong>
          </article>)}
        </section>
      </div>}
    </DataPanel>
  </div>;
}

const userFields: Field[] = [
  { name: "fullName", label: "Full name" },
  { name: "email", label: "Email", type: "email" }, { name: "role", label: "Role", options: roles },
];

export function AdminUsers({ id }: { id?: string }) {
  const path = "/api/users";
  const [revision, setRevision] = useState(0);
  const [show, setShow] = useState(false);
  const [temporary, setTemporary] = useState<string>();
  if (id) return <AdminUser id={id} />;
  return <>
    <button className="button button-primary" onClick={() => setShow(!show)}>{show ? "Close user form" : "Create user"}</button>
    {show && <section className="account-card exam-record"><h2>New user</h2>
      <ActionForm action={{ label: "Create user", path, fields: userFields }} done={(result) => {
        if (result && typeof result === "object" && "temporaryPassword" in result && typeof result.temporaryPassword === "string") setTemporary(result.temporaryPassword);
        setShow(false);
        setRevision((value) => value + 1);
      }} />
    </section>}
    {temporary && <section className="account-card exam-record">
      <h2>Temporary password</h2><p>Share this securely with the new user. It is shown once.</p><code>{temporary}</code>
      <button className="button" onClick={() => setTemporary(undefined)}>Dismiss</button>
    </section>}
    <ResourcePanel key={revision} title="Users" path={path} empty="No users match these filters."
      filters={[{ name: "q", label: "Name or email" }, { name: "role", label: "Role", options: roles }]}
      columns={[{ label: "User", render: (row: Row) => <Link to={"/admin/users/" + segment(row.id)}>{String(row.name ?? row.email ?? row.id)}</Link> },
        ...columns(["Email", "email"], ["Role", "role"], ["Active", "active"])]} />
  </>;
}

function AdminUser({ id }: { id: string }) {
  const path = "/api/users/" + segment(id);
  const query = useExamData<{ name: string; email: string; role: string; active: boolean; canManage?: boolean }>(path);
  const user = query.data;
  return <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
    {user && <section className="account-card exam-record"><h2>{user.name}</h2><p>{user.email}</p>
      <span className="exam-stamp">{user.active ? "Active" : "Inactive"}</span><p>{user.role}</p>
      {user && <>
        <ActionForm action={{ label: "Change role", path, method: "PATCH", initial: { role: user.role }, fields: [{ name: "role", label: "Role", options: roles }] }} done={() => void query.refetch()} />
        <ActionForm action={{ label: user.active ? "Deactivate user" : "Activate user", path: path + (user.active ? "/deactivate" : "/activate"), confirm: user.email }} done={() => void query.refetch()} />
      </>}
      <Link to="/admin/users">Return to users</Link>
    </section>}
  </DataPanel>;
}

export function AuditLog() {
  const verification = useExamData<{ valid: boolean; checked: number; brokenAtSeq?: number }>("/api/audit-logs/verify", { refreshMs: 60_000 });
  return <ResourcePanel title="Audit events" path="/api/audit-logs" empty="No audit events match these filters."
    toolbar={<div className="audit-integrity" data-state={verification.data?.valid === false ? "error" : verification.data?.valid ? "healthy" : "unknown"}>
      <span aria-hidden="true" className="admin-health-dot" />
      <span>{verification.data?.valid === false ? `Chain issue at record ${verification.data.brokenAtSeq ?? "unknown"}` : verification.data?.valid ? `Chain verified · ${verification.data.checked} records checked` : "Checking audit chain…"}</span>
      {verification.error && <button className="button" onClick={() => void verification.refetch()}>Retry check</button>}
    </div>}
    filters={[{ name: "actorId", label: "Actor ID" }, { name: "entityType", label: "Entity type" }, { name: "entityId", label: "Entity ID" }, { name: "action", label: "Action" }, { name: "from", label: "From", type: "datetime-local" }, { name: "to", label: "To", type: "datetime-local" }]}
    columns={[{ label: "Time", render: (row) => { const date = new Date(String(row.createdAt ?? "")); return Number.isNaN(date.getTime()) ? "—" : <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>; } },
      { label: "Actor", render: (row) => <span className="audit-actor"><strong>{String(row.actorName ?? row.actorRole ?? "System")}</strong><small>{row.actorRole ? String(row.actorRole) : row.actorId ? String(row.actorId) : "Automated event"}</small></span> },
      ...columns(["Action", "action"]),
      { label: "Entity", render: (row) => <span className="audit-actor"><strong>{String(row.entityType ?? "—")}</strong><small>{String(row.entityId ?? "No entity ID")}</small></span> },
      { label: "Record", render: (row) => <code>#{String(row.seq ?? "—")}</code> },
      { label: "Details", render: (row) => <details className="audit-details"><summary>Inspect record</summary>
        <div className="audit-change-grid">{(["before", "after", "meta"] as const).map((key) => <section key={key}><h3>{key === "meta" ? "Additional details" : key[0].toUpperCase() + key.slice(1)}</h3><pre>{row[key] == null ? "No details recorded" : JSON.stringify(row[key], null, 2)}</pre></section>)}</div>
        {Boolean(row.requestId) && <small>Request {String(row.requestId)}</small>}</details> }]} />;
}

export function AdminSystem() {
  const query = useExamData<{ apiVersion?: string; buildVersion?: string; status?: string }>("/api/admin/system", { refreshMs: 15_000 });
  return <>
    <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
      {query.data && <section className="account-card exam-record"><h2>Service information</h2>
        <p>{query.data.status}</p><p>API version: {query.data.apiVersion ?? "—"}</p><p>Build: {query.data.buildVersion ?? "—"}</p>
      </section>}
    </DataPanel>
    <ResourcePanel title="Job queues" path="/api/admin/system/queues" empty="No queues reported."
      columns={columns(["Queue", "name"], ["Waiting", "waiting"], ["Active", "active"], ["Failed", "failed"])} refreshMs={15_000} />
    <ResourcePanel title="Failed jobs" path="/api/admin/jobs/dead-letter" empty="No failed jobs."
      columns={columns(["Job", "name"], ["Queue", "queue"], ["Error", "failedReason"], ["Failed at", "failedAt"])}
      actions={(row) => row.id ? [{ label: "Retry job", path: "/api/admin/jobs/" + segment(row.id) + "/retry", confirm: row.id }] : []} />
  </>;
}

type ImportRun = { id: string; status: string; validCount?: number; invalidCount?: number; canCommit?: boolean; errors?: { row: number; column: string; message: string }[] };

export function ImportCenter() {
  const role = useAuthStore(state => state.user?.role);
  const [kind] = useState(role === "ADMIN" ? "candidates" : "questions");
  const [selected, setSelected] = useState<File>();
  const [job, setJob] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const [mode, setMode] = useState("atomic");
  const [key, setKey] = useState(newOperationKey);
  const path = "/api/imports";
  const query = useExamData<ImportRun>(path + "/" + segment(job ?? ""), { enabled: !!job, refreshMs: job ? 5000 : undefined });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.set("file", file);

      body.set("mode", "dry-run");
      body.set("atomic", mode === "atomic" ? "true" : "false");

      return examWrite<ImportRun>(path + "/" + kind, "POST", body, key);
    },
    onSuccess: (result) => {
      if (!result?.id) return;
      setJob(result.id);
      setAccepted(false);
      setKey(newOperationKey());
      setRevision((value) => value + 1);
    },
  });
  const commit = useMutation({
    mutationFn: () => examWrite(path + "/" + segment(job ?? "") + "/commit", "POST", undefined, "commit-" + job),
    onSuccess: () => { setAccepted(false); void query.refetch(); setRevision((value) => value + 1); },
  });
  const template = useMutation({
    mutationFn: () => apiRequest<Blob>(path + "/templates/" + segment(kind) + ".csv", { responseType: "blob" }),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = kind + "-template.csv";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
  });
  return <>
    <form className="account-card exam-record exam-form" onSubmit={(event) => {
      event.preventDefault();
      if (selected) upload.mutate(selected);
    }}>
      <h2>Validate an import file</h2>
      <label>Import type<input value={kind} readOnly /></label>
      <label>Invalid rows<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="atomic">Require every row to pass</option><option value="skip-invalid">Skip invalid rows</option></select></label>
      <label>CSV or JSON file<input type="file" accept=".csv,.json,text/csv,application/json" required onChange={(event) => setSelected(event.target.files?.[0])} /></label>
      <div className="exam-actions"><button className="button button-primary" disabled={!selected || upload.isPending}>Validate file</button>
        <button className="button" type="button" disabled={template.isPending} onClick={() => template.mutate()}>Download template</button></div>
      <ActionError error={upload.error ?? template.error} />
    </form>
    {job && <div className="exam-actions"><DownloadImport path={path+"/"+segment(job)+"/errors.csv"} label="Download validation errors"/>{role==="ADMIN" && <DownloadImport path={path+"/"+segment(job)+"/credentials.csv"} label="Download temporary credentials (once)"/>}</div>}
    {job && <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
      {query.data && <section className="account-card exam-record">
        <h2>Import preview</h2><span className="exam-stamp">{query.data.status}</span>
        <p>{query.data.validCount ?? "—"} valid · {query.data.invalidCount ?? "—"} invalid</p>
        {!!query.data.errors?.length && <DataTable label="Validation errors" columns={["Row", "Column", "Issue"]}
          rows={query.data.errors.map((error, index) => ({ key: index.toString(), cells: [error.row, error.column, error.message] }))} />}
        {query.data.canCommit && <>
          <label className="exam-inline"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />I reviewed the validation results.</label>
          <button className="button button-primary" disabled={!accepted || commit.isPending} onClick={() => commit.mutate()}>Commit import</button>
        </>}
        <ActionError error={commit.error} />
      </section>}
    </DataPanel>}
    <ResourcePanel key={revision} title="Import history" path={path} empty="No imports yet." columns={[
      { label: "Import", render: (row) => <button className="button" onClick={() => { setJob(row.id); setAccepted(false); }}>View {String(row.type ?? "import")}</button> },
      ...columns(["Status", "status"], ["Valid", "validCount"], ["Invalid", "invalidCount"]),
      { label: "Created", render: (row) => formatDate(typeof row.createdAt === "string" ? row.createdAt : undefined) },
    ]} />
  </>;
}

function DownloadImport({path,label}:{path:string;label:string}) {
 const download=useMutation({mutationFn:()=>apiRequest<Blob>(path,{responseType:"blob"}),onSuccess:blob=>{const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=path.split("/").pop() ?? "download.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}});
 return <><button className="button" disabled={download.isPending} onClick={()=>download.mutate()}>{label}</button><ActionError error={download.error}/></>;
}
