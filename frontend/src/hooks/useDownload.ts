import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "../api/client";

export function useDownload(path: string, filename: string) {
  return useMutation({
    mutationFn: () => apiRequest<Blob>(path, { responseType: "blob" }),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
  });
}
