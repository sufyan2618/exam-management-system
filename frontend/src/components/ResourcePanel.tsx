import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { display, examWrite, newOperationKey } from "../api/examination";
import { getApiValidationIssues } from "../utils/api-error";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import { useExamData } from "../hooks/useExamData";
import { ActionError, DataPanel, DataTable } from "./ExamData";

export type Field = { name: string; label: string; type?: "email" | "number" | "datetime-local" | "textarea" | "checkbox"; options?: string[]; min?: number; max?: number; step?: number; optional?: boolean };
export type Row = { id: string; [key: string]: unknown };
type Column = { label: string; key?: string; render?: (row: Row) => ReactNode };
export type Action = { label: string; path: string; method?: "POST" | "PUT" | "PATCH" | "DELETE"; fields?: Field[]; confirm?: string; initial?: Record<string, unknown>; validate?: (body: Record<string, unknown>) => Record<string, string> };

export function ActionForm({ action, done }: { action: Action; done: (result: unknown) => void }) {
  const [confirmation, setConfirmation] = useState("");
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [operation, setOperation] = useState(newOperationKey);
  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => examWrite(action.path, action.method ?? "POST", data, operation, typeof action.initial?.version === "number" ? action.initial.version : undefined),
    onSuccess: (result) => { setOperation(newOperationKey()); done(result); },
  });
  const clearFieldError = (name: string) => {
    mutation.reset();
    setClientErrors((current) => ({ ...current, [name]: "" }));
  };
  return <form className="exam-form" noValidate onSubmit={(event) => {
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
        field.type === "datetime-local" ? (Number.isNaN(new Date(value).getTime()) ? value : new Date(value).toISOString()) : value.trim();
    }
    const errors = { ...validateActionFields(action.fields ?? [], new FormData(event.currentTarget)), ...(action.validate?.(body) ?? {}) };
    setClientErrors(errors);
    if (Object.keys(errors).length) {
      const first = action.fields?.find((field) => errors[field.name]);
      if (first) (event.currentTarget.elements.namedItem(first.name) as HTMLElement | null)?.focus();
      return;
    }
    mutation.mutate(body);
  }}>
    {Object.keys(clientErrors).length > 0 && <div className="exam-validation-summary" role="alert" aria-live="assertive"><strong>Check these fields before continuing:</strong><ul>{Object.entries(clientErrors).map(([field, message]) => <li key={field}><a href={`#${action.path.replaceAll("/", "-")}-${field}`}>{action.fields?.find((item) => item.name === field)?.label ?? field}: {message}</a></li>)}</ul></div>}
    {action.fields?.map((field) => {
      const value = action.initial?.[field.name];
      const initial = Array.isArray(value) ? value.join(", ") : typeof value === "string" || typeof value === "number" ? value : "";
      const apiError = getApiValidationIssues(mutation.error).find((item) => item.field === field.name)?.message;
      const message = clientErrors[field.name] ?? apiError;
      const id = `${action.path.replaceAll("/", "-")}-${field.name}`;
      return <label key={field.name} htmlFor={id}>{field.label}
        {field.options ? <select id={id} name={field.name} aria-invalid={!!message} aria-describedby={message ? `${id}-error` : undefined} required={!field.optional} defaultValue={initial} onChange={() => clearFieldError(field.name)}><option value="">Choose an option</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select> :
          field.type === "textarea" ? <textarea id={id} name={field.name} aria-invalid={!!message} aria-describedby={message ? `${id}-error` : undefined} required={!field.optional} minLength={field.min} maxLength={field.max} defaultValue={initial} onChange={() => clearFieldError(field.name)} /> :
            <input id={id} name={field.name} type={field.type ?? "text"} aria-invalid={!!message} aria-describedby={message ? `${id}-error` : undefined} required={!field.optional && field.type !== "checkbox"} defaultChecked={value === true}
              defaultValue={field.type === "checkbox" ? undefined : initial} min={field.type === "number" ? field.min : undefined} max={field.type === "number" ? field.max : undefined}
              minLength={field.type !== "number" ? field.min : undefined} maxLength={field.type !== "number" ? field.max : undefined} step={field.step} onChange={() => clearFieldError(field.name)} />}
        {message && <span className="exam-field-error" id={`${id}-error`}>{message}</span>}
      </label>;
    })}
    {action.confirm && <label>Type “{action.confirm}” to confirm<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>}
    <ActionError error={mutation.error} fields={action.fields?.map(({ name, label }) => ({ name, label }))} />
    <button className="button button-primary" disabled={mutation.isPending || !!action.confirm && action.confirm !== confirmation}>{mutation.isPending ? "Saving…" : action.label}</button>
  </form>;
}

