import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import { useApp } from "@/lib/store";

/** Oturum yoksa giriş sayfasına, dönüş adresiyle birlikte yönlendirir. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { hydrated, user } = useApp();
  const { t } = useI18n();
  const href = useRouterState({ select: (s) => s.location.href });
  const navigate = useNavigate();

  useEffect(() => {
    if (hydrated && !user) navigate({ to: "/sign-in", search: { redirect: href }, replace: true });
  }, [hydrated, user, href, navigate]);

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
