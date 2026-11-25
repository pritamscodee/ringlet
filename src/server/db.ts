import "server-only";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";

// Don't throw when DATABASE_URL is missing: `next build` imports route modules to collect
// page data, and better-auth reads the client's schema metadata at import. Constructing the
// client opens no connection, so a missing URL only surfaces when a query actually runs.
function createClient() {
  return new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
  });
}

// One client per server instance; dev hot reloads would otherwise open a new pool each time.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
