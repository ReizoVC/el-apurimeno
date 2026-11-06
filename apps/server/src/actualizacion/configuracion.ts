import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { VersionSistemaSchema } from "@apurimeno/contracts";
import { ErrorClave } from "../respaldo/cifrado.js";
import { leerClavePublicaVersion } from "./firma.js";

export interface ConfiguracionActualizacion {
  /** null: no se revisa nada. */
  clavePublica: KeyObject | null;
  versionInstalada: string | null;
  problema: string | null;
}

export const ACTUALIZACION_APAGADA: ConfiguracionActualizacion = { clavePublica: null, versionInstalada: null, problema: null };

/** La versión instalada es la del checkout: en el local, solo avanza a etiquetas publicadas. */
function leerVersionInstalada(): string | null {
  try {
    const conf = JSON.parse(readFileSync(new URL("../../../native/src-tauri/tauri.conf.json", import.meta.url), "utf8")) as { version?: unknown };
    return VersionSistemaSchema.parse(conf.version);
  } catch {
    return null;
  }
}

export function leerConfiguracionActualizacion(env: NodeJS.ProcessEnv): ConfiguracionActualizacion {
  const texto = env["ACTUALIZACION_CLAVE_PUBLICA"]?.trim();
  if (!texto) return ACTUALIZACION_APAGADA;
  const versionInstalada = leerVersionInstalada();
  if (versionInstalada === null) {
    return { clavePublica: null, versionInstalada: null, problema: "No se pudo leer la versión instalada de apps/native/src-tauri/tauri.conf.json." };
  }
  try {
    return { clavePublica: leerClavePublicaVersion(texto), versionInstalada, problema: null };
  } catch (error) {
    if (!(error instanceof ErrorClave)) throw error;
    return { clavePublica: null, versionInstalada, problema: `ACTUALIZACION_CLAVE_PUBLICA: ${error.message}` };
  }
}
