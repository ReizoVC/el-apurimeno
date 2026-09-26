import { GenerarCodigoAutorizacionRespuestaSchema, RUTAS, TurnoSchema } from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepararEntorno, type Entorno } from "./entorno.js";

// Decisión 25: el aviso "no coincide" del arqueo ciego (RN-34) no debe servir para adivinar el esperado probando
// montos. Cada intento queda en la auditoría con lo contado y, tras 3 rechazos, cada intento consume un código.

let e: Entorno;
let cajero: string;
let admin: string;

beforeEach(async () => {
  e = await prepararEntorno("2026-09-26T15:00:00.000Z");
  cajero = await e.login("cajero");
  admin = await e.login("admin");
  // Sin cobros: el esperado es el efectivo inicial, S/ 100.00.
  expect((await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 10000 })).statusCode).toBe(201);
});
afterEach(() => e.cerrar());

const cerrar = (efectivoContado: number, codigoAutorizacion?: string | null) =>
  e.llamar("POST", RUTAS.cerrarTurno, cajero, {
    efectivoContado,
    comentario: null,
    ...(codigoAutorizacion === undefined ? {} : { codigoAutorizacion }),
  });

async function codigo(operacion?: "ANULAR_TICKET" | "REINTENTAR_CIERRE_TURNO"): Promise<string> {
  const r = await e.llamar("POST", RUTAS.generarCodigoAutorizacion, admin, operacion === undefined ? undefined : { operacion });
  expect(r.statusCode).toBe(201);
  return GenerarCodigoAutorizacionRespuestaSchema.parse(r.json()).codigo;
}

const auditoria = (accion: "CIERRE_TURNO_RECHAZADO" | "TURNO_CERRADO" | "ACCESO_DENEGADO") =>
  e.prisma.registroAuditoria.findMany({ where: { accion }, orderBy: { ocurridoEn: "asc" } });

async function rechazar(veces: number, desde = 9000) {
  for (let i = 0; i < veces; i++) {
    e.reloj.avanzarMinutos(1);
    const r = await cerrar(desde + i * 100);
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: "REASON_REQUIRED" });
  }
}

describe("Cada intento de cierre queda en la auditoría con el monto contado", () => {
  it("los rechazados como CIERRE_TURNO_RECHAZADO y el aceptado como TURNO_CERRADO, con la hora", async () => {
    await rechazar(2);
    e.reloj.avanzarMinutos(1);
    const cierre = await cerrar(10000);
    expect(cierre.statusCode).toBe(200);
    expect(TurnoSchema.parse(cierre.json())).toMatchObject({ estado: "CERRADO", diferencia: 0 });

    const rechazos = await auditoria("CIERRE_TURNO_RECHAZADO");
    expect(rechazos.map((r) => [r.ocurridoEn.toISOString(), r.valorNuevo])).toEqual([
      ["2026-09-26T15:01:00.000Z", { efectivoContado: 9000, intento: 1, codigoAutorizacionId: null }],
      ["2026-09-26T15:02:00.000Z", { efectivoContado: 9100, intento: 2, codigoAutorizacionId: null }],
    ]);
    expect(rechazos.every((r) => r.usuarioId === "usuario-cajero" && r.tipoEntidad === "TURNO")).toBe(true);
    const [cerrado] = await auditoria("TURNO_CERRADO");
    expect(cerrado?.ocurridoEn.toISOString()).toBe("2026-09-26T15:03:00.000Z");
    expect(cerrado?.valorNuevo).toMatchObject({ efectivoContado: 10000, cierresRechazados: 2, codigoAutorizacionId: null });
  });

  it("el rechazo dice que no coincide, nunca por cuánto", async () => {
    const r = await cerrar(9000);
    expect(JSON.stringify(r.json())).not.toMatch(/100|10000|9000|falta|sobra/i);
  });
});

