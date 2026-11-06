import { execFileSync } from "node:child_process";

// Lo que obliga a detener los servicios: los mismos caminos que $rutasCompleta de scripts/actualizar-produccion.ps1.
const RUTAS_COMPLETA = ["pnpm-lock.yaml", "apps/server/prisma/migrations", "apps/server/prisma/schema.prisma"];

/**
 * La última versión que exigió detener los servicios, mirando el commit actual y las etiquetas anteriores, de la más
 * nueva a la más vieja. La primera versión publicada no tiene contra qué compararse y cuenta como completa.
 */
export function ultimaVersionCompleta(repositorio: string, version: string): string {
  const git = (...argumentos: string[]) => execFileSync("git", argumentos, { cwd: repositorio, encoding: "utf8" });
  const etiquetas = git("tag", "--list", "v*.*.*", "--merged", "HEAD", "--sort=-v:refname")
    .split(/\r?\n/)
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  const puntos = ["HEAD", ...etiquetas];
  const versiones = [version, ...etiquetas.map((t) => t.slice(1))];
  for (let i = 0; i < puntos.length - 1; i++) {
    if (git("diff", "--name-only", puntos[i + 1]!, puntos[i]!, "--", ...RUTAS_COMPLETA).trim() !== "") return versiones[i]!;
  }
  return versiones.at(-1)!;
}
