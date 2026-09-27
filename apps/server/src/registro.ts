import { closeSync, fstatSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/** Tamaño a partir del cual el registro pasa a un archivo nuevo. */
export const REGISTRO_MAX_BYTES = 10 * 1024 * 1024;
/** Archivos anteriores que se conservan (servidor.1.log … servidor.5.log): como mucho unos 60 MB en total. */
export const REGISTRO_ARCHIVOS_ANTERIORES = 5;
/** Si rotar falla (otro programa tiene el archivo abierto), se sigue escribiendo y se reintenta pasado este tiempo. */
const ESPERA_REINTENTO_MS = 60_000;

export interface OpcionesRegistro {
  maxBytes?: number;
  anteriores?: number;
  ahora?: () => number;
}

/** servidor.log → servidor.1.log, servidor.2.log… */
export function rutaAnterior(ruta: string, n: number): string {
  return ruta.endsWith(".log") ? `${ruta.slice(0, -4)}.${n}.log` : `${ruta}.${n}`;
}

/**
 * Destino del registro del servidor (Fastify/pino) que rota por tamaño mientras el proceso corre. Lo hace el propio
 * servidor porque NSSM solo rota por tamaño "en línea" (AppRotateOnline 1), y así no relanza el servidor si se cae
 * (ver README, "Servicio de Windows"). Escribe de forma síncrona: si el proceso muere, no queda nada en un búfer.
 * Un fallo del registro nunca tumba el servidor.
 */
export function registroRotativo(ruta: string, opciones: OpcionesRegistro = {}): { write(linea: string): void } {
  const maxBytes = opciones.maxBytes ?? REGISTRO_MAX_BYTES;
  const anteriores = opciones.anteriores ?? REGISTRO_ARCHIVOS_ANTERIORES;
  const ahora = opciones.ahora ?? Date.now;
  mkdirSync(dirname(ruta), { recursive: true });
  let fd = openSync(ruta, "a");
  let tamano = fstatSync(fd).size;
  let reintentarDesde = 0;

  function rotar(): void {
    closeSync(fd);
    try {
      rmSync(rutaAnterior(ruta, anteriores), { force: true });
      for (let n = anteriores - 1; n >= 1; n--) {
        try {
          renameSync(rutaAnterior(ruta, n), rutaAnterior(ruta, n + 1));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
      renameSync(ruta, rutaAnterior(ruta, 1));
    } catch {
      reintentarDesde = ahora() + ESPERA_REINTENTO_MS;
    }
    fd = openSync(ruta, "a");
    tamano = fstatSync(fd).size;
  }

  return {
    write(linea: string): void {
      try {
        const bytes = Buffer.from(linea, "utf8");
        if (tamano > 0 && tamano + bytes.length > maxBytes && ahora() >= reintentarDesde) rotar();
        writeSync(fd, bytes);
        tamano += bytes.length;
      } catch {
        // Sin disco o sin permisos: el servidor sigue atendiendo aunque no pueda registrar.
      }
    },
  };
}