describe("Tras 3 rechazos, cada intento necesita un código de un Administrador", () => {
  it("sin código se deniega y queda registrado con lo contado; el cuarto rechazo lo anuncia", async () => {
    await rechazar(2);
    e.reloj.avanzarMinutos(1);
    const tercero = await cerrar(9900);
    expect(tercero.json().mensaje).toMatch(/cada intento necesita un código/);

    e.reloj.avanzarMinutos(1);
    const sinCodigo = await cerrar(10000);
    expect(sinCodigo.statusCode).toBe(422);
    expect(sinCodigo.json()).toMatchObject({ codigo: "AUTH_CODE_INVALID" });
    expect(sinCodigo.json().mensaje).toMatch(/3 intentos/);
    // Aunque el monto era el correcto: sin código no se cierra.
    expect((await e.prisma.turno.findFirstOrThrow()).estado).toBe("ABIERTO");
    const [denegado] = await auditoria("ACCESO_DENEGADO");
    expect(denegado?.valorNuevo).toMatchObject({ operacion: "REINTENTAR_CIERRE_TURNO", efectivoContado: 10000 });
  });

  it("un código de anulación no sirve; el de reintento sí, y se consume aunque el intento se rechace", async () => {
    await rechazar(3);
    const deAnulacion = await codigo();
    expect((await cerrar(10000, deAnulacion)).json()).toMatchObject({ codigo: "AUTH_CODE_INVALID" });

    const primero = await codigo("REINTENTAR_CIERRE_TURNO");
    e.reloj.avanzarMinutos(1);
    const rechazado = await cerrar(9500, primero);
    expect(rechazado.json()).toMatchObject({ codigo: "REASON_REQUIRED" });
    const turnoId = (await e.prisma.turno.findFirstOrThrow()).id;
    const usado = await e.prisma.codigoAutorizacion.findFirstOrThrow({ where: { operacion: "REINTENTAR_CIERRE_TURNO" } });
    expect(usado).toMatchObject({ usadoPorId: "usuario-cajero", turnoId, ticketId: null });
    expect(usado.usadoEn).not.toBeNull();
    const cuarto = (await auditoria("CIERRE_TURNO_RECHAZADO")).at(-1);
    expect(cuarto?.valorNuevo).toEqual({ efectivoContado: 9500, intento: 4, codigoAutorizacionId: usado.id });

    // El mismo código no sirve dos veces.
    expect((await cerrar(10000, primero)).json()).toMatchObject({ codigo: "AUTH_CODE_INVALID" });

    const segundo = await codigo("REINTENTAR_CIERRE_TURNO");
    const cierre = await cerrar(10000, segundo);
    expect(cierre.statusCode).toBe(200);
    const [cerrado] = await auditoria("TURNO_CERRADO");
    expect(cerrado?.valorNuevo).toMatchObject({ efectivoContado: 10000, cierresRechazados: 4 });
    expect((cerrado?.valorNuevo as { codigoAutorizacionId: string }).codigoAutorizacionId).not.toBe(usado.id);
  });

  it("5 intentos sin código válido en 15 minutos bloquean aunque después llegue uno bueno", async () => {
    await rechazar(3);
    for (let i = 0; i < 5; i++) expect((await cerrar(10000, "000000")).json()).toMatchObject({ codigo: "AUTH_CODE_INVALID" });
    const bueno = await codigo("REINTENTAR_CIERRE_TURNO");
    const r = await cerrar(10000, bueno);
    expect(r.json()).toMatchObject({ codigo: "AUTH_CODE_INVALID", mensaje: expect.stringMatching(/espere 15 minutos/) });
    expect((await e.prisma.codigoAutorizacion.findFirstOrThrow({ where: { operacion: "REINTENTAR_CIERRE_TURNO" } })).usadoEn).toBeNull();
    e.reloj.avanzarMinutos(16);
    expect((await cerrar(10000, bueno)).statusCode).toBe(422); // venció: la vigencia es de 5 minutos
    expect((await cerrar(10000, await codigo("REINTENTAR_CIERRE_TURNO"))).statusCode).toBe(200);
  });
});

describe("Generar códigos para cada operación", () => {
  it("sin cuerpo sigue siendo para anular; se puede pedir uno de reintento de cierre", async () => {
    const r = await e.llamar("POST", RUTAS.generarCodigoAutorizacion, admin);
    expect(GenerarCodigoAutorizacionRespuestaSchema.parse(r.json()).operacion).toBe("ANULAR_TICKET");
    const r2 = await e.llamar("POST", RUTAS.generarCodigoAutorizacion, admin, { operacion: "REINTENTAR_CIERRE_TURNO" });
    expect(GenerarCodigoAutorizacionRespuestaSchema.parse(r2.json()).operacion).toBe("REINTENTAR_CIERRE_TURNO");
    expect((await e.llamar("POST", RUTAS.generarCodigoAutorizacion, admin, { operacion: "OTRA" })).statusCode).toBe(400);
  });

  it("el cajero no genera códigos", async () => {
    expect((await e.llamar("POST", RUTAS.generarCodigoAutorizacion, cajero, { operacion: "REINTENTAR_CIERRE_TURNO" })).statusCode).toBe(403);
  });
});
