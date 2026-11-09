"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { RpcError, rpcQuery } from "@/lib/rpc";
import type { WorkspaceDto } from "@/server/services/workspaces";

type Ctx = {
  workspace: WorkspaceDto;
  workspaces: WorkspaceDto[];
  workspaceId: string;
  canManage: boolean;
  switchTo: (id: string) => void;
};

const WorkspaceContext = createContext<Ctx | null>(null);
const KEY = "ringlet.workspace";

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: workspaces, isPending, error } = useQuery(rpcQuery("workspaces.mine", {}));
  const [selected, setSelected] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem(KEY),
  );

  useEffect(() => {
    if (!isPending && workspaces && workspaces.length === 0) router.replace("/onboarding");
    // Session expired or signed out in another tab. Clear the stale cookie
    // first, or the proxy would bounce /signin straight back here.
    if (error instanceof RpcError && error.status === 401) {
      void authClient.signOut().finally(() => router.replace("/signin"));
    }
  }, [isPending, workspaces, error, router]);

  const value = useMemo<Ctx | null>(() => {
    if (!workspaces?.length) return null;
    const workspace = workspaces.find((w) => w.id === selected) ?? workspaces[0];
    return {
      workspace,
      workspaces,
      workspaceId: workspace.id,
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
