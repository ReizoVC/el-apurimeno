import type { OpcionesSupabase } from "./supabase.js";

export const INTERVALO_POR_DEFECTO_MINUTOS = 30;
export const INTERVALO_MINIMO_MINUTOS = 5;
export const INTERVALO_MAXIMO_MINUTOS = 24 * 60;

const VARIABLES = {
  url: "ESPEJO_SUPABASE_URL",
  clavePublica: "ESPEJO_SUPABASE_ANON_KEY",
  correo: "ESPEJO_SYNC_EMAIL",
  contrasena: "ESPEJO_SYNC_PASSWORD",
} as const;

export interface ConfiguracionEspejo {
  /** null si el espejo no está configurado (o está mal configurado): el servidor funciona igual, sin espejo. */
  supabase: Omit<OpcionesSupabase, "fetch" | "ahora"> | null;
  /** Qué está mal, para mostrarlo en el Dashboard; null si todo está bien o si no se configuró nada. */
  problema: string | null;
  intervaloMinutos: number;
}

/** ¿Es una clave que da acceso total al proyecto? La secreta nueva o la service_role heredada (un JWT). */
function esClavePrivilegiada(clave: string): boolean {
  if (clave.startsWith("sb_secret_")) return true;
  const partes = clave.split(".");
  if (partes.length !== 3 || partes[1] === undefined) return false;
  try {
    const carga = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8")) as { role?: unknown };
    return carga.role === "service_role";
  } catch {
    return false;
  }
}

/**
 * Lee la configuración del espejo del entorno. Nunca impide que el servidor arranque: un error de configuración
 * deja el espejo apagado y se informa en el registro y en el Dashboard (RNF-SYNC-02).
 */
export function leerConfiguracionEspejo(env: NodeJS.ProcessEnv): ConfiguracionEspejo {
  const texto = (nombre: string) => env[nombre]?.trim() ?? "";
  const sinEspejo = (problema: string | null, intervaloMinutos = INTERVALO_POR_DEFECTO_MINUTOS): ConfiguracionEspejo => ({
    supabase: null,
    problema,
    intervaloMinutos,
  });

  const intervaloTexto = texto("ESPEJO_INTERVALO_MINUTOS");
  const intervalo = intervaloTexto === "" ? INTERVALO_POR_DEFECTO_MINUTOS : Number(intervaloTexto);
  if (!Number.isInteger(intervalo) || intervalo < INTERVALO_MINIMO_MINUTOS || intervalo > INTERVALO_MAXIMO_MINUTOS) {
    return sinEspejo(
      `ESPEJO_INTERVALO_MINUTOS debe ser un entero entre ${INTERVALO_MINIMO_MINUTOS} y ${INTERVALO_MAXIMO_MINUTOS}: "${intervaloTexto}".`,
    );
  }

  const valores = Object.fromEntries(Object.entries(VARIABLES).map(([campo, nombre]) => [campo, texto(nombre)])) as Record<
    keyof typeof VARIABLES,
    string
  >;
  const faltan = Object.entries(VARIABLES)
    .filter(([campo]) => valores[campo as keyof typeof VARIABLES] === "")
    .map(([, nombre]) => nombre);
  if (faltan.length === Object.keys(VARIABLES).length) return sinEspejo(null, intervalo);
  if (faltan.length > 0) return sinEspejo(`Faltan variables del espejo: ${faltan.join(", ")}.`, intervalo);

  let url: URL;
  try {
    url = new URL(valores.url);
  } catch {
    return sinEspejo(`ESPEJO_SUPABASE_URL no es una URL válida: "${valores.url}".`, intervalo);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    return sinEspejo("ESPEJO_SUPABASE_URL debe usar https: la contraseña de sincronización viaja en la solicitud.", intervalo);
  }
  if (esClavePrivilegiada(valores.clavePublica)) {
    return sinEspejo(
      "ESPEJO_SUPABASE_ANON_KEY es una clave secreta (acceso total al proyecto): use la clave publicable. " +
        "La sincronización entra con la cuenta sincronizador, que solo puede escribir el resumen.",
      intervalo,
    );
  }
  return { supabase: { ...valores, url: url.origin }, problema: null, intervaloMinutos: intervalo };
}
