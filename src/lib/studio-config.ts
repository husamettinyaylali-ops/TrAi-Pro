import { useQuery } from "@tanstack/react-query";

import * as api from "@/api/functions";

/** Stüdyonun kipi (canlı/demo) ve hazır ses listesi; sunucudan, 5 dakika önbellekli. */
export function useStudioConfig() {
  return useQuery({
    queryKey: ["studio-config"],
    queryFn: () => api.getStudioConfig(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
