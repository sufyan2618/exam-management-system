import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, NavLink, useLocation, useParams } from "react-router-dom";
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
  return (
    <div className={screen.exam ? "exam-shell" : "product-shell"}>
      {!screen.exam && (
        <aside className="product-rail">
          <Link className="product-brand" to={home}>Secure Examination</Link>
          <nav aria-label={workspace.label}>
            {navigation.map(({ path, title }, index) => (
              <NavLink key={path} className={index >= 4 ? "desktop-rail-link" : undefined} to={path} end={path === home}>{title}</NavLink>
            ))}
            <details key={screen.path} className="mobile-rail-more">
              <summary>More</summary>
              <div className="mobile-rail-menu">
                {navigation.slice(4).map(({ path, title }) => <NavLink key={path} to={path}>{title}</NavLink>)}
              </div>
            </details>
          </nav>
        </aside>
      )}
      <main className="product-main" id="main-content">
        <header className="workspace-top">
          <h1 id="workspace-title" tabIndex={-1}>{screen.title}</h1>
          {!screen.exam && workspace.role !== "CANDIDATE" && <WorkspaceTools workspace={workspace} />}
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
