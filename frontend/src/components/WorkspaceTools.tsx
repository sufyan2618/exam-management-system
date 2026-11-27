import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { examWrite, segment } from "../api/examination";
import { useAuthStore } from "../store/auth.store";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import type { Workspace } from "../pages/workspace-routes";
import { ActionError } from "./ExamData";

type NotificationRecord = {
  _id: string;
  type: string;
  payload?: Record<string, unknown>;
  readAt?: string | null;
  createdAt: string;
};
type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  href: string;
};
type SearchResult = { id: string; title: string; url: string };
type NotificationsResponse = { data: NotificationRecord[]; meta: { unread?: number } };

const labels: Record<string, [string, string]> = {
  enrolled: ["Exam enrollment confirmed", "You have been added to this examination."],
  result_published: ["Results are ready", "Your examination result has been published."],
  result_updated: ["Result updated", "A grade change has updated your result."],
  grading_complete: ["Grading complete", "The grading process has been completed."],
  time_credited: ["Extra time added", "Additional time has been credited to your attempt."],
  dispute_opened: ["New dispute submitted", "A candidate has opened a dispute for review."],
  dispute_comment: ["New dispute message", "There is an update in a dispute you are following."],
  dispute_update: ["Dispute status updated", "The status of your dispute has changed."],
  dispute_resolved: ["Dispute resolved", "Your dispute has been resolved."],
  dispute_overdue: ["Overdue dispute escalated", "An overdue dispute needs administrator attention."],
};

function notificationHref(type: string, payload: Record<string, unknown>, role: Workspace["role"]) {
  const attemptId = typeof payload.attemptId === "string" ? payload.attemptId : "";
  const disputeId = typeof payload.disputeId === "string" ? payload.disputeId : "";
  if ((type === "result_published" || type === "result_updated" || type === "grading_complete") && attemptId && role === "CANDIDATE") {
    return "/app/results/" + segment(attemptId);
  }
  if (type === "time_credited" && attemptId && role === "CANDIDATE") return "/app/attempt/" + segment(attemptId);
  if (type.startsWith("dispute_") && role === "CANDIDATE") return disputeId ? "/app/disputes/" + segment(disputeId) : "/app/disputes";
  if (type.startsWith("dispute_") && role === "ADMIN") return "/admin/disputes";
  if (type.startsWith("dispute_") && role === "EXAMINER") return "/studio/disputes";
  if (type === "enrolled") return "/app/exams";
  return role === "ADMIN" ? "/admin" : role === "EXAMINER" ? "/studio" : "/app";
}

function toNotification(record: NotificationRecord, role: Workspace["role"]): NotificationItem {
  const payload = record.payload ?? {};
  const [fallbackTitle, fallbackMessage] = labels[record.type] ?? [
    record.type.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" "),
    "There is a new update in your examination workspace.",
  ];
  const examTitle = typeof payload.examTitle === "string" ? payload.examTitle : typeof payload.title === "string" ? payload.title : "";
  let message = typeof payload.message === "string" ? payload.message : fallbackMessage;
  if (examTitle && ["enrolled", "result_published", "result_updated", "grading_complete"].includes(record.type)) {
    message = `${fallbackMessage} · ${examTitle}`;
  } else if (record.type === "time_credited" && typeof payload.seconds === "number") {
    const minutes = Math.ceil(payload.seconds / 60);
    message = `${minutes} additional minute${minutes === 1 ? "" : "s"} added${examTitle ? ` to ${examTitle}` : " to your attempt"}.`;
  }
  return {
    id: record._id,
    type: record.type,
    title: examTitle && record.type === "enrolled" ? `You’re enrolled in ${examTitle}` : fallbackTitle,
    message,
    createdAt: record.createdAt,
    read: Boolean(record.readAt),
    href: notificationHref(record.type, payload, role),
  };
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2"/></svg>;
}

function BellIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>;
}

