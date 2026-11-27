import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/auth.store";

export function ProtectedRoute() {
  const user = useAuthStore((state) => state.user);
  const { pathname, search } = useLocation();
  if (!user) return <Navigate to={"/login?next=" + encodeURIComponent(pathname + search)} replace />;
  if (user.mustChangePassword && pathname !== "/change-password") return <Navigate to="/change-password" replace />;
  return <Outlet />;
}
