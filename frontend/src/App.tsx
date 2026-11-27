import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { queryClient } from "./api/query-client";
import { getApiBaseUrl } from "./api/client";
import { Brand } from "./components/Brand";
import { FullPageLoader } from "./components/FullPageLoader";
import { GuestRoute } from "./components/GuestRoute";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useConnection } from "./hooks/useConnection";
import { useProfile } from "./hooks/useProfile";
import { PasswordAction } from "./pages/PasswordActions";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { StatusPage } from "./pages/StatusPage";

import { AccountPreferences, ScreenNotice, RoleWorkspace } from "./pages/Workspaces";
import { roleHome, workspaces } from "./pages/workspace-routes";
import { restorePreferences } from "./store/display-preferences";
import { lazy, Suspense, useEffect, useState } from "react";
import { ApiError, getErrorMessage } from "./utils/api-error";

function ConnectionGate({ connection }: { connection: ReturnType<typeof useConnection> }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(1, Math.ceil(((connection.nextCheck ?? now) - now) / 1000));
  return (
    <main className="connection-gate" id="main-content">
      <section className="gate-paper">
        <div className="gate-mark"><Brand /></div>
        <h1>Looking for the examination server</h1>
        <p className="gate-copy">Your workspace will open automatically when the service is available.</p>
        <div className="paper-tape" aria-hidden="true"><span /></div>
        <p role="status">{connection.status}</p>
        {connection.nextCheck && <p>Checking again in {seconds} s</p>}
        <details className="gate-details">
          <summary>Connection details</summary>
          <div className="diagnostics">
            <span>API: {getApiBaseUrl()}</span>
            <span>Last check: {connection.lastCheck?.toLocaleTimeString() ?? "Checking now"}</span>
            <span>{connection.diagnostic}</span>
          </div>
        </details>
        <button className="button button-primary gate-retry" onClick={() => connection.retry.current()}>
          Retry now
        </button>
      </section>
    </main>
  );
}

function TokenReset() {
  return <PasswordAction token={useParams().token} />;
}

const VerifyResult = lazy(() => import("./pages/CandidateScreens").then((module) => ({ default: module.VerifyResult })));

function PublicVerification() {
  const { code } = useParams();
  return code ? <Suspense fallback={<FullPageLoader />}><VerifyResult code={code} /></Suspense> : null;
}

function AppRoutes() {
  const profile = useProfile();
  if (profile.isPending && !profile.isPaused) return <FullPageLoader />;
  if ((profile.isError || profile.isPaused) && profile.data === undefined) {
    return (
      <ScreenNotice title="Session unavailable" message={profile.isPaused ? "Reconnect to check your session." : getErrorMessage(profile.error)}>
        {profile.error instanceof ApiError && profile.error.requestId && <p>Request ID: {profile.error.requestId}</p>}
        <button className="button button-primary" disabled={profile.isFetching} onClick={() => void profile.refetch()}>Try again</button>
      </ScreenNotice>
    );
  }
  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>
      <Route path="/reset-password/:token" element={<TokenReset />} />
      <Route path="/403" element={<StatusPage code="403" title="This area is restricted" message="Your account does not have permission to open this page. If you think this is a mistake, contact your administrator." />} />
      <Route path="/404" element={<StatusPage code="404" title="We can’t find that page" message="The address may have changed, or the page may no longer be available." primaryLabel="Go to sign in" primaryTo="/login" />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/account/preferences" element={<AccountPreferences />} />
        <Route path="/change-password" element={<PasswordAction />} />
        {workspaces.flatMap((workspace) =>
          workspace.screens.map((screen) => (
            <Route key={screen.path} path={screen.path} element={<RoleWorkspace workspace={workspace} screen={screen} />} />
          ))
        )}
      </Route>
      <Route path="/" element={<Navigate to={profile.data ? roleHome(profile.data.role) : "/login"} replace />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}

function Boot() {
  const { pathname } = useLocation();
  const isAttempt = pathname.startsWith("/app/attempt/");
  const connection = useConnection();
  if (!connection.configured) return <FullPageLoader />;
  if (!connection.ready) return <ConnectionGate connection={connection} />;
  return (
    <>
      {!isAttempt && connection.status !== "Connected" && (
        <div className="service-banner" role="status">
          <span>{connection.status}. Some actions may be unavailable.</span>
          <button onClick={() => connection.retry.current()}>Retry now</button>
        </div>
      )}
      <Routes>
        <Route path="/verify/:code" element={<PublicVerification />} />
        <Route path="*" element={<AppRoutes />} />
      </Routes>
    </>
  );
}

restorePreferences();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <Boot />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
