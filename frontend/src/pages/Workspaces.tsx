import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, NavLink, useLocation, useParams } from "react-router-dom";
import { Logo } from "../components/Brand";
import { ExamPreferences } from "../components/ExamPreferences";
import { RouteErrorBoundary } from "../components/RouteErrorBoundary";
import { WorkspaceTools } from "../components/WorkspaceTools";

import { useAuthStore } from "../store/auth.store";
import { examTabs, roleHome } from "./workspace-routes";
import type { Screen, Workspace } from "./workspace-routes";
import { applyTextSize, applyTheme, saveSetting } from "../store/display-preferences";

const WorkspaceScreen = lazy(() => import("./WorkspaceScreen").then((module) => ({ default: module.WorkspaceScreen })));

export function ScreenNotice({ title, message, back = "/", backLabel = "Return to start", children }: {
  title: string; message: string; back?: string; backLabel?: string; children?: ReactNode;
}) {
  return (
    <main className="account-page" id="main-content">
      <section className="account-card screen-notice">
        <h1>{title}</h1>
        <p>{message}</p>
        {children}
        <Link to={back}>{backLabel}</Link>
      </section>
    </main>
  );
}

function PreferencesForm({ sync = false }: { sync?: boolean }) {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? "system");
  const [textSize, setTextSize] = useState(document.documentElement.dataset.textSize ?? "standard");
  return (
    <section className="account-card workspace-preferences" aria-label="Display preferences">
      <p>Display preferences are saved on this browser.</p>
      <label>
        Theme
        <select value={theme} onChange={(event) => {
          const value = applyTheme(event.target.value);
          setTheme(value);
          saveSetting("workspace-theme", value);
        }}>
          <option value="system">Use device setting</option>
          <option value="paper">Paper</option>
          <option value="night">Night Paper</option>
          <option value="contrast">High contrast</option>
        </select>
      </label>
      <label>
        Text size
        <select value={textSize} onChange={(event) => {
          const value = applyTextSize(event.target.value);
          setTextSize(value);
          saveSetting("workspace-text-size", value);
        }}>
          <option value="standard">Standard</option>
          <option value="large">Large</option>
        </select>
      </label>
      <ExamPreferences sync={sync} />
    </section>
  );
}

export function AccountPreferences() {
  return (
    <main className="account-page screen-notice" id="main-content">
      <h1>Workspace preferences</h1>
      <PreferencesForm />
      <Link to="/dashboard">Return to account</Link>
    </main>
  );
}

export function RailIcon({ path }: { path: string }) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (path) {
    case "/app":
    case "/app/exams":
    case "/studio/exams":
    case "/studio/exams/new":
      return <svg viewBox="0 0 24 24" {...stroke}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 12h5M10 16h5" /></svg>;
    case "/app/results":
      return <svg viewBox="0 0 24 24" {...stroke}><path d="M4 20V10M10 20V4M16 20v-7M2 20h20" /></svg>;
    case "/app/disputes":
    case "/studio/disputes":
    case "/admin/disputes":
      return <svg viewBox="0 0 24 24" {...stroke}><path d="M4 4h16v12H8l-4 4z" /><path d="M8 8h8M8 11h5" /></svg>;
    case "/app/settings":
      return <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="3" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" /></svg>;
    case "/studio":
      return <svg viewBox="0 0 24 24" {...stroke}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
    case "/studio/questions":
      return <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.1 1-1.1 1.8v.4" /><path d="M12 17h.01" /></svg>;
    case "/studio/imports":
    case "/admin/imports":
      return <svg viewBox="0 0 24 24" {...stroke}><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></svg>;
    case "/admin":
      return <svg viewBox="0 0 24 24" {...stroke}><path d="M12 3 4 6v6c0 4.4 3.4 7.7 8 9 4.6-1.3 8-4.6 8-9V6z" /><path d="m9 12 2 2 4-4" /></svg>;
    case "/admin/users":
      return <svg viewBox="0 0 24 24" {...stroke}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.5-3.1 3-4.8 6-4.8s5.5 1.7 6 4.8" /><path d="M16 5.2a3.2 3.2 0 0 1 0 6M18 15.6c1.7.5 2.8 1.9 3 4.4" /></svg>;
    case "/admin/audit":
      return <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "/admin/system":
      return <svg viewBox="0 0 24 24" {...stroke}><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></svg>;
    case "/dashboard":
      return <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="8" r="3.4" /><path d="M5 20c.6-3.4 3.4-5.4 7-5.4s6.4 2 7 5.4" /></svg>;
    default:
      return <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="4" /></svg>;
  }
}

