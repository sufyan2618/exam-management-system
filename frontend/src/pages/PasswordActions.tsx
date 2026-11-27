import { useState } from "react";
import { AuthLayout } from "../components/AuthLayout";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { queryClient } from "../api/query-client";
import { ActionError } from "../components/ExamData";
import { useAuthStore } from "../store/auth.store";
import { roleHome } from "./workspace-routes";

export function PasswordAction({ token }: { token?: string }) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const update = useMutation({
    mutationFn: () => token
      ? apiRequest("/api/auth/reset-password", { method: "POST", auth: false, body: { token, newPassword: password } })
      : apiRequest("/api/auth/change-password", { method: "POST", body: { currentPassword, newPassword: password } }),
    onSuccess: async (response) => {
      if (!token) {
        const data = (response as {data: {accessToken: string}}).data;
        useAuthStore.getState().setAccessToken(data.accessToken);
      }
      if (token) navigate("/login", { replace: true, state: { message: "Password updated. Sign in with your new password." } });
      else {
        await queryClient.invalidateQueries({ queryKey: ["profile"] });
        const updated = useAuthStore.getState().user;
        if (updated && !updated.mustChangePassword) navigate(roleHome(updated.role), { replace: true });
      }
    },
  });
  return <AuthLayout title={token ? "Set a new password" : "Update your password"} subtitle="Choose a strong password to keep your workspace secure." footer={<p>Keep your credentials private and your account protected.</p>}>
    <form className="exam-form auth-password-form" onSubmit={(event) => {
      event.preventDefault();
      if (password === confirmation && password.length >= 6 && !update.isPending) update.mutate();
    }}>
      {!token && <label>Current password<input type="password" autoComplete="current-password" value={currentPassword}
        required onChange={(event) => setCurrentPassword(event.target.value)} /></label>}
      <label>New password<input type="password" autoComplete="new-password" minLength={6} value={password}
        required onChange={(event) => setPassword(event.target.value)} /></label>
      <label>Confirm new password<input type="password" autoComplete="new-password" value={confirmation}
        required onChange={(event) => setConfirmation(event.target.value)} /></label>
      {confirmation && confirmation !== password && <p role="status">Passwords must match.</p>}
      <ActionError error={update.error} />
      <button className="button button-primary" disabled={password.length < 6 || password !== confirmation || update.isPending}>Update password</button>
      {token ? <Link to="/forgot-password">Request another reset</Link> :
        !user?.mustChangePassword && <Link to="/dashboard">Return to account</Link>}
    </form>
  </AuthLayout>;
}
