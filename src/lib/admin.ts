import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/api/functions";

const ADMIN_KEY = ["admin"] as const;

/** Özet ve son yönetici işlemleri. */
export function useAdminDashboard() {
  return useQuery({
    queryKey: [...ADMIN_KEY, "dashboard"],
    queryFn: () => api.adminDashboard(),
    staleTime: 30_000,
  });
}

export function useAdminSearch(query: string) {
  return useQuery({
    queryKey: [...ADMIN_KEY, "search", query],
    queryFn: () => api.adminSearchUsers({ data: { query } }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useAdminUser(userId: string | null) {
  return useQuery({
    queryKey: [...ADMIN_KEY, "user", userId],
    queryFn: () => api.adminUserDetail({ data: { userId: userId! } }),
    enabled: !!userId,
  });
}

/** Bakiye düzeltir; başarıda yönetim verileri yenilenir. */
export function useAdjustBalance() {
  const qc = useQueryClient();
  return async (input: { userId: string; amountCents: number; reason: string }) => {
    try {
      const res = await api.adminAdjustBalance({ data: input });
      if (res.ok) await qc.invalidateQueries({ queryKey: ADMIN_KEY });
      return res;
    } catch {
      return { ok: false as const, error: "network" as const };
    }
  };
}
