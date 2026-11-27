import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "../api/auth.api";
import { queryClient } from "../api/query-client";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { useProfile } from "../hooks/useProfile";
import { useAuthStore } from "../store/auth.store";
import { clearAttemptQueues } from "../store/attempt-runtime";
import { roleHome } from "./workspace-routes";
import { getErrorMessage } from "../utils/api-error";

export function DashboardPage() {
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

  if (!user) return null;
  const joined = new Date(user.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  return <main className="account-page" id="main-content">
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
    <footer className="page-footer"><span>Secure Examination Management</span><span>All times shown in your local timezone</span></footer>
  </main>;
}
