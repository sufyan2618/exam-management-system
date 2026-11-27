import { useQuery } from "@tanstack/react-query";
import { examGet } from "../api/examination";
import { ApiError } from "../utils/api-error";
import { useAuthStore } from "../store/auth.store";

export function useExamData<T>(path: string, options: { enabled?: boolean; auth?: boolean; refreshMs?: number } = {}) {
  const user = useAuthStore((state) => state.user?.id);
  return useQuery({
    queryKey: ["examination", options.auth === false ? "public" : user, path],
    queryFn: ({ signal }) => examGet<T>(path, signal, options.auth),
    enabled: options.enabled ?? true,
    staleTime: 15_000,
    retry: (count, error) => count < 3 && error instanceof ApiError && error.retryable,
    refetchInterval: options.refreshMs,
  });
}
