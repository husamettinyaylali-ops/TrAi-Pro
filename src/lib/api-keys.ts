import { useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/api/functions";

const KEYS = ["api-keys"] as const;

export function useApiKeys(enabled: boolean) {
  return useQuery({ queryKey: KEYS, queryFn: () => api.listApiKeys(), enabled });
}

/** Anahtar oluşturma/iptal; başarıda liste yenilenir. Ağ hatası "network" döner. */
export function useApiKeyActions() {
  const qc = useQueryClient();
  const run = async <R extends { ok: boolean }>(fn: () => Promise<R>) => {
    try {
      const res = await fn();
      if (res.ok) await qc.invalidateQueries({ queryKey: KEYS });
      return res;
    } catch {
      return { ok: false as const, error: "network" as const };
    }
  };
  return {
    create: (name: string) => run(() => api.createApiKey({ data: { name } })),
    revoke: (id: string) => run(() => api.revokeApiKey({ data: { id } })),
  };
}
