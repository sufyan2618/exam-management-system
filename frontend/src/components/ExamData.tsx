import type { ReactNode } from "react";
import { ApiError, getErrorMessage } from "../utils/api-error";

export function DataPanel({ pending, error, retry, empty, children }: {
  pending: boolean;
  error: unknown;
  retry: () => void;
  empty?: string;
  children?: ReactNode;
}) {
  if (pending) return <section className="account-card" role="status">Loading records…</section>;
  if (error) {
    const status = error instanceof ApiError ? error.status : undefined;
    const message = status === 404 ? "This record or service is unavailable." :
      status === 403 ? "You do not have access to this information." : getErrorMessage(error);
    return <section className="account-card screen-notice">
      <h2>Could not load this view</h2>
      <p role="alert">{message}</p>
      {error instanceof ApiError && error.requestId && <small>Request ID: <code>{error.requestId}</code></small>}
      <button className="button button-primary" onClick={retry}>Try again</button>
    </section>;
  }
  if (empty) return <section className="account-card"><p>{empty}</p></section>;
  return <>{children}</>;
}

export function DataTable({ label, columns, rows }: {
  label: string;
  columns: string[];
  rows: { key: string; cells: ReactNode[] }[];
}) {
  return <div className="exam-table-wrap" tabIndex={0} role="region" aria-label={label}>
    <table className="exam-table">
      <caption className="exam-visually-hidden">{label}</caption>
      <thead><tr>{columns.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{rows.map(({ key, cells }) => <tr key={key}>
        {cells.map((cell, index) => <td key={columns[index]}>{cell}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

export function ActionError({ error }: { error: unknown }) {
  return error != null ? <p role="alert" className="exam-action-error">{getErrorMessage(error)}</p> : null;
}
