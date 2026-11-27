import { Navigate, Outlet } from "react-router-dom";
import { roleHome } from "../pages/workspace-routes";
import { useAuthStore } from "../store/auth.store";

export function GuestRoute() {
  const user = useAuthStore((state) => state.user);
  if (user) return <Navigate to={user.mustChangePassword ? "/change-password" : roleHome(user.role)} replace />;
  return <Outlet />;
}
