/**
 * Adds talk time to a workspace. There is no self-serve billing; this is
 * how an operator tops a workspace up.
 *
 *   bun run grant-minutes <workspace id | owner email> <minutes>
 *
 * Reads DATABASE_URL from .env.local (bun loads it automatically).
 */
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

const [target, minutesArg] = process.argv.slice(2);
const minutes = Number(minutesArg);
if (!target || !Number.isInteger(minutes) || minutes === 0) {
  console.error("Usage: bun run grant-minutes <workspace id | owner email> <minutes>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });

try {
  const workspaces = target.includes("@")
    ? await db.workspace.findMany({ where: { owner: { email: target.toLowerCase() } } })
    : await db.workspace.findMany({ where: { id: target } });
  if (workspaces.length !== 1) {
    console.error(
      workspaces.length
        ? `${target} owns ${workspaces.length} workspaces; pass a workspace id instead:\n${workspaces
            .map((w) => `  ${w.id}  ${w.name}`)
            .join("\n")}`
        : `No workspace found for ${target}`,
    );
    process.exit(1);
  }
  const [{ id, name }] = workspaces;
  const [updated] = await db.$queryRaw<{ creditSeconds: number }[]>`
    UPDATE "workspace" SET "creditSeconds" = GREATEST(0, "creditSeconds" + ${minutes * 60})
    WHERE "id" = ${id} RETURNING "creditSeconds"`;
  console.log(`${name} (${id}): ${Math.floor(updated.creditSeconds / 60)} minutes left`);
} finally {
  await db.$disconnect();
}