function notificationDate(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export function WorkspaceTools({ workspace }: { workspace: Workspace }) {
  const userId = useAuthStore((state) => state.user?.id);
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const notificationsMenu = useRef<HTMLDetailsElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const notifications = useQuery({
    queryKey: ["notifications", userId],
    queryFn: async ({ signal }) => {
      const response = await apiRequest<NotificationsResponse>("/api/me/notifications?pageSize=100", { signal });
      return {
        items: response.data.map((record) => toNotification(record, workspace.role)),
        unread: response.meta?.unread ?? response.data.filter((record) => !record.readAt).length,
      };
    },
    enabled: !!userId,
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 2,
  });
  const results = useQuery({
    queryKey: ["workspace-search", userId, workspace.role, search],
    queryFn: ({ signal }) => apiRequest<{ data: SearchResult[] }>("/api/search?q=" + segment(search), { signal }).then((response) => response.data),
    enabled: search.length >= 2 && workspace.role !== "CANDIDATE",
    staleTime: 15_000,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => examWrite("/api/me/notifications/" + segment(id) + "/read", "PATCH"),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications", userId] }),
  });
  const markAllRead = useMutation({
    mutationFn: () => examWrite("/api/me/notifications/read-all", "PATCH"),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications", userId] }),
  });
  useLiveUpdates(userId ? "/api/me/notifications/stream" : undefined, () => void notifications.refetch());
  const unread = notifications.data?.unread ?? 0;
  const localLinks = useMemo(() => workspace.screens
    .filter((screen) => screen.nav && (!search || screen.title.toLowerCase().includes(search.toLowerCase())))
    .map((screen) => ({ id: screen.path, title: screen.title, url: screen.path })), [workspace.screens, search]);

  const openSearch = () => {
    if (!dialog.current?.open) dialog.current?.showModal();
    window.requestAnimationFrame(() => searchInput.current?.focus());
  };

  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, []);

  return <div className="exam-actions workspace-tools" aria-label="Workspace tools">
    <button className="workspace-tool-button" type="button" onClick={openSearch} aria-label="Search workspace" title="Search workspace (Ctrl K)">
      <SearchIcon /><span className="workspace-tool-tooltip">Search</span>
    </button>
    <details ref={notificationsMenu} className="workspace-notifications" onToggle={(event) => setNotificationsOpen(event.currentTarget.open)}>
      <summary aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title="Notifications">
        <BellIcon />
        <span className="workspace-tool-tooltip">Notifications</span>
        {unread > 0 && <span className="notification-count" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
      </summary>
      {notificationsOpen && <section className="notification-popover" aria-label="Notifications">
        <header className="notification-heading">
          <div><h2>Notifications</h2><p>{unread ? `${unread} unread` : "You’re all caught up"}</p></div>
          {unread > 0 && <button className="notification-mark-all" type="button" disabled={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
            {markAllRead.isPending ? "Marking…" : "Mark all read"}
          </button>}
        </header>
        {notifications.isPending && <p className="notification-state" role="status">Loading notifications…</p>}
        {notifications.isError && <div className="notification-state" role="alert"><p>Notifications couldn’t be loaded.</p><button className="button" onClick={() => void notifications.refetch()}>Try again</button></div>}
        {notifications.data?.items.length === 0 && <p className="notification-state">No notifications yet.</p>}
        <ul className="notification-list">
          {notifications.data?.items.map((item) => <li key={item.id} className={item.read ? "notification-item is-read" : "notification-item is-unread"}>
            <Link to={item.href} onClick={() => { notificationsMenu.current && (notificationsMenu.current.open = false); setNotificationsOpen(false); if (!item.read) markRead.mutate(item.id); }}>
              <span className="notification-item-title">{item.title}</span>
              <span className="notification-item-message">{item.message}</span>
              <time dateTime={item.createdAt}>{notificationDate(item.createdAt)}</time>
            </Link>
            {!item.read && <button className="notification-mark-one" type="button" aria-label={`Mark ${item.title} as read`} disabled={markRead.isPending} onClick={() => markRead.mutate(item.id)}>Mark read</button>}
          </li>)}
        </ul>
        <ActionError error={markRead.error ?? markAllRead.error} />
      </section>}
    </details>
    <dialog ref={dialog} className="account-card search-dialog" aria-labelledby="workspace-search-heading" onClose={() => setSearch("")}>
      <div className="search-dialog-content">
        <header className="search-dialog-heading"><div><p className="eyebrow">VERITY WORKSPACE</p><h2 id="workspace-search-heading">Search</h2></div><kbd>ESC</kbd></header>
        <form className="workspace-search-form" onSubmit={(event) => { event.preventDefault(); setSearch(term.trim()); }}>
          <label className="workspace-search-field"><SearchIcon /><input ref={searchInput} type="search" minLength={2} placeholder="Search examinations, people…" value={term} onChange={(event) => { setTerm(event.target.value); if (!event.target.value.trim()) setSearch(""); }} /></label>
          <button className="button button-primary" disabled={term.trim().length < 2}>Search</button>
        </form>
        {!search && <section className="search-quick-links"><h3>Quick links</h3>{localLinks.map((result) => <Link to={result.url} key={result.id} onClick={() => dialog.current?.close()}>{result.title}<span aria-hidden="true">↗</span></Link>)}</section>}
        {search && <section className="search-results" aria-live="polite">
          <h3>Results</h3>
          {workspace.role === "CANDIDATE" && localLinks.length === 0 && <p>No matching sections.</p>}
          {workspace.role !== "CANDIDATE" && results.isFetching && <p role="status">Searching…</p>}
          {workspace.role !== "CANDIDATE" && results.isError && <p role="alert">Search is temporarily unavailable. Try again.</p>}
          {workspace.role !== "CANDIDATE" && results.data?.length === 0 && <p>No matching records.</p>}
          <ul>{localLinks.map((result) => <li key={result.id}><Link to={result.url} onClick={() => dialog.current?.close()}>{result.title}<span>Workspace section</span></Link></li>)}
            {results.data?.filter((result) => /^\/(app|studio|admin)(\/|$)/.test(result.url) && !result.url.includes("\\")).map((result) => <li key={result.id}><Link to={result.url} onClick={() => dialog.current?.close()}>{result.title}<span>Record</span></Link></li>)}</ul>
        </section>}
        <button className="search-dialog-close" type="button" onClick={() => dialog.current?.close()}>Close search</button>
      </div>
    </dialog>
  </div>;
}