export function RoleWorkspace({ workspace, screen }: { workspace: Workspace; screen: Screen }) {
  const user = useAuthStore((state) => state.user);
  const { id } = useParams();
  const location = useLocation();
  const home = roleHome(workspace.role);
  useEffect(() => {
    if (user?.role !== workspace.role) return;
    document.getElementById("workspace-title")?.focus();
  }, [screen.path, user?.role, workspace.role]);

  if (!user?.role || !user.isVerified || user.isBlocked) {
    return <ScreenNotice title="Workspace access unavailable" message="Your account needs an assigned role and active access to open this workspace." back="/dashboard" backLabel="Return to account" />;
  }
  if (user.role !== workspace.role) return <Navigate to={roleHome(user.role)} replace />;
  const examHub = id && workspace.role === "EXAMINER" ? "/studio/exams/" + encodeURIComponent(id) : undefined;
  const navigation = [...workspace.screens.filter((item) => item.nav), { path: "/dashboard", title: "Account" }];
  const initials = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() || "SE";
  return (
    <div className={screen.exam ? "exam-shell" : "product-shell"}>
      {!screen.exam && (
        <aside className="product-rail">
          <Link className="product-brand verity-brand" to={home} aria-label="Verity home"><Logo variant="light" /></Link>
          <div className="rail-user">
            <span className="rail-avatar" aria-hidden="true">{initials}</span>
            <span className="rail-user-meta">
              <span className="rail-user-name">{user.firstName} {user.lastName}</span>
              <span className="rail-user-email">{user.email}</span>
            </span>
          </div>
          <span className="rail-label">Navigation</span>
          <nav aria-label={workspace.label}>
            {navigation.map(({ path, title }) => (
              <NavLink key={path} to={path} end={path === home}>
                <span className="rail-icon" aria-hidden="true"><RailIcon path={path} /></span>
                <span>{title}</span>
              </NavLink>
            ))}
          </nav>
          <div className="rail-bottom">
            <span className="rail-role">{workspace.label}</span>
          </div>
        </aside>
      )}
      <main className="product-main" id="main-content">
        <header className="workspace-top">
          <h1 id="workspace-title" tabIndex={-1}>{screen.title}</h1>
          {!screen.exam && <WorkspaceTools workspace={workspace} />}
        </header>
        <div className="workspace-content">
          {examHub && !screen.exam && (
            <nav className="exam-tabs" aria-label="Exam sections">
              {examTabs.map(([tab, title]) => <NavLink key={tab} to={tab === "overview" ? examHub : examHub + "/" + tab} end>{title}</NavLink>)}
              <NavLink to={examHub + "/sandbox"}>Candidate preview</NavLink>
            </nav>
          )}
          {screen.path === "/app/settings" ? <PreferencesForm sync /> :
            <RouteErrorBoundary key={screen.path.startsWith("/app/attempt/") ? location.pathname.replace(/\/review$/, "") : location.pathname}>
              <Suspense fallback={<section className="account-card" role="status">Opening workspace…</section>}>
                <WorkspaceScreen screen={screen} />
              </Suspense>
            </RouteErrorBoundary>}
        </div>
      </main>
    </div>
  );
}
