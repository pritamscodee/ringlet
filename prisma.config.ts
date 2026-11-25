import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// The Prisma CLI doesn't read Next.js env files on its own.
config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Migrations need Neon's direct (unpooled) endpoint; the app uses the pooled one.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
