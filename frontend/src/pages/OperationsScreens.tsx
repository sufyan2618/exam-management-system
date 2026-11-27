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
  return <>
    <div className="exam-actions"><Link to="/admin/users">Manage users</Link><Link to="/admin/audit">View audit log</Link><Link to="/admin/system">Open system health</Link></div>
    <DataPanel pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
      {query.data && <section className="account-card exam-record">
        <h2>Platform status</h2>
        <dl className="exam-facts">{([["Service", query.data.status], ["Database", query.data.database], ["Users", query.data.users], ["Exams", query.data.exams], ["Active attempts", query.data.activeAttempts], ["Queued jobs", query.data.queuedJobs]] as const).map(([name, value]) =>
          <div key={name}><dt>{name}</dt><dd>{value ?? "—"}</dd></div>)}</dl>
      </section>}
    </DataPanel>
  </>;
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
  return <ResourcePanel title="Audit events" path="/api/audit-logs" empty="No audit events match these filters."
    filters={[{ name: "actorId", label: "Actor" }, { name: "entityType", label: "Entity" }, { name: "action", label: "Action" }, { name: "from", label: "From", type: "datetime-local" }]}
    columns={[...columns(["Time", "createdAt"], ["Actor", "actor"], ["Action", "action"], ["Entity", "entity"], ["Chain verified", "verified"]),
      { label: "Changes", render: (row) => <details><summary>Inspect changes</summary>
        <h3>Before</h3><pre>{JSON.stringify(row.before ?? null, null, 2)}</pre>
        <h3>After</h3><pre>{JSON.stringify(row.after ?? null, null, 2)}</pre></details> }]} />;
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
