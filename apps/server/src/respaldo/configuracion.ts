import type { KeyObject } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ErrorClave, leerClavePublica } from "./cifrado.js";

export interface ConfiguracionRespaldos {
  rutaBase: string;
  /** null si la base no es un archivo (pruebas en memoria). */
  carpetaLocal: string | null;
  externo: { carpeta: string; clavePublica: KeyObject } | null;
  /** Carpeta externa tal como se configuró, aunque esté mal: para mostrarla en el Dashboard. */
  carpetaExternaConfigurada: string | null;
  /** Qué está mal en la copia externa, para el registro y el Dashboard; null si está bien o sin configurar. */
  problemaExterno: string | null;
}

/**
 * Lee la configuración de los respaldos del entorno. Las copias locales siempre están activas (por defecto en
 * `respaldos/`, junto a la base). La externa necesita `RESPALDO_CARPETA_EXTERNA` y `RESPALDO_CLAVE_PUBLICA`; si
 * falta algo, el servidor arranca igual y el Dashboard muestra qué falta.
 */
export function leerConfiguracionRespaldos(env: NodeJS.ProcessEnv, rutaBase: string): ConfiguracionRespaldos {
  const texto = (nombre: string) => env[nombre]?.trim() ?? "";
  const enMemoria = rutaBase === ":memory:";
  const local = texto("RESPALDO_CARPETA_LOCAL");
  const carpetaLocal = enMemoria ? null : resolve(local === "" ? join(dirname(rutaBase), "respaldos") : local);

  const carpetaExterna = texto("RESPALDO_CARPETA_EXTERNA");
  const clave = texto("RESPALDO_CLAVE_PUBLICA");
  const base = { rutaBase, carpetaLocal, carpetaExternaConfigurada: carpetaExterna === "" ? null : carpetaExterna };
  const sinExterno = (problema: string | null): ConfiguracionRespaldos => ({ ...base, externo: null, problemaExterno: problema });

  if (carpetaExterna === "" && clave === "") return sinExterno(null);
  if (carpetaExterna === "") return sinExterno("Falta RESPALDO_CARPETA_EXTERNA: la carpeta que se sincroniza con la nube.");
  if (clave === "") return sinExterno("Falta RESPALDO_CLAVE_PUBLICA: sin ella la copia externa no se puede cifrar.");
  if (!isAbsolute(carpetaExterna)) {
    return sinExterno(`RESPALDO_CARPETA_EXTERNA debe ser una ruta completa (p. ej. C:\\Users\\...\\OneDrive\\Respaldos): "${carpetaExterna}".`);
  }
  if (carpetaLocal !== null && resolve(carpetaExterna) === carpetaLocal) {
    return sinExterno("RESPALDO_CARPETA_EXTERNA no puede ser la misma carpeta de las copias locales.");
  }
  if (clave.startsWith("apr-privada-")) {
    return sinExterno(
      "RESPALDO_CLAVE_PUBLICA tiene la clave PRIVADA: bórrela de apps/server/.env (va solo en el gestor de contraseñas) y ponga la pública.",
    );
  }
  let clavePublica: KeyObject;
  try {
    clavePublica = leerClavePublica(clave);
  } catch (error) {
    if (error instanceof ErrorClave) return sinExterno(`RESPALDO_CLAVE_PUBLICA no es válida: ${error.message}`);
    throw error;
  }
  return { ...base, externo: { carpeta: resolve(carpetaExterna), clavePublica }, problemaExterno: null };
}
