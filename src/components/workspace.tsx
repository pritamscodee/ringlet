"use client";

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";

type Workspace = Doc<"workspaces"> & { role: Doc<"memberships">["role"] };

type Ctx = {
  workspace: Workspace;
  workspaces: Workspace[];
  workspaceId: Id<"workspaces">;
  canManage: boolean;
  switchTo: (id: Id<"workspaces">) => void;
};

const WorkspaceContext = createContext<Ctx | null>(null);
const KEY = "ringlet.workspace";

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: workspaces, isPending } = useQuery(convexQuery(api.workspaces.mine, {}));
  const [selected, setSelected] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem(KEY),
  );

  useEffect(() => {
    if (!isPending && workspaces && workspaces.length === 0) router.replace("/onboarding");
  }, [isPending, workspaces, router]);

  const value = useMemo<Ctx | null>(() => {
    if (!workspaces?.length) return null;
    const workspace = workspaces.find((w) => w._id === selected) ?? workspaces[0];
    return {
      workspace,
      workspaces,
      workspaceId: workspace._id,
      canManage: workspace.role !== "member",
      switchTo: (id) => {
        localStorage.setItem(KEY, id);
        setSelected(id);
      },
    };
  }, [workspaces, selected]);

  if (!value) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

export function rememberWorkspace(id: string) {
  localStorage.setItem(KEY, id);
}
