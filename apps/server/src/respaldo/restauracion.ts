import { copyFile, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { DestinoRespaldo } from "@apurimeno/contracts";
import { descifrarArchivo, ErrorClave, leerClavePrivada } from "./cifrado.js";
import type { ConfiguracionRespaldos } from "./configuracion.js";
import { fechaDeCopia, listarCopias, verificarBase, type CopiaGuardada, type ResumenBase } from "./copia.js";

// Restauración completa de la base desde una copia local o externa (RNF-BKP-02, RNF-REC-02). La base actual
// nunca se borra: se aparta a una carpeta "reemplazada-…" junto a la base.

export interface CopiaDisponible extends CopiaGuardada {
  destino: DestinoRespaldo;
}

/** Copias locales y externas que se pueden restaurar, de la más reciente a la más antigua. */
export async function copiasDisponibles(config: Pick<ConfiguracionRespaldos, "carpetaLocal" | "carpetaExternaConfigurada">): Promise<CopiaDisponible[]> {
  const todas: CopiaDisponible[] = [];
  const carpetas: [DestinoRespaldo, string | null][] = [
    ["LOCAL", config.carpetaLocal],
    ["EXTERNO", config.carpetaExternaConfigurada],
  ];
  for (const [destino, carpeta] of carpetas) {
    if (carpeta === null) continue;
    try {
      todas.push(...(await listarCopias(carpeta, destino)).map((c) => ({ ...c, destino })));
    } catch {
      // La carpeta no existe (p. ej. el disco que falló): se restaura desde la otra.
    }
  }
  return todas.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
}

async function esCifrada(ruta: string): Promise<boolean> {
  const archivo = await open(ruta, "r");
  try {
    const inicio = Buffer.alloc(8);
    await archivo.read(inicio, 0, 8, 0);
    if (inicio.toString("ascii") === "APURESP1") return true;
    const sqlite = Buffer.alloc(16);
    await archivo.read(sqlite, 0, 16, 0);
    if (sqlite.toString("ascii") === "SQLite format 3\0") return false;
  } finally {
    await archivo.close();
  }
  throw new ErrorClave(`${basename(ruta)} no es una copia de El Apurimeño (ni una base SQLite ni una copia externa cifrada).`);
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await stat(ruta);
    return true;
  } catch {
    return false;
  }
}

export interface ResultadoRestauracion {
  /** Hora en que se tomó la copia (por su nombre); null si el archivo fue renombrado. */
  tomadaEn: string | null;
  cifrada: boolean;
  resumen: ResumenBase;
  /** Carpeta donde quedó la base que se reemplazó; null si no había base. */
  baseAnteriorEn: string | null;
}

/**
 * Restaura `archivo` como la base en `rutaBase`. El servidor debe estar detenido. La copia se descifra (si es
 * externa) y se verifica completa ANTES de tocar la base actual: si algo falla, la base actual queda como estaba.
 */
export async function restaurar(archivo: string, rutaBase: string, clavePrivada: string | null, ahora: Date): Promise<ResultadoRestauracion> {
  const cifrada = await esCifrada(archivo);
  const nombre = basename(archivo);
  const tomadaEn = (fechaDeCopia("LOCAL", nombre) ?? fechaDeCopia("EXTERNO", nombre))?.toISOString() ?? null;
  const temporal = `${rutaBase}.restaurando`;
  await mkdir(dirname(rutaBase), { recursive: true });
  await rm(temporal, { force: true });

  let resumen: ResumenBase;
  try {
    if (cifrada) {
      if (clavePrivada === null || clavePrivada.trim() === "") {
        throw new ErrorClave("Esta copia está cifrada: hace falta la clave privada de respaldo (la del gestor de contraseñas).");
      }
      await descifrarArchivo(archivo, temporal, leerClavePrivada(clavePrivada));
    } else {
      await copyFile(archivo, temporal);
    }
    resumen = verificarBase(temporal);
  } catch (error) {
    await rm(temporal, { force: true });
    throw error;
  }

  // Aparta la base actual con sus archivos de WAL: juntos son la base tal como estaba.
  let baseAnteriorEn: string | null = null;
  const acompanantes = [rutaBase, `${rutaBase}-wal`, `${rutaBase}-shm`];
  if ((await Promise.all(acompanantes.map(existe))).some(Boolean)) {
    baseAnteriorEn = join(dirname(rutaBase), `reemplazada-${ahora.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`);
    await mkdir(baseAnteriorEn, { recursive: true });
    for (const ruta of acompanantes) {
      if (await existe(ruta)) await rename(ruta, join(baseAnteriorEn, basename(ruta)));
    }
  }
  await rename(temporal, rutaBase);
  return { tomadaEn, cifrada, resumen, baseAnteriorEn };
}
