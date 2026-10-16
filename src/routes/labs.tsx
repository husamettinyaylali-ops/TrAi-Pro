import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { TOOLS, type Tool } from "@/components/studio/hooks";
import { StudioWorkspace } from "@/components/studio/workspace";
import { RequireAuth } from "@/components/site/require-auth";
import { SiteShell } from "@/components/site/shell";
import { useProjects } from "@/lib/store";

const ID_RE = /^[\w-]{1,80}$/;
type LabsSearch = { tab?: Tool; project?: string; edit?: string };

/** Aramadaki etkin projeyi değiştirir; id yoksa parametre kaldırılır. */
function withProject({ project: _old, ...rest }: LabsSearch, id: string | undefined): LabsSearch {
  return id ? { ...rest, project: id } : rest;
}

export const Route = createFileRoute("/labs")({
  // ?tab= araç, ?project= etkin proje (yeni üretimler oraya kaydedilir, akış onu gösterir).
  validateSearch: (s: Record<string, unknown>): LabsSearch => ({
    ...(TOOLS.includes(s["tab"] as Tool) ? { tab: s["tab"] as Tool } : {}),
    ...(typeof s["project"] === "string" && ID_RE.test(s["project"])
      ? { project: s["project"] }
      : {}),
    // ?edit= proje sayfasından düzenlemeye açılan kayıt; yüklenince kaldırılır.
    ...(typeof s["edit"] === "string" && ID_RE.test(s["edit"]) ? { edit: s["edit"] } : {}),
  }),
  head: () => ({ meta: [{ title: "Stüdyo — TrAi Pro" }] }),
  component: LabsPage,
});

function Labs() {
  const { tab = "tts", project, edit } = Route.useSearch();
  const navigate = useNavigate({ from: "/labs" });
  const projects = useProjects();
  // Silinmiş ya da başkasına ait proje bağlantısı: süzgeç kaldırılır.
  const known =
    !projects.data || projects.isFetching || projects.data.some((p) => p.id === project);
  useEffect(() => {
    if (project && !known) {
      void navigate({ search: (s) => withProject(s, undefined), replace: true });
    }
  }, [project, known, navigate]);

  return (
    <StudioWorkspace
      tool={tab}
      projectId={project && known ? project : undefined}
      editId={edit}
      onTool={(k) => void navigate({ search: (s) => ({ ...s, tab: k }), replace: true })}
      onProject={(id) => void navigate({ search: (s) => withProject(s, id), replace: true })}
      onEditLoaded={() => void navigate({ search: ({ edit: _e, ...s }) => s, replace: true })}
    />
  );
}

function LabsPage() {
  return (
    <SiteShell workspace>
      <RequireAuth>
        <Labs />
      </RequireAuth>
    </SiteShell>
  );
}
