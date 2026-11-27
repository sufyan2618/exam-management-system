import { useState } from "react";
import type { ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { display, examWrite, newOperationKey } from "../api/examination";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import { useExamData } from "../hooks/useExamData";
import { ActionError, DataPanel, DataTable } from "./ExamData";

export type Field = { name: string; label: string; type?: "email" | "number" | "datetime-local" | "textarea" | "checkbox"; options?: string[]; min?: number; max?: number; step?: number; optional?: boolean };
export type Row = { id: string; [key: string]: unknown };
type Column = { label: string; key?: string; render?: (row: Row) => ReactNode };
export type Action = { label: string; path: string; method?: "POST" | "PUT" | "PATCH" | "DELETE"; fields?: Field[]; confirm?: string; initial?: Record<string, unknown> };

export function ActionForm({ action, done }: { action: Action; done: (result: unknown) => void }) {
  const [confirmation, setConfirmation] = useState("");
  const [operation, setOperation] = useState(newOperationKey);
  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => examWrite(action.path, action.method ?? "POST", data, operation, typeof action.initial?.version === "number" ? action.initial.version : undefined),
    onSuccess: (result) => { setOperation(newOperationKey()); done(result); },
  });
  return <form className="exam-form" onSubmit={(event) => {
    event.preventDefault();
    if (mutation.isPending || action.confirm && action.confirm !== confirmation) return;
    const data = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    for (const field of action.fields ?? []) {
      const value = String(data.get(field.name) ?? "");
      if (field.type === "checkbox") body[field.name] = data.has(field.name);
      else if (field.name === "emails") body[field.name] = value.split(/[\s,;]+/).filter(Boolean);
      else if (field.name === "tags") body[field.name] = value.split(",").map((tag) => tag.trim()).filter(Boolean);
      else if (value !== "") body[field.name] = field.type === "number" ? Number(value) :
        field.type === "datetime-local" ? new Date(value).toISOString() : value.trim();
    }
    mutation.mutate(body);
  }}>
    {action.fields?.map((field) => {
      const value = action.initial?.[field.name];
      const initial = Array.isArray(value) ? value.join(", ") : typeof value === "string" || typeof value === "number" ? value : "";
      return <label key={field.name}>{field.label}
        {field.options ? <select name={field.name} required={!field.optional} defaultValue={initial}><option value="">Choose an option</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select> :
          field.type === "textarea" ? <textarea name={field.name} required={!field.optional} minLength={field.min} maxLength={field.max} defaultValue={initial} /> :
            <input name={field.name} type={field.type ?? "text"} required={!field.optional && field.type !== "checkbox"} defaultChecked={value === true}
              defaultValue={field.type === "checkbox" ? undefined : initial} min={field.type === "number" ? field.min : undefined} max={field.type === "number" ? field.max : undefined}
              minLength={field.type !== "number" ? field.min : undefined} maxLength={field.type !== "number" ? field.max : undefined} step={field.step} />}
      </label>;
    })}
    {action.confirm && <label>Type “{action.confirm}” to confirm<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>}
    <ActionError error={mutation.error} />
    <button className="button button-primary" disabled={mutation.isPending || !!action.confirm && action.confirm !== confirmation}>{mutation.isPending ? "Saving…" : action.label}</button>
  </form>;
}

export function ResourcePanel({ title, path, columns, empty, filters, actions, refreshMs, stream, toolbar }: {
  title: string; path: string; columns: Column[]; empty: string; filters?: Field[];
  actions?: (row: Row) => Action[]; refreshMs?: number; stream?: string; toolbar?: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [page,setPage] = useState(1);
  const [active, setActive] = useState<{ key: string; action: Action }>();
  const [notice, setNotice] = useState("");
  const query = useExamData<Row[] | { items: Row[] }>(path + (path.includes("?") ? "&" : "?") + "page=" + page + "&pageSize=20" + (search ? "&" + search : ""), { refreshMs });
  useLiveUpdates(stream, () => void query.refetch());
  const rows = Array.isArray(query.data) ? query.data : query.data?.items;
  return <section className="exam-record">
    {toolbar && <div className="exam-actions">{toolbar}</div>}
    {!!filters?.length && <form className="account-card exam-filters" onSubmit={(event) => {
      event.preventDefault();
      const params = new URLSearchParams();
      new FormData(event.currentTarget).forEach((value, name) => { if (typeof value === "string" && value.trim()) params.set(name, value.trim()); });
      setPage(1); setSearch(params.toString());
    }}>
      {filters.map((field) => <label key={field.name}>{field.label}{field.options ?
        <select name={field.name}><option value="">All</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select> :
        <input type={field.type ?? "search"} name={field.name} />}</label>)}
      <button className="button">Apply filters</button>
      <button className="button" type="reset" onClick={() => setSearch("")}>Clear</button>
    </form>}
    {notice && <p role="status">{notice}</p>}
    <DataPanel pending={query.isPending && !query.isPaused} error={query.error} retry={() => void query.refetch()}
      empty={query.isPaused && !rows ? "Reconnect to load records." : rows?.length === 0 ? empty : undefined}>
      {!!rows?.length && <DataTable label={title} columns={[...columns.map((column) => column.label), ...(actions ? ["Actions"] : [])]}
        rows={rows.map((row) => ({
          key: row.id,
          cells: [...columns.map((column) => column.render ? column.render(row) : display(row[column.key ?? ""])),
            ...(actions ? [<div className="exam-actions">{actions(row).map((action) =>
              <button className="button" key={action.label} onClick={() => { setNotice(""); setActive({ key: row.id + action.label, action }); }}>{action.label}</button>)}</div>] : [])],
        }))} />}
    </DataPanel>
    <nav className="exam-actions" aria-label="Record pages"><button className="button" disabled={page===1} onClick={() => setPage(p=>p-1)}>Previous</button><span>Page {page}</span><button className="button" disabled={!rows || rows.length<20} onClick={() => setPage(p=>p+1)}>Next</button></nav>
    {active && <section className="account-card exam-record">
      <h2>{active.action.label}</h2>
      <ActionForm key={active.key} action={active.action} done={() => { setActive(undefined); setNotice("Changes saved."); void query.refetch(); }} />
      <button className="button" onClick={() => setActive(undefined)}>Cancel</button>
    </section>}
  </section>;
}
