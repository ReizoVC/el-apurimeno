import type { FilaResumenDia } from "@apurimeno/contracts";
import { describe, expect, it } from "vitest";
import { leerConfiguracionEspejo } from "../src/espejo/configuracion.js";
import { FILAS_POR_SOLICITUD, transporteSupabase } from "../src/espejo/supabase.js";
import { ErrorEspejo, type LoteEspejo } from "../src/espejo/transporte.js";

const URL_PROYECTO = "https://proyecto.supabase.co";
const CLAVE = "sb_publishable_prueba";

interface Solicitud {
  url: string;
  metodo: string;
  cabeceras: Record<string, string>;
  cuerpo: unknown;
}

/** Supabase simulado: responde según la ruta y guarda cada solicitud. */
function supabaseFalso(responder: (s: Solicitud, n: number) => Response | Promise<Response>) {
  const solicitudes: Solicitud[] = [];
  const fetchFalso = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const s: Solicitud = {
      url: String(entrada),
      metodo: init?.method ?? "GET",
      cabeceras: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      cuerpo: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    solicitudes.push(s);
    return responder(s, solicitudes.length);
  }) as typeof fetch;
  return { solicitudes, fetchFalso };
}

const json = (estado: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "content-type": "application/json" } });
const sesion = (token = "token-1") => json(200, { access_token: token, expires_in: 3600, token_type: "bearer" });

function dia(n: number): FilaResumenDia {
  return {
    dia: `2026-01-${String((n % 28) + 1).padStart(2, "0")}`,
    total_ventas: n,
    cantidad_cobros: 1,
    anulados_cantidad: 0,
    anulados_total: 0,
    alquileres: 0,
    horas_vendidas: 0,
    detalle: { porOrigen: [], porMetodoPago: [], ocupacion: [] },
    version: 1,
    actualizado_en: "2026-09-25T14:00:00.000Z",
  };
}

const lote = (dias: FilaResumenDia[] = [dia(1)]): LoteEspejo => ({
  dias,
  turnos: [],
  estado: { id: true, ultima_sincronizacion: "2026-09-25T14:00:00.000Z", intervalo_minutos: 30, version_servidor: "0.1.0" },
});

function transporte(fetchFalso: typeof fetch, ahora = () => new Date("2026-09-25T14:00:00.000Z")) {
  return transporteSupabase({ url: `${URL_PROYECTO}/`, clavePublica: CLAVE, correo: "sync@ejemplo.pe", contrasena: "secreta", fetch: fetchFalso, ahora });
}

