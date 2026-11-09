import "server-only";
import type { Workspace } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { TRIAL_SECONDS } from "@/lib/shared/limits";
import { MANAGERS, requireMember } from "../access";
import { db } from "../db";
import { UserError } from "../errors";
import type { MemberRole } from "../schemas";

export type WorkspaceDto = {
  id: string;
  name: string;
  creditSeconds: number;
  createdAt: number;
  role: MemberRole;
};

function toDto(w: Workspace, role: MemberRole): WorkspaceDto {
  return { id: w.id, name: w.name, creditSeconds: w.creditSeconds, createdAt: w.createdAt.getTime(), role };
}

function cleanName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new UserError("Workspace name is required");
  return trimmed.slice(0, 80);
}

/** The caller's workspaces, with their role in each. */
export async function mine(userId: string) {
  const memberships = await db.membership.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => toDto(m.workspace, m.role));
}

export async function get(userId: string, { workspaceId }: { workspaceId: string }) {
  const { workspace, membership } = await requireMember(userId, workspaceId);
  return toDto(workspace, membership.role);
}

export async function create(userId: string, { name }: { name: string }) {
  const clean = cleanName(name);
  return db.$transaction(async (tx) => {
    // Only the first workspace a user creates gets trial minutes.
    const existing = await tx.workspace.findFirst({ where: { ownerId: userId }, select: { id: true } });
    const workspace = await tx.workspace.create({
      data: {
        name: clean,
        ownerId: userId,
        creditSeconds: existing ? 0 : TRIAL_SECONDS,
        memberships: { create: { userId, role: "owner" } },
      },
    });
    return workspace.id;
  });
}

export async function rename(userId: string, { workspaceId, name }: { workspaceId: string; name: string }) {
  await requireMember(userId, workspaceId, MANAGERS);
  await db.workspace.update({ where: { id: workspaceId }, data: { name: cleanName(name) } });
}

export async function members(userId: string, { workspaceId }: { workspaceId: string }) {
  await requireMember(userId, workspaceId);
  const rows = await db.membership.findMany({
    where: { workspaceId },
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({ id: m.id, role: m.role, email: m.user.email }));
}

/** Adds an existing Ringlet user (by email) to the workspace. */
export async function addMember(
  userId: string,
  { workspaceId, email, role }: { workspaceId: string; email: string; role: "admin" | "member" },
) {
  await requireMember(userId, workspaceId, MANAGERS);
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw new UserError("No Ringlet account with that email. Ask them to sign up first.");
  try {
    await db.membership.create({ data: { workspaceId, userId: user.id, role } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new UserError("Already a member");
    }
    throw e;
  }
}

export async function removeMember(
  userId: string,
  { workspaceId, membershipId }: { workspaceId: string; membershipId: string },
) {
  await requireMember(userId, workspaceId, MANAGERS);
  const target = await db.membership.findUnique({ where: { id: membershipId } });
  if (!target || target.workspaceId !== workspaceId) throw new UserError("Member not found", 404);
  if (target.role === "owner") throw new UserError("The owner cannot be removed");
  await db.membership.delete({ where: { id: membershipId } });
}
