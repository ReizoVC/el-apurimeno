import { readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CodigoErrorRespaldo, DestinoRespaldo } from "@apurimeno/contracts";
import Database from "better-sqlite3";

// Copias de la base: una foto consistente, verificada, con un nombre que dice cuándo se tomó.

export class ErrorRespaldo extends Error {
  override name = "ErrorRespaldo";
  constructor(
    readonly codigo: CodigoErrorRespaldo,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

const EXTENSION: Record<DestinoRespaldo, string> = { LOCAL: ".db", EXTERNO: ".db.gz.cifrado" };
const PATRON: Record<DestinoRespaldo, RegExp> = {
  LOCAL: /^apurimeno-(\d{8}T\d{6})Z\.db$/,
  EXTERNO: /^apurimeno-(\d{8}T\d{6})Z\.db\.gz\.cifrado$/,
};
/** Archivo a medio escribir: se renombra al terminar; si queda uno, es de una copia interrumpida. */
export const SUFIJO_PARCIAL = ".parcial";

/** "apurimeno-20260926T141500Z.db": la hora (UTC) en que se tomó la foto de la base. */
export function nombreCopia(destino: DestinoRespaldo, tomadaEn: Date): string {
  const sello = tomadaEn.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `apurimeno-${sello}${EXTENSION[destino]}`;
}

/** Hora de una copia por su nombre; null si el archivo no es una copia de ese destino. */
export function fechaDeCopia(destino: DestinoRespaldo, nombre: string): Date | null {
  const m = PATRON[destino].exec(nombre);
  if (m?.[1] === undefined) return null;
  const s = m[1];
  const fecha = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
}

/** Destino de una copia por su nombre, o null si no es una copia. */
export function destinoDeArchivo(nombre: string): DestinoRespaldo | null {
  if (fechaDeCopia("LOCAL", nombre) !== null) return "LOCAL";
  if (fechaDeCopia("EXTERNO", nombre) !== null) return "EXTERNO";
  return null;
}

export interface CopiaGuardada {
  nombre: string;
  ruta: string;
  creadoEn: string;
  tamanoBytes: number;
}

/** Copias de un destino en una carpeta, de la más antigua a la más reciente. Otros archivos se ignoran. */
export async function listarCopias(carpeta: string, destino: DestinoRespaldo): Promise<CopiaGuardada[]> {
  const copias: CopiaGuardada[] = [];
  for (const nombre of await readdir(carpeta)) {
    const fecha = fechaDeCopia(destino, nombre);
    if (fecha === null) continue;
    const ruta = join(carpeta, nombre);
    copias.push({ nombre, ruta, creadoEn: fecha.toISOString(), tamanoBytes: (await stat(ruta)).size });
  }
  return copias.sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
}

/** Borra restos de copias interrumpidas (un corte de luz a mitad de una copia). */
export async function limpiarParciales(carpeta: string): Promise<void> {
  for (const nombre of await readdir(carpeta)) {
    if (nombre.startsWith("apurimeno-") && nombre.endsWith(SUFIJO_PARCIAL)) {
      await rm(join(carpeta, nombre), { force: true });
    }
  }
}

export interface ResumenBase {
  tickets: number;
  ultimoTicketEn: string | null;
  alquileresAbiertos: number;
  turnosAbiertos: number;
}

/**
 * Verifica que un archivo sea una base de El Apurimeño sana: integridad de SQLite y las tablas del sistema.
 * Devuelve un resumen para mostrar qué contiene. Lanza ErrorRespaldo COPIA_INVALIDA si no lo es.
 */
export function verificarBase(ruta: string): ResumenBase {
  let db: Database.Database;
  try {
    db = new Database(ruta, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new ErrorRespaldo("COPIA_INVALIDA", `No se pudo abrir la copia como base SQLite: ${(error as Error).message}`);
  }
  try {
    const integridad = db.pragma("integrity_check", { simple: true });
    if (integridad !== "ok") throw new ErrorRespaldo("COPIA_INVALIDA", `La copia no pasó la verificación de integridad: ${String(integridad)}`);
    const tablas = new Set(
      (db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((t) => t.name),
    );
    for (const tabla of ["Ticket", "Alquiler", "Turno", "Usuario"]) {
      if (!tablas.has(tabla)) throw new ErrorRespaldo("COPIA_INVALIDA", `La copia no es una base de El Apurimeño (falta la tabla ${tabla}).`);
    }
    const uno = <T>(sql: string) => db.prepare(sql).get() as T;
    const ultimo = uno<{ creadoEn: number | string | null }>('select max("creadoEn") as creadoEn from "Ticket"').creadoEn;
    return {
      tickets: uno<{ n: number }>('select count(*) as n from "Ticket"').n,
      ultimoTicketEn: ultimo === null ? null : new Date(ultimo).toISOString(),
      alquileresAbiertos: uno<{ n: number }>(`select count(*) as n from "Alquiler" where "estado" = 'ABIERTO'`).n,
      turnosAbiertos: uno<{ n: number }>(`select count(*) as n from "Turno" where "estado" = 'ABIERTO'`).n,
    };
  } catch (error) {
    if (error instanceof ErrorRespaldo) throw error;
    throw new ErrorRespaldo("COPIA_INVALIDA", `La copia no se pudo leer: ${(error as Error).message}`);
  } finally {
    db.close();
  }
}

/**
 * Foto consistente de la base en `destino` (RNF-BKP-01), sin detener el servidor: `VACUUM INTO` lee la base en
 * una sola transacción de lectura (en WAL no bloquea a quien escribe) y escribe una base compacta y completa. La
 * copia se verifica antes de darle su nombre final: un archivo con el nombre de una copia siempre está sano.
 */
export async function tomarCopia(rutaBase: string, destino: string): Promise<ResumenBase> {
  const parcial = destino + SUFIJO_PARCIAL;
  await rm(parcial, { force: true });
  const db = new Database(rutaBase, { fileMustExist: true, timeout: 5_000 });
  try {
    db.prepare("VACUUM INTO ?").run(parcial);
  } finally {
    db.close();
  }
  try {
    const resumen = verificarBase(parcial);
    await rename(parcial, destino);
    return resumen;
  } catch (error) {
    await rm(parcial, { force: true });
    throw error;
  }
}

/** Traduce un error del sistema de archivos al código que ve el Dashboard. */
export function clasificarError(error: unknown): ErrorRespaldo {
  if (error instanceof ErrorRespaldo) return error;
  const codigo = error instanceof Error && "code" in error ? String(error.code) : "";
  const mensaje = error instanceof Error ? error.message : String(error);
  if (codigo === "ENOSPC" || /SQLITE_FULL|disk is full/i.test(mensaje)) {
    return new ErrorRespaldo("SIN_ESPACIO", "No queda espacio en el disco de destino.");
  }
  if (["ENOENT", "EACCES", "EPERM", "EROFS", "ENOTDIR", "EBUSY", "EIO", "ENODEV", "SQLITE_CANTOPEN"].includes(codigo) || /unable to open/i.test(mensaje)) {
    return new ErrorRespaldo("DESTINO_INACCESIBLE", `No se pudo escribir en la carpeta de destino (${codigo || mensaje}).`);
  }
  return new ErrorRespaldo("ERROR_INTERNO", `Error al copiar la base: ${mensaje}`);
}
