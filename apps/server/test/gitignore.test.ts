import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Ningún archivo con secretos o datos del negocio debe poder subirse por descuido (auditoría del 26/09): se
// pregunta a git, con las reglas reales de todos los .gitignore del repositorio.

const RAIZ = fileURLToPath(new URL("../../..", import.meta.url));

function ignorado(ruta: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", ruta], { cwd: RAIZ });
    return true;
  } catch {
    return false;
  }
}

describe(".gitignore cubre secretos y datos del negocio en todo el repositorio", () => {
  it.each([
    "apps/server/.env",
    "apps/server/.env.production",
    "apps/server/.env.bak",
    "apps/server/.env.local",
    "apps/native/.env",
    "apps/native/.env.production",
    "apps/native/.env.bak",
    "apps/native/src-tauri/.env",
    "apps/owner/.env.local",
    "apps/owner/.env.production.local",
    "apps/owner/.dev.vars",
    "apps/web/.env.production",
    "apps/cleaning/.env.bak",
    "apps/store-catalog/.env",
    "packages/domain/.env.production",
    ".env.production",
    "apps/native/src-tauri/firma-actualizaciones.key",
    "apps/server/clave-privada.txt",
    "respaldo-clave-privada.txt",
    "apps/server/certificado.pem",
    "apps/server/datos/apurimeno.db",
    "apps/server/prueba.db",
    "apps/server/prueba.db-wal",
    "apps/server/prueba.db-shm",
    "copia.sqlite",
    "apps/server/respaldos/apurimeno-20260926T090000Z.db.gz.cifrado",
    "supabase/.temp/project-ref",
  ])("%s queda ignorado", (ruta) => {
    expect(ignorado(ruta)).toBe(true);
  });

  it.each(["apps/server/.env.example", "apps/owner/.env.example", "apps/native/.env.example", "apps/server/src/scripts/clave-respaldo.ts"])(
    "%s sí se puede subir",
    (ruta) => {
      expect(ignorado(ruta)).toBe(false);
    },
  );

  it("ningún archivo ya versionado queda ignorado por estas reglas", () => {
    const versionadosIgnorados = execFileSync("git", ["ls-files", "-ci", "--exclude-standard"], { cwd: RAIZ, encoding: "utf8" }).trim();
    expect(versionadosIgnorados).toBe("");
  });
});
