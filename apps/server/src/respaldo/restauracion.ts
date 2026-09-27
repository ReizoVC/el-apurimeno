import { copyFile, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { descifrarArchivo, ErrorClave, leerClavePrivada } from "./cifrado.js";
import type { ConfiguracionRespaldos } from "./configuracion.js";
import {
  destinoDeArchivo,
  ErrorRespaldo,
  fechaDeCopia,
  listarCopias,
  SUFIJO_PARCIAL,
  verificarBase,
  type CopiaGuardada,
  type ResumenBase,
  type TipoCopia,
} from "./copia.js";

// Restauración completa de la base desde una copia local o externa (RNF-BKP-02, RNF-REC-02). La base actual
// nunca se borra: se aparta a una carpeta "reemplazada-…" junto a la base.

export interface CopiaDisponible extends CopiaGuardada {
  destino: TipoCopia;
}

/**
 * Copias locales y externas (recientes y diarias) que se pueden restaurar, de la más reciente a la más antigua. Si
 * una local y una reciente son de la misma hora, primero la local: no necesita la clave privada.
 */
export async function copiasDisponibles(config: Pick<ConfiguracionRespaldos, "carpetaLocal" | "carpetaExternaConfigurada">): Promise<CopiaDisponible[]> {
  const todas: CopiaDisponible[] = [];
  const carpetas: [TipoCopia, string | null][] = [
    ["LOCAL", config.carpetaLocal],
    ["RECIENTE", config.carpetaExternaConfigurada],
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
  const orden: Record<TipoCopia, number> = { LOCAL: 0, RECIENTE: 1, EXTERNO: 2 };
  return todas.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn) || orden[a.destino] - orden[b.destino]);
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
  // Un .parcial es una copia que se estaba escribiendo (o que se cortó): nunca se restaura, aunque parezca completa.
  if (basename(archivo).endsWith(SUFIJO_PARCIAL)) {
    throw new ErrorRespaldo("COPIA_INVALIDA", `${basename(archivo)} es una copia a medio escribir (${SUFIJO_PARCIAL}): elija una copia terminada.`);
  }
  const cifrada = await esCifrada(archivo);
  const nombre = basename(archivo);
  const tipo = destinoDeArchivo(nombre);
  const tomadaEn = (tipo === null ? null : fechaDeCopia(tipo, nombre))?.toISOString() ?? null;
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
