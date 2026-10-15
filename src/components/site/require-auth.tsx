import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import { useApp } from "@/lib/store";

const AUTH_PAGES = ["/sign-in", "/sign-up"];

/** Oturum yoksa giriş sayfasına, dönüş adresiyle birlikte bir kez yönlendirir. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { hydrated, user } = useApp();
  const { t } = useI18n();
  const location = useRouterState({ select: (s) => s.location });
  const navigate = useNavigate();
  const sent = useRef(false);

  useEffect(() => {
    // Yönlendirme sürerken bu bileşen giriş sayfasının adresini görebilir;
    // o adresi dönüş adresi yapmak iç içe yönlendirme döngüsü yaratır.
    if (!hydrated || user || sent.current || AUTH_PAGES.includes(location.pathname)) return;
    sent.current = true;
    navigate({ to: "/sign-in", search: { redirect: location.href }, replace: true });
  }, [hydrated, user, location, navigate]);

  if (!hydrated || !user) {
    return (
      <div
        className="mx-auto max-w-5xl space-y-4 px-4 py-16 sm:px-6"
        aria-busy="true"
        aria-label={t.loading}
      >
        <div className="shimmer h-10 w-1/3 rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="shimmer h-28 rounded-3xl" />
          <div className="shimmer h-28 rounded-3xl" />
        </div>
        <div className="shimmer h-72 rounded-3xl" />
      </div>
    );
  }
  return <>{children}</>;
}
