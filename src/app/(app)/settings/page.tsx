"use client";

import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ErrorNote, errorText, PageHeader } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useWorkspace } from "@/components/workspace";

export default function SettingsPage() {
  const { workspace, workspaceId, canManage } = useWorkspace();
  const [name, setName] = useState(workspace.name);
  const [newWorkspace, setNewWorkspace] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const { data: members } = useQuery(convexQuery(api.workspaces.members, { workspaceId }));

  const rename = useMutation({ mutationFn: useConvexMutation(api.workspaces.rename) });
  const add = useMutation({ mutationFn: useConvexMutation(api.workspaces.addMember), onSuccess: () => setEmail("") });
  const remove = useMutation({ mutationFn: useConvexMutation(api.workspaces.removeMember) });
  const createWs = useMutation({ mutationFn: useConvexMutation(api.workspaces.create), onSuccess: () => setNewWorkspace("") });

  return (
    <>
      <PageHeader title="Settings" description="Workspace, team and API configuration." />
      <div className="max-w-2xl space-y-5">
        <Card>
          <CardHeader><CardTitle>Workspace</CardTitle></CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                rename.mutate({ workspaceId, name });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="ws-name">Name</Label>
                <Input id="ws-name" value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} />
              </div>
              <ErrorNote message={rename.error ? errorText(rename.error) : null} />
              {canManage && (
                <Button disabled={rename.isPending || name === workspace.name}>
                  {rename.isSuccess && name === workspace.name ? "Workspace Renamed" : "Rename Workspace"}
                </Button>
              )}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Team</CardTitle>
            <CardDescription>Admins can build agents and manage billing. Members can view calls and run test calls.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="divide-y text-sm">
              {members?.map((m) => (
                <li key={m._id} className="flex items-center justify-between py-2">
                  <span>{m.email}</span>
                  <span className="flex items-center gap-3">
                    <Badge variant="outline" className="capitalize">{m.role}</Badge>
                    {canManage && m.role !== "owner" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => remove.mutate({ workspaceId, membershipId: m._id as Id<"memberships"> })}
                      >
                        Remove Member
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {canManage && (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  add.mutate({ workspaceId, email, role });
                }}
              >
                <Input className="flex-1" type="email" required placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                <NativeSelect value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")} aria-label="Role">
                  <NativeSelectOption value="member">Member</NativeSelectOption>
                  <NativeSelectOption value="admin">Admin</NativeSelectOption>
                </NativeSelect>
                <Button disabled={add.isPending}>Add Member</Button>
              </form>
            )}
            <ErrorNote message={add.error ? errorText(add.error) : null} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>New Workspace</CardTitle>
            <CardDescription>Separate agents, calls and billing, for example per client or brand.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                createWs.mutate({ name: newWorkspace });
              }}
            >
              <Input required placeholder="Workspace name" value={newWorkspace} onChange={(e) => setNewWorkspace(e.target.value)} />
              <Button variant="outline" disabled={createWs.isPending}>Create Workspace</Button>
            </form>
            <div className="mt-2"><ErrorNote message={createWs.error ? errorText(createWs.error) : null} /></div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
