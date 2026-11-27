import { useQuery } from "@tanstack/react-query";
import { authApi } from "../api/auth.api";
import { isSessionExpired, refreshAccessToken } from "../api/client";
import { useAuthStore } from "../store/auth.store";
import type { User } from "../types/auth";

async function loadProfile(signal: AbortSignal): Promise<User | null> {
  try {
    if (!useAuthStore.getState().accessToken) await refreshAccessToken();
    const profile = await authApi.profile(signal);
    useAuthStore.getState().setUser(profile.data);
    return profile.data;
  } catch (error) {
    if (!isSessionExpired(error)) throw error;
    useAuthStore.getState().clearSession();
    return null;
  }
}

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: ({ signal }) => loadProfile(signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
