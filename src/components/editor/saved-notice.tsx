import { Link } from "@tanstack/react-router";
import { CheckCircle2, Scissors } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { Generation } from "@/lib/types";

/** Kayıttan sonra: yeni sürüm stüdyoda ayrı kart; eski kayıt durur. */
export function SavedNotice({ g }: { g: Generation }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-cyan/40 bg-cyan/10 p-4 text-sm"
    >
      <CheckCircle2 className="h-5 w-5 shrink-0 text-cyan" aria-hidden />
      <p className="min-w-0 flex-1">{t.editor.saved}</p>
      <Link
        to="/labs"
        search={g.projectId ? { project: g.projectId } : {}}
        className="font-semibold text-cyan hover:underline"
      >
        {t.editor.openStudio}
      </Link>
      <Link
        to="/editor/$id"
        params={{ id: g.id }}
        className="inline-flex items-center gap-1.5 font-semibold text-cyan hover:underline"
      >
        <Scissors className="h-4 w-4" aria-hidden />
        {t.editor.editNew}
      </Link>
    </div>
  );
}
