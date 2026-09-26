import { ErrorEspejo, type LoteEspejo, type TransporteEspejo } from "./transporte.js";

export interface OpcionesSupabase {
  /** URL del proyecto, p. ej. https://xxxx.supabase.co */
  url: string;
  /** Clave publicable (sb_publishable_…) o la anon heredada. Nunca la secreta ni la service_role. */
  clavePublica: string;
  /** Cuenta de Supabase Auth con rol `sincronizador` en privado.acceso_espejo. */
  correo: string;
  contrasena: string;
  /** Inyectable para las pruebas. */
  fetch?: typeof fetch;
  ahora?: () => Date;
  /** Tiempo máximo de cada solicitud. */
  tiempoMaximoMs?: number;
}

/** Filas por solicitud: un historial completo de años se envía en varios lotes, no en uno enorme. */
export const FILAS_POR_SOLICITUD = 200;

/** El token se renueva un minuto antes de vencer, para no usarlo justo cuando caduca. */
const MARGEN_TOKEN_MS = 60_000;

const detalle = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Publica el resumen en Supabase por su API REST, con la sesión de la cuenta `sincronizador`. Las políticas de
 * row-level security solo le permiten insertar y actualizar las tablas del resumen: aunque estas credenciales se
 * filtraran desde el equipo del local, no darían acceso al resto del proyecto (a diferencia de la clave secreta).
 */
export function transporteSupabase(opciones: OpcionesSupabase): TransporteEspejo {
  const base = opciones.url.replace(/\/+$/, "");
  const solicitarFetch = opciones.fetch ?? fetch;
  const ahora = opciones.ahora ?? (() => new Date());
  const tiempoMaximoMs = opciones.tiempoMaximoMs ?? 20_000;
  let sesion: { token: string; venceEn: number } | null = null;

  async function solicitar(url: string, init: RequestInit): Promise<Response> {
    try {
      return await solicitarFetch(url, { ...init, signal: AbortSignal.timeout(tiempoMaximoMs) });
    } catch (error) {
      throw new ErrorEspejo("SIN_CONEXION", `No se pudo conectar con el espejo (${base}): ${detalle(error)}`);
    }
  }

  async function leerError(respuesta: Response): Promise<{ code?: string; message?: string; msg?: string; error_description?: string }> {
    try {
      return (await respuesta.json()) as { code?: string; message?: string };
    } catch {
      return {};
    }
  }

  async function token(): Promise<string> {
    if (sesion !== null && sesion.venceEn - MARGEN_TOKEN_MS > ahora().getTime()) return sesion.token;
    const respuesta = await solicitar(`${base}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: opciones.clavePublica, "content-type": "application/json" },
      body: JSON.stringify({ email: opciones.correo, password: opciones.contrasena }),
    });
    if (!respuesta.ok) {
      const cuerpo = await leerError(respuesta);
      const motivo = cuerpo.error_description ?? cuerpo.msg ?? cuerpo.message ?? `HTTP ${respuesta.status}`;
      if (respuesta.status === 400 || respuesta.status === 401 || respuesta.status === 422) {
        throw new ErrorEspejo("CREDENCIALES_RECHAZADAS", `Supabase rechazó la cuenta de sincronización ${opciones.correo}: ${motivo}`);
      }
      throw new ErrorEspejo("RECHAZADO_POR_EL_ESPEJO", `Supabase no inició la sesión de sincronización: ${motivo}`);
    }
    const cuerpo = (await respuesta.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof cuerpo.access_token !== "string" || typeof cuerpo.expires_in !== "number") {
      throw new ErrorEspejo("RECHAZADO_POR_EL_ESPEJO", "Supabase respondió al inicio de sesión sin un token válido.");
    }
    sesion = { token: cuerpo.access_token, venceEn: ahora().getTime() + cuerpo.expires_in * 1000 };
    return sesion.token;
  }

  async function explicar(tabla: string, respuesta: Response): Promise<ErrorEspejo> {
    const cuerpo = await leerError(respuesta);
    if (cuerpo.code === "PGRST205" || cuerpo.code === "42P01") {
      return new ErrorEspejo("RECHAZADO_POR_EL_ESPEJO", `Falta la tabla ${tabla} en Supabase: aplique supabase/migrations.`);
    }
    if (cuerpo.code === "42501" || respuesta.status === 403) {
      return new ErrorEspejo(
        "RECHAZADO_POR_EL_ESPEJO",
        `La cuenta ${opciones.correo} no puede escribir ${tabla}: debe estar en privado.acceso_espejo con rol sincronizador y activa.`,
      );
    }
    return new ErrorEspejo(
      "RECHAZADO_POR_EL_ESPEJO",
      `Supabase respondió ${respuesta.status} al escribir ${tabla}: ${cuerpo.message ?? "sin detalle"}`,
    );
  }

  /** Inserta o reemplaza filas por su clave primaria (upsert). */
  async function guardar(tabla: string, clave: string, filas: readonly object[]): Promise<void> {
    for (let i = 0; i < filas.length; i += FILAS_POR_SOLICITUD) {
      const lote = JSON.stringify(filas.slice(i, i + FILAS_POR_SOLICITUD));
      const enviar = async () =>
        solicitar(`${base}/rest/v1/${tabla}?on_conflict=${clave}`, {
          method: "POST",
          headers: {
            apikey: opciones.clavePublica,
            authorization: `Bearer ${await token()}`,
            "content-type": "application/json",
            prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: lote,
        });
      let respuesta = await enviar();
      if (respuesta.status === 401) {
        // Token revocado o vencido antes de lo previsto: una sesión nueva y un reintento.
        sesion = null;
        respuesta = await enviar();
      }
      if (!respuesta.ok) throw await explicar(tabla, respuesta);
    }
  }

  return {
    descripcion: `Supabase ${base}`,
    async publicar(lote: LoteEspejo) {
      await guardar("resumen_dia", "dia", lote.dias);
      await guardar("resumen_turno", "turno_id", lote.turnos);
      await guardar("estado_espejo", "id", [lote.estado]);
    },
  };
}