function validateActionFields(fields: Field[], data: FormData) {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = String(data.get(field.name) ?? "").trim();
    if (!value && !field.optional && field.type !== "checkbox") {
      errors[field.name] = "This field is required.";
      continue;
    }
    if (!value) continue;
    if (field.type === "number") {
      const number = Number(value);
      if (!Number.isFinite(number)) errors[field.name] = "Enter a valid number.";
      else if (field.min !== undefined && number < field.min) errors[field.name] = `Enter a value of at least ${field.min}.`;
      else if (field.max !== undefined && number > field.max) errors[field.name] = `Enter a value no greater than ${field.max}.`;
      else {
        const step = field.step ?? 1;
        if (Math.abs((number - (field.min ?? 0)) / step - Math.round((number - (field.min ?? 0)) / step)) > 1e-8) errors[field.name] = `Use increments of ${step}.`;
      }
    } else if (field.type === "datetime-local" && Number.isNaN(new Date(value).getTime())) {
      errors[field.name] = "Enter a valid date and time.";
    } else if (field.min !== undefined && value.length < field.min) {
      errors[field.name] = `Enter at least ${field.min} characters.`;
    } else if (field.max !== undefined && field.type !== "number" && value.length > field.max) {
      errors[field.name] = `Use no more than ${field.max} characters.`;
    } else if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[field.name] = "Enter a valid email address.";
    }
  }
  return errors;
}

export function ResourcePanel({ title, path, columns, empty, filters, actions, refreshMs, stream, toolbar, modalActions = false }: {
  title: string; path: string; columns: Column[]; empty: string; filters?: Field[];
  actions?: (row: Row) => Action[]; refreshMs?: number; stream?: string; toolbar?: ReactNode; modalActions?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [page,setPage] = useState(1);
  const [active, setActive] = useState<{ key: string; action: Action }>();
  const [notice, setNotice] = useState("");
  const query = useExamData<Row[] | { items: Row[] }>(path + (path.includes("?") ? "&" : "?") + "page=" + page + "&pageSize=20" + (search ? "&" + search : ""), { refreshMs });
  useLiveUpdates(stream, () => void query.refetch());
  const rows = Array.isArray(query.data) ? query.data : query.data?.items;
  return <section className={`exam-record resource-panel${title === "Examinations" ? " resource-panel-exams" : ""}`}>
    {title === "Examinations" && <header className="resource-heading"><div><p className="eyebrow">EXAMINER WORKSPACE</p><h2>Examinations</h2><p>Review exam status or create a new examination.</p></div>{toolbar && <div className="exam-actions">{toolbar}</div>}</header>}
    {title !== "Examinations" && toolbar && <div className="exam-actions">{toolbar}</div>}
    {!!filters?.length && <form className="account-card exam-filters resource-filters" onSubmit={(event) => {
      event.preventDefault();
      const params = new URLSearchParams();
      new FormData(event.currentTarget).forEach((value, name) => { if (typeof value === "string" && value.trim()) params.set(name, value.trim()); });
      setPage(1); setSearch(params.toString());
    }}>
      {filters.map((field) => <label key={field.name}>{field.label}{field.options ?
        <select name={field.name}><option value="">All</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select> :
        <input type={field.type ?? "search"} name={field.name} />}</label>)}
      <div className="resource-filter-actions"><button className="button button-primary">Apply filters</button>
      <button className="button" type="reset" onClick={() => setSearch("")}>Clear</button></div>
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
    {active && (modalActions ? <ResourceActionDialog key={active.key} action={active.action} onClose={() => setActive(undefined)} done={() => { setActive(undefined); setNotice("Changes saved."); void query.refetch(); }} /> : <section className="account-card exam-record">
      <h2>{active.action.label}</h2>
      <ActionForm key={active.key} action={active.action} done={() => { setActive(undefined); setNotice("Changes saved."); void query.refetch(); }} />
      <button className="button" onClick={() => setActive(undefined)}>Cancel</button>
    </section>)}
  </section>;
}

function ResourceActionDialog({ action, onClose, done }: { action: Action; onClose: () => void; done: (result: unknown) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const current = dialog.current;
    if (current && !current.open) current.showModal();
  }, []);
  const description = action.method === "DELETE" ? "Remove this question from your active bank. If an existing exam uses it, it will be archived so that exam keeps its saved copy." :
    action.label.toLowerCase().includes("duplicate") ? "Create a separate copy of this question. The original remains unchanged." :
      "Update the question details, then save your changes.";
  return <dialog ref={dialog} className="resource-action-dialog" aria-labelledby="resource-action-title" onClose={onClose}>
    <header><div><p className="eyebrow">QUESTION BANK</p><h2 id="resource-action-title">{action.label}</h2><p>{description}</p></div><button type="button" className="button button-ghost" onClick={() => dialog.current?.close()}>Close</button></header>
    <ActionForm action={action} done={done} />
    <button type="button" className="button" onClick={() => dialog.current?.close()}>Cancel</button>
  </dialog>;
}
