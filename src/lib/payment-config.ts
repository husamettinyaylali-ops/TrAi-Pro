import { useQuery } from "@tanstack/react-query";

import * as api from "@/api/functions";

/** Açık ödeme yöntemleri ve alıcı bilgileri; sunucudan, 5 dakika önbellekli. */
export function usePaymentConfig() {
  return useQuery({
    queryKey: ["payment-config"],
    queryFn: () => api.getPaymentConfig(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
