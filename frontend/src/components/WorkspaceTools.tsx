import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { examWrite, segment } from "../api/examination";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import { useExamData } from "../hooks/useExamData";
import type { Workspace } from "../pages/workspace-routes";
import { ActionError } from "./ExamData";

type Notification = { id: string; title: string; message?: string; read: boolean };
type SearchResult = { id: string; title: string; url: string };

export function WorkspaceTools({ workspace }: { workspace: Workspace }) {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const notifications = useExamData<Notification[]>("/api/me/notifications", { refreshMs: 30_000 });
  const results = useExamData<SearchResult[]>("/api/search?q=" + segment(search), { enabled: search.length >= 2 && workspace.role !== "CANDIDATE" });
  const markRead = useMutation({
    mutationFn: (id: string) => examWrite("/api/me/notifications/" + segment(id) + "/read", "PATCH"),
    onSuccess: () => void notifications.refetch(),
  });
  useLiveUpdates("/api/me/notifications/stream", () => void notifications.refetch());
  const unread = notifications.data?.filter((item) => item.read === false).length;
  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!dialog.current?.open) dialog.current?.showModal();
      }
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, []);
  return <div className="exam-actions workspace-tools">
    <button className="button" onClick={() => dialog.current?.showModal()}>Search</button>
    <details className="workspace-notifications" onToggle={(event) => setNotificationsOpen(event.currentTarget.open)}>
      <summary>Notifications{unread ? " (" + unread + ")" : ""}</summary>
      {notificationsOpen && <section className="account-card exam-record" aria-label="Notifications">
        {notifications.isPending && <p role="status">Loading notifications…</p>}
        {notifications.isError && <p>Notifications could not be loaded. <button className="button" onClick={() => void notifications.refetch()}>Try again</button></p>}
        {notifications.data?.length === 0 && <p>No notifications.</p>}
        {notifications.data?.map((item) => <article key={item.id} className="exam-record">
          <h3>{item.title}</h3>{item.message && <p>{item.message}</p>}
          {!item.read && <button className="button" disabled={markRead.isPending} onClick={() => markRead.mutate(item.id)}>Mark as read</button>}
        </article>)}
        <ActionError error={markRead.error} />
      </section>}
    </details>
    <dialog ref={dialog} className="account-card search-dialog" aria-labelledby="workspace-search-heading">
      <div className="exam-record">
        <h2 id="workspace-search-heading">Search workspace</h2>
        <form className="exam-filters" onSubmit={(event) => { event.preventDefault(); setSearch(term.trim()); }}>
          <label>Search for a record<input type="search" minLength={2} value={term} onChange={(event) => setTerm(event.target.value)} /></label>
          <button className="button button-primary" disabled={term.trim().length < 2}>Search</button>
        </form>
        <nav className="exam-actions" aria-label="Quick links">
          {workspace.screens.filter((screen) => screen.nav).map((screen) => <Link to={screen.path} key={screen.path} onClick={() => dialog.current?.close()}>{screen.title}</Link>)}
        </nav>
        {search && <>
          {results.isFetching && <p role="status">Searching…</p>}
          <ActionError error={results.error} />
          {results.data?.length === 0 && <p>No matching records.</p>}
          <ul>{results.data?.filter((result) => /^\/(app|studio|admin)(\/|$)/.test(result.url) && !result.url.includes("\\")).map((result) =>
            <li key={result.id}><Link to={result.url} onClick={() => dialog.current?.close()}>{result.title}</Link></li>)}</ul>
        </>}
        <button className="button" onClick={() => dialog.current?.close()}>Close</button>
      </div>
    </dialog>
  </div>;
}
