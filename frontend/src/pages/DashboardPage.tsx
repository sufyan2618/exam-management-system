import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { authApi } from "../api/auth.api";
import { queryClient } from "../api/query-client";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { useProfile } from "../hooks/useProfile";
import { useAuthStore } from "../store/auth.store";
import { clearAttemptQueues } from "../store/attempt-runtime";
import { roleHome, workspaces } from "./workspace-routes";
import { Logo } from "../components/Brand";
import { getErrorMessage } from "../utils/api-error";

export function DashboardPage() {
  const accountPageRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const profile = useProfile();
  const storedUser = useAuthStore((state) => state.user);
  const user = profile.data ?? storedUser;
  const logout = useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      useAuthStore.getState().clearSession();
      void clearAttemptQueues().catch(() => undefined);
      queryClient.clear();
      queryClient.setQueryData(["profile"], null);
      navigate("/login", { replace: true });
    },
  });

  useEffect(() => {
    const cards = accountPageRef.current?.querySelectorAll<HTMLElement>(".account-card");
    if (!cards?.length) return;
    if (!("IntersectionObserver" in window)) {
      cards.forEach((card) => card.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, []);

  if (!user) return null;
  const workspace = workspaces.find((item) => item.role === user.role);
  const navigation = [...(workspace?.screens.filter((item) => item.nav) ?? []), { path: "/dashboard", title: "Account" }];
  const joined = new Date(user.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  return <div className="product-shell account-shell"><aside className="product-rail"><Link className="product-brand verity-brand" to={roleHome(user.role)} aria-label="Verity home"><Logo variant="light" /></Link><div className="rail-user"><span className="rail-avatar" aria-hidden="true">{user.firstName?.[0] ?? "V"}</span><span className="rail-user-meta"><span className="rail-user-name">{user.firstName} {user.lastName}</span><span className="rail-user-email">{user.email}</span></span></div><span className="rail-label">Navigation</span><nav aria-label={workspace?.label ?? "Account navigation"}>{navigation.map(({path,title}) => <NavLink key={path} to={path} end={path === roleHome(user.role)}><span className="rail-icon" aria-hidden="true">{path === "/dashboard" ? "◉" : "↗"}</span><span>{title}</span></NavLink>)}</nav><div className="rail-bottom"><span className="rail-role">{workspace?.label ?? "Account"}</span></div></aside><div className="product-main" id="main-content"><header className="workspace-top"><h1>Account overview</h1></header><main className="account-page" id="account-content">
    <header className="account-header"><div><p className="eyebrow">ACCOUNT / OVERVIEW</p><h1>Welcome back, {user.firstName}.</h1><p>Your account details and examination workspace.</p></div><Button variant="ghost" onClick={() => logout.mutate()} loading={logout.isPending}>Sign out</Button></header>
    {logout.error ? <Alert tone="error" message={getErrorMessage(logout.error)} /> : null}
    <section className="account-card"><div className="card-heading"><div><p className="eyebrow">YOUR PROFILE</p><h2>Account details</h2></div><span className={user.isVerified ? "status-badge" : "status-badge pending"}>{user.isVerified ? "Verified" : "Verification pending"}</span></div><dl className="profile-details"><div><dt>Name</dt><dd>{user.firstName} {user.lastName}</dd></div><div><dt>Email address</dt><dd>{user.email}</dd></div><div><dt>Member since</dt><dd>{joined}</dd></div><div><dt>Account</dt><dd>{user.isBlocked ? "Restricted" : "Active"}</dd></div></dl></section>
    <section className="account-card screen-notice">
      <h2>Examination workspace</h2>
      {roleHome(user.role) !== "/dashboard" && !user.isBlocked && user.isVerified
        ? <Link to={roleHome(user.role)}>Open your workspace</Link>
        : <p>Your examination workspace requires an active account with an assigned role.</p>}
      <Link to="/account/preferences">Display preferences</Link>
    </section>
    <footer className="page-footer"><span>Verity · Secure Examination</span><span>All times shown in your local timezone</span></footer>
  </main></div></div>;
}
