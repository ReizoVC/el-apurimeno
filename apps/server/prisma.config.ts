import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Mismo archivo que leen `pnpm start` y `pnpm dev` (--env-file-if-exists): la migración usa la misma base que el
// servidor. Las variables ya definidas en el entorno tienen prioridad.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "file:./datos/apurimeno.db",
  },
});