describe("Transporte a Supabase", () => {
  it("inicia sesión con la cuenta sincronizador y hace upsert por clave primaria, con la clave publicable", async () => {
    const { solicitudes, fetchFalso } = supabaseFalso((s) => (s.url.includes("/auth/") ? sesion() : new Response(null, { status: 201 })));
    await transporte(fetchFalso).publicar(lote());

    expect(solicitudes.map((s) => `${s.metodo} ${s.url}`)).toEqual([
      `POST ${URL_PROYECTO}/auth/v1/token?grant_type=password`,
      `POST ${URL_PROYECTO}/rest/v1/resumen_dia?on_conflict=dia`,
      // Sin turnos en el lote, resumen_turno no se toca; el estado va siempre, al final.
      `POST ${URL_PROYECTO}/rest/v1/estado_espejo?on_conflict=id`,
    ]);
    expect(solicitudes[0]?.cuerpo).toEqual({ email: "sync@ejemplo.pe", password: "secreta" });
    expect(solicitudes[0]?.cabeceras).toMatchObject({ apikey: CLAVE });
    expect(solicitudes[1]?.cabeceras).toMatchObject({
      apikey: CLAVE,
      authorization: "Bearer token-1",
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    expect(solicitudes[2]?.cuerpo).toEqual([lote().estado]);
  });

  it("reutiliza el token mientras vale, y lo renueva antes de que venza", async () => {
    let ahora = new Date("2026-09-25T14:00:00.000Z");
    const { solicitudes, fetchFalso } = supabaseFalso((s, n) => (s.url.includes("/auth/") ? sesion(`token-${n}`) : new Response(null, { status: 201 })));
    const t = transporte(fetchFalso, () => ahora);
    await t.publicar(lote());
    await t.publicar(lote());
    expect(solicitudes.filter((s) => s.url.includes("/auth/"))).toHaveLength(1);
    ahora = new Date(ahora.getTime() + 3600_000 - 30_000);
    await t.publicar(lote());
    expect(solicitudes.filter((s) => s.url.includes("/auth/"))).toHaveLength(2);
  });

  it("si el token fue rechazado (401), inicia sesión de nuevo y reintenta una vez", async () => {
    let rechazos = 0;
    const { solicitudes, fetchFalso } = supabaseFalso((s) => {
      if (s.url.includes("/auth/")) return sesion();
      if (s.url.includes("resumen_dia") && rechazos++ === 0) return json(401, { message: "JWT expired" });
      return new Response(null, { status: 201 });
    });
    await transporte(fetchFalso).publicar(lote());
    expect(solicitudes.filter((s) => s.url.includes("/auth/"))).toHaveLength(2);
    expect(solicitudes.filter((s) => s.url.includes("resumen_dia"))).toHaveLength(2);
  });

  it(`un historial largo va en lotes de ${FILAS_POR_SOLICITUD} filas`, async () => {
    const { solicitudes, fetchFalso } = supabaseFalso((s) => (s.url.includes("/auth/") ? sesion() : new Response(null, { status: 201 })));
    await transporte(fetchFalso).publicar(lote(Array.from({ length: 450 }, (_, i) => dia(i))));
    expect(solicitudes.filter((s) => s.url.includes("resumen_dia")).map((s) => (s.cuerpo as unknown[]).length)).toEqual([200, 200, 50]);
  });

  const falla = async (responder: Parameters<typeof supabaseFalso>[0]) => {
    const { fetchFalso } = supabaseFalso(responder);
    try {
      await transporte(fetchFalso).publicar(lote());
    } catch (error) {
      if (error instanceof ErrorEspejo) return error;
      throw error;
    }
    throw new Error("Se esperaba una falla.");
  };

  it("sin internet es SIN_CONEXION", async () => {
    const error = await falla(() => {
      throw new TypeError("fetch failed");
    });
    expect(error).toMatchObject({ codigo: "SIN_CONEXION" });
  });

  it("una contraseña rechazada es CREDENCIALES_RECHAZADAS, con el motivo de Supabase", async () => {
    const error = await falla(() => json(400, { error: "invalid_grant", error_description: "Invalid login credentials" }));
    expect(error).toMatchObject({ codigo: "CREDENCIALES_RECHAZADAS" });
    expect(error.message).toContain("Invalid login credentials");
  });

  it("si faltan las tablas, dice que se apliquen las migraciones de Supabase", async () => {
    const error = await falla((s) => (s.url.includes("/auth/") ? sesion() : json(404, { code: "PGRST205", message: "Could not find the table" })));
    expect(error).toMatchObject({ codigo: "RECHAZADO_POR_EL_ESPEJO" });
    expect(error.message).toContain("supabase/migrations");
  });

  it("si la cuenta no está autorizada (RLS), dice dónde darla de alta", async () => {
    const error = await falla((s) =>
      s.url.includes("/auth/") ? sesion() : json(403, { code: "42501", message: "new row violates row-level security policy" }),
    );
    expect(error).toMatchObject({ codigo: "RECHAZADO_POR_EL_ESPEJO" });
    expect(error.message).toContain("privado.acceso_espejo");
  });
});

describe("Configuración del espejo por variables de entorno", () => {
  const completa = {
    ESPEJO_SUPABASE_URL: "https://proyecto.supabase.co/",
    ESPEJO_SUPABASE_ANON_KEY: CLAVE,
    ESPEJO_SYNC_EMAIL: "sync@ejemplo.pe",
    ESPEJO_SYNC_PASSWORD: "secreta",
  };

  it("sin variables, no hay espejo ni problema: el servidor funciona igual", () => {
    expect(leerConfiguracionEspejo({})).toEqual({ supabase: null, problema: null, intervaloMinutos: 30 });
  });

  it("completa, usa el origen de la URL y 30 minutos por defecto", () => {
    expect(leerConfiguracionEspejo(completa)).toEqual({
      supabase: { url: "https://proyecto.supabase.co", clavePublica: CLAVE, correo: "sync@ejemplo.pe", contrasena: "secreta" },
      problema: null,
      intervaloMinutos: 30,
    });
    expect(leerConfiguracionEspejo({ ...completa, ESPEJO_INTERVALO_MINUTOS: "15" }).intervaloMinutos).toBe(15);
  });

  it("a medias, dice qué variables faltan", () => {
    const r = leerConfiguracionEspejo({ ESPEJO_SUPABASE_URL: completa.ESPEJO_SUPABASE_URL, ESPEJO_SYNC_EMAIL: "x@y.pe" });
    expect(r.supabase).toBeNull();
    expect(r.problema).toBe("Faltan variables del espejo: ESPEJO_SUPABASE_ANON_KEY, ESPEJO_SYNC_PASSWORD.");
  });

  it("rechaza la clave secreta y la service_role heredada: darían acceso total al proyecto", () => {
    expect(leerConfiguracionEspejo({ ...completa, ESPEJO_SUPABASE_ANON_KEY: "sb_secret_abc" }).problema).toContain("clave secreta");
    const carga = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    expect(leerConfiguracionEspejo({ ...completa, ESPEJO_SUPABASE_ANON_KEY: `eyJhbGciOiJIUzI1NiJ9.${carga}.firma` }).supabase).toBeNull();
    const anon = Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url");
    expect(leerConfiguracionEspejo({ ...completa, ESPEJO_SUPABASE_ANON_KEY: `eyJhbGciOiJIUzI1NiJ9.${anon}.firma` }).supabase).not.toBeNull();
  });

  it("exige https (salvo localhost) y un intervalo de 5 a 1440 minutos", () => {
    expect(leerConfiguracionEspejo({ ...completa, ESPEJO_SUPABASE_URL: "http://proyecto.supabase.co" }).problema).toContain("https");
    expect(leerConfiguracionEspejo({ ...completa, ESPEJO_SUPABASE_URL: "http://localhost:54321" }).supabase).not.toBeNull();
    expect(leerConfiguracionEspejo({ ...completa, ESPEJO_INTERVALO_MINUTOS: "2" }).problema).toContain("entre 5 y 1440");
    expect(leerConfiguracionEspejo({ ...completa, ESPEJO_INTERVALO_MINUTOS: "media hora" }).supabase).toBeNull();
  });
});
