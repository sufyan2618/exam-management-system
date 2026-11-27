import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { authApi } from "../api/auth.api";
import { queryClient } from "../api/query-client";
import { Alert } from "../components/Alert";
import { Brand, InfinityMark } from "../components/Brand";
import { Button } from "../components/Button";
import { SelectField } from "../components/SelectField";
import { StatCard } from "../components/StatCard";
import { useProfile } from "../hooks/useProfile";
import { useAuthStore } from "../store/auth.store";
import { getErrorMessage } from "../utils/api-error";

const RANGE_OPTIONS = [
  { label: "This week", value: "week" },
  { label: "This month", value: "month" },
  { label: "This year", value: "year" },
];

const DUMMY_STATS = {
  week: [
    { label: "Visits", value: "1,284", note: "Weekly preview" },
    { label: "New users", value: "86", note: "Example data" },
    { label: "Tasks done", value: "24", note: "Example data" },
  ],
  month: [
    { label: "Visits", value: "8,410", note: "Monthly preview" },
    { label: "New users", value: "340", note: "Example data" },
    { label: "Tasks done", value: "112", note: "Example data" },
  ],
  year: [
    { label: "Visits", value: "96,220", note: "Yearly preview" },
    { label: "New users", value: "4,180", note: "Example data" },
    { label: "Tasks done", value: "1,406", note: "Example data" },
  ],
};

const ACTIVITIES = [
  "Explore your workspace",
  "Review your account details",
  "Keep your sign-in details up to date",
];

export function DashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = useProfile();
  const storedUser = useAuthStore((state) => state.user);
  const user = profile.data ?? storedUser;
  const [range, setRange] = useState("week");
  const stats = DUMMY_STATS[range as keyof typeof DUMMY_STATS] ?? DUMMY_STATS.week;

  const logout = useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      useAuthStore.getState().clearSession();
      queryClient.setQueryData(["profile"], null);
      navigate("/login", { replace: true });
    },
  });

  if (!user) return null;

  const joined = new Date(user.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <Brand />
        <nav className="sidebar-nav" aria-label="Dashboard navigation">
          <a href="#overview" aria-current={location.hash !== "#account" ? "location" : undefined}><span className="nav-icon" aria-hidden="true">▦</span>Overview</a>
          <a href="#account" aria-current={location.hash === "#account" ? "location" : undefined}><span className="nav-icon" aria-hidden="true">◎</span>My account</a>
        </nav>
        <div className="sidebar-note">
          <InfinityMark />
          <p>A little space.<br />Endless possibility.</p>
          <span>Make room for what comes next.</span>
        </div>
        <Button type="button" variant="danger" loading={logout.isPending} onClick={() => logout.mutate()}>
          Log out
        </Button>
      </aside>
      <div className="dashboard-content">
        <header className="topbar">
          <p className="topbar-label">Your workspace <span aria-hidden="true"> / </span> <strong>Overview</strong></p>
          <div className="topbar-actions">
            <span className="avatar" aria-hidden="true">{user.firstName.slice(0, 1)}{user.lastName.slice(0, 1)}</span>
            <div className="topbar-user"><strong>{user.firstName} {user.lastName}</strong><span className="topbar-email">{user.email}</span></div>
          </div>
        </header>

      <main className="dashboard-main" id="main-content" tabIndex={-1}>
        <div className="dashboard-intro" id="overview">
          <div>
            <p className="eyebrow">YOUR EVERYDAY, WITH POSSIBILITY</p>
            <h1>
              Welcome back, {user.firstName}.
            </h1>
            <p>A little clarity for whatever comes next.</p>
          </div>
          <SelectField
            label="Time range"
            name="range"
            value={range}
            onChange={setRange}
            options={RANGE_OPTIONS}
          />
        </div>

        {logout.error ? <Alert tone="error" message={getErrorMessage(logout.error)} /> : null}

        <section className="welcome-banner" aria-labelledby="welcome-title">
          <div>
            <p className="eyebrow">ONE ACCOUNT. YOUR OWN SPACE.</p>
            <h2 id="welcome-title">Good things start here.</h2>
            <p>Your account and workspace, together in one place.</p>
          </div>
          <InfinityMark />
        </section>

        <section aria-labelledby="snapshot-title">
          <div className="section-heading"><h2 id="snapshot-title">Workspace snapshot</h2><span className="preview-badge">Demo data</span></div>
          <div className="stat-grid">
            {stats.map((stat) => (
              <StatCard key={stat.label} label={stat.label} value={stat.value} note={stat.note} />
            ))}
          </div>
          <p className="preview-note">These figures illustrate your workspace and are not live account analytics.</p>
        </section>

        <section className="panel-grid">
          <article className="panel" id="account">
            <h2>My account</h2>
            <p className="panel-description">The details that make this space yours.</p>
            <dl className="account-list">
              <div>
                <dt>Email</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd><span className={user.isVerified ? "status-badge" : undefined}>{user.isVerified ? "Verified" : "Not verified"}</span></dd>
              </div>
              <div>
                <dt>Joined</dt>
                <dd>{joined}</dd>
              </div>
            </dl>
          </article>
          <article className="panel">
            <h2>Make yourself at home</h2>
            <p className="panel-description">A few things to get you started.</p>
            <ul className="activity-list">
              {ACTIVITIES.map((item) => (
                <li key={item}><span className="activity-check" aria-hidden="true">✓</span>{item}</li>
              ))}
            </ul>
          </article>
        </section>
        <footer className="dashboard-footer"><span>© {new Date().getFullYear()} Infinity</span><span>Your space. Your possibilities.</span></footer>
      </main>
      </div>
    </div>
  );
}
