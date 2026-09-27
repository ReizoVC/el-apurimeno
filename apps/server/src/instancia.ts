import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rutaDesdeUrl } from "./db.js";
import { leerConfiguracionEspejo, type ConfiguracionEspejo } from "./espejo/configuracion.js";
import { leerConfiguracionRespaldos, type ConfiguracionRespaldos } from "./respaldo/configuracion.js";

// Qué instancia arranca y con qué configuración. La de capacitación es una segunda copia del servidor, con el mismo
// código, para que la dueña y el personal practiquen sin tocar datos reales (docs/INSTALACION_LOCAL.md). Se elige
// con un argumento de la línea de comandos, no con una variable de entorno: un .env mal copiado no puede convertir
// el servidor de producción en el de capacitación, ni al revés.

export type Instancia = "PRODUCCION" | "CAPACITACION";

export const ARGUMENTO_CAPACITACION = "--capacitacion";
export const PUERTO_CAPACITACION = 3011;

/** apps/server, a partir de la ubicación de este archivo (no del directorio de trabajo). */
const DIR_SERVIDOR = fileURLToPath(new URL("..", import.meta.url));
/** Base de la instancia de capacitación: ruta fija; ninguna variable de entorno la cambia. */
export const BASE_CAPACITACION = join(DIR_SERVIDOR, "datos", "capacitacion", "apurimeno-capacitacion.db");
const BASE_PRODUCCION_POR_DEFECTO = "file:./datos/apurimeno.db";

export const ESPEJO_DESACTIVADO_EN_CAPACITACION =
  "Instancia de capacitación: el espejo en la nube está desactivado y no se puede activar.";

export function instanciaDe(argumentos: readonly string[]): Instancia {
  return argumentos.includes(ARGUMENTO_CAPACITACION) ? "CAPACITACION" : "PRODUCCION";
}

export interface Arranque {
  instancia: Instancia;
  produccion: boolean;
  databaseUrl: string;
  /** undefined: el servidor genera uno por arranque (las sesiones se invalidan al reiniciar). */
  jwtSecret: string | undefined;
  host: string;
  puerto: number;
  corsOrigins: string | undefined;
  impresoraDispositivo: string | undefined;
  impresoraPaginaCodigos: string | undefined;
  espejo: ConfiguracionEspejo;
  respaldos: ConfiguracionRespaldos;
}

const mismaRuta = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

/**
 * Configuración de arranque de cada instancia.
 *
 * Producción: la de siempre, desde las variables de entorno.
 *
 * Capacitación: de las variables solo toma las que no pueden llevar datos a ningún lado (HOST, CORS_ORIGINS, la
 * impresora y NODE_ENV). Ignora a propósito DATABASE_URL, PORT, JWT_SECRET, ESPEJO_* y RESPALDO_*, aunque estén
 * definidas: base propia en una ruta fija, puerto 3011 (CAPACITACION_PORT lo cambia), secreto propio
 * (CAPACITACION_JWT_SECRET o uno por arranque), sin espejo y con copias solo locales, junto a su base.
 */
export function leerArranque(env: NodeJS.ProcessEnv, instancia: Instancia): Arranque {
  const produccion = env["NODE_ENV"] === "production";
  const comun = {
    instancia,
    produccion,
    host: env["HOST"] || "0.0.0.0",
    corsOrigins: env["CORS_ORIGINS"],
    impresoraDispositivo: env["IMPRESORA_DISPOSITIVO"],
    impresoraPaginaCodigos: env["IMPRESORA_PAGINA_CODIGOS"],
  };

  if (instancia === "PRODUCCION") {
    const databaseUrl = env["DATABASE_URL"] || BASE_PRODUCCION_POR_DEFECTO;
    const rutaBase = rutaDesdeUrl(databaseUrl);
    if (mismaRuta(rutaBase, BASE_CAPACITACION)) {
      throw new Error("DATABASE_URL apunta a la base de capacitación: el servidor de producción no arranca con ella.");
    }
    return {
      ...comun,
      databaseUrl,
      jwtSecret: env["JWT_SECRET"] || undefined,
      puerto: Number(env["PORT"] || 3001),
      espejo: leerConfiguracionEspejo(env),
      respaldos: leerConfiguracionRespaldos(env, rutaBase),
    };
  }

  return {
    ...comun,
    databaseUrl: `file:${BASE_CAPACITACION.replace(/\\/g, "/")}`,
    jwtSecret: env["CAPACITACION_JWT_SECRET"] || undefined,
    puerto: Number(env["CAPACITACION_PORT"] || PUERTO_CAPACITACION),
    // Sin leer ESPEJO_*: el transporte a Supabase nunca se crea en esta instancia.
    espejo: { supabase: null, problema: ESPEJO_DESACTIVADO_EN_CAPACITACION, intervaloMinutos: 30 },
    // Sin leer RESPALDO_*: copias locales junto a la base de capacitación, ninguna externa.
    respaldos: leerConfiguracionRespaldos({}, BASE_CAPACITACION),
  };
}
