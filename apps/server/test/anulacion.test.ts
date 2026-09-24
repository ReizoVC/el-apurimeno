import {
  AnularTicketRespuestaSchema,
  GenerarCodigoAutorizacionRespuestaSchema,
  RUTAS,
  RegistrarHoraAdicionalRespuestaSchema,
  RegistrarIngresoRespuestaSchema,
} from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { efectivo, prepararEntorno, ruta, type Entorno } from "./entorno.js";

let e: Entorno;
let cajero: string;
let admin: string;

beforeEach(async () => {
  e = await prepararEntorno();
  cajero = await e.login("cajero");
  admin = await e.login("admin");
  await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 10000 });
  await e.llamar("POST", RUTAS.abrirTurno, admin, { efectivoInicial: 0 });
});
afterEach(() => e.cerrar());

async function ingreso(clave = "clave-ingreso-a") {
  const r = await e.llamar(
    "POST",
    RUTAS.registrarIngreso,
    cajero,
    { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000, 5000)] },
    clave,
  );
  return RegistrarIngresoRespuestaSchema.parse(r.json());
}

const anular = (token: string, ticketId: string, cuerpo: { motivo: string; codigoAutorizacion: string | null }, clave: string) =>
  e.llamar("POST", ruta(RUTAS.anularTicket, ticketId), token, cuerpo, clave);

async function generarCodigo() {
  const r = await e.llamar("POST", RUTAS.generarCodigoAutorizacion, admin, {});
  expect(r.statusCode).toBe(201);
  return GenerarCodigoAutorizacionRespuestaSchema.parse(r.json());
}

describe("Anulación por un Administrador (RN-36, CU-21)", () => {
  it("anula el ingreso: compensatorio por el inverso, alquiler ANULADO y habitación LIBRE (escenario 31.5)", async () => {
    const { alquiler, ticket } = await ingreso();
    const r = await anular(admin, ticket.id, { motivo: "habitación incorrecta", codigoAutorizacion: null }, "clave-anula-1");
    expect(r.statusCode).toBe(201);
    const { original, compensatorio } = AnularTicketRespuestaSchema.parse(r.json());
    expect(original.estado).toBe("ANULADO");
    expect(compensatorio).toMatchObject({ tipo: "COMPENSATORIO", total: -4000, ticketOriginalId: ticket.id, anulacion: { motivo: "habitación incorrecta" } });
    expect((await e.prisma.alquiler.findUniqueOrThrow({ where: { id: alquiler.id } })).estado).toBe("ANULADO");
    expect((await e.prisma.habitacion.findUniqueOrThrow({ where: { id: "hab-205" } })).estado).toBe("LIBRE");
    expect(await e.prisma.registroAuditoria.findFirst({ where: { accion: "TICKET_ANULADO" } })).toMatchObject({ motivo: "habitación incorrecta" });
  });

  it("no se anula dos veces, ni un compensatorio, ni sin motivo", async () => {
    const { ticket } = await ingreso();
    const { compensatorio } = AnularTicketRespuestaSchema.parse(
      (await anular(admin, ticket.id, { motivo: "error", codigoAutorizacion: null }, "clave-anula-2")).json(),
    );
    expect((await anular(admin, ticket.id, { motivo: "otra vez", codigoAutorizacion: null }, "clave-anula-3")).json()).toMatchObject({
      codigo: "TICKET_ALREADY_VOIDED",
    });
    expect((await anular(admin, compensatorio.id, { motivo: "x", codigoAutorizacion: null }, "clave-anula-4")).json()).toMatchObject({
      codigo: "INVALID_STATE_TRANSITION",
    });
  });

  it("anular el ingreso con una hora adicional vigente exige anular primero la hora (31.5 alternativo)", async () => {
    const { alquiler, ticket } = await ingreso();
    await e.llamar("POST", ruta(RUTAS.registrarHoraAdicional, alquiler.id), cajero, { ajuste: null, pagos: [efectivo(800)] }, "clave-hora-a");
    const r = await anular(admin, ticket.id, { motivo: "error", codigoAutorizacion: null }, "clave-anula-5");
    expect(r.json()).toMatchObject({ codigo: "INVALID_STATE_TRANSITION" });
    expect((await e.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).estado).toBe("EMITIDO");
  });

  it("el ingreso de un alquiler ya cerrado no se anula (el cierre es definitivo, §20.2)", async () => {
    const { alquiler, ticket } = await ingreso();
    await e.llamar("POST", ruta(RUTAS.registrarSalida, alquiler.id), cajero, {});
    expect((await anular(admin, ticket.id, { motivo: "error", codigoAutorizacion: null }, "clave-anula-6")).json()).toMatchObject({
      codigo: "RENTAL_NOT_OPEN",
    });
  });

  it("es idempotente: reintentar con la misma clave no emite otro compensatorio", async () => {
    const { ticket } = await ingreso();
    const cuerpo = { motivo: "error", codigoAutorizacion: null };
    const [a, b] = [await anular(admin, ticket.id, cuerpo, "clave-anula-7"), await anular(admin, ticket.id, cuerpo, "clave-anula-7")];
    expect([a.statusCode, b.statusCode]).toEqual([201, 200]);
    expect(await e.prisma.ticket.count({ where: { tipo: "COMPENSATORIO" } })).toBe(1);
  });
});

describe("Anular una hora adicional recalcula la salida (decisión de domain)", () => {
  it("la salida vuelve a la base más las horas que siguen vigentes", async () => {
    const { alquiler } = await ingreso();
    const url = ruta(RUTAS.registrarHoraAdicional, alquiler.id);
    await e.llamar("POST", url, cajero, { ajuste: null, pagos: [efectivo(800)] }, "clave-hora-1");
    const segunda = RegistrarHoraAdicionalRespuestaSchema.parse(
      (await e.llamar("POST", url, cajero, { ajuste: null, pagos: [efectivo(800)] }, "clave-hora-2")).json(),
    );
    expect(segunda.alquiler.salidaProgramadaEn).toBe("2026-09-24T00:00:00.000Z");

    await anular(admin, segunda.ticket.id, { motivo: "cobró de más", codigoAutorizacion: null }, "clave-anula-hora");
    const recalculado = await e.prisma.alquiler.findUniqueOrThrow({ where: { id: alquiler.id } });
    expect(recalculado.salidaProgramadaEn.toISOString()).toBe("2026-09-23T23:00:00.000Z");
  });
});

describe("RN-46 · un Cajero anula solo con código de autorización", () => {
  it("sin código se rechaza; con el código del Administrador anula y el código queda consumido", async () => {
    const { ticket } = await ingreso();
    expect((await anular(cajero, ticket.id, { motivo: "error", codigoAutorizacion: null }, "clave-caj-1")).json()).toMatchObject({
      codigo: "AUTH_CODE_INVALID",
    });

    const { id, codigo, expiraEn } = await generarCodigo();
    expect(codigo).toMatch(/^\d{6}$/);
    expect(expiraEn).toBe("2026-09-23T14:05:00.000Z");
    const r = await anular(cajero, ticket.id, { motivo: "error", codigoAutorizacion: codigo }, "clave-caj-2");
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ compensatorio: { anulacion: { codigoAutorizacionId: id } } });
    expect(await e.prisma.codigoAutorizacion.findUniqueOrThrow({ where: { id } })).toMatchObject({ usadoPorId: "usuario-cajero", ticketId: ticket.id });
    // Auditoría: qué Administrador generó el código (CU-21).
    const registro = await e.prisma.registroAuditoria.findFirstOrThrow({ where: { accion: "TICKET_ANULADO" } });
    expect(registro.valorNuevo).toMatchObject({ codigoAutorizacionId: id, codigoGeneradoPorId: "usuario-admin" });
  });

  it("el código es de un solo uso y vence", async () => {
    const { codigo } = await generarCodigo();
    const venta1 = await e.llamar("POST", RUTAS.registrarVenta, cajero, venta(), "clave-venta-cod-1");
    const venta2 = await e.llamar("POST", RUTAS.registrarVenta, cajero, venta(), "clave-venta-cod-2");
    const [id1, id2] = [venta1.json<{ id: string }>().id, venta2.json<{ id: string }>().id];

    expect((await anular(cajero, id1, { motivo: "x", codigoAutorizacion: codigo }, "clave-cod-1")).statusCode).toBe(201);
    expect((await anular(cajero, id2, { motivo: "x", codigoAutorizacion: codigo }, "clave-cod-2")).json()).toMatchObject({
      codigo: "AUTH_CODE_INVALID",
    });

    const otro = await generarCodigo();
    e.reloj.avanzarMinutos(6);
    expect((await anular(cajero, id2, { motivo: "x", codigoAutorizacion: otro.codigo }, "clave-cod-3")).json()).toMatchObject({
      codigo: "AUTH_CODE_INVALID",
    });
    expect((await e.prisma.ticket.findUniqueOrThrow({ where: { id: id2 } })).estado).toBe("EMITIDO");
  });

  it("el código no se guarda en claro", async () => {
    const { id, codigo } = await generarCodigo();
    const fila = await e.prisma.codigoAutorizacion.findUniqueOrThrow({ where: { id } });
    expect(fila.codigoHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fila.codigoHash).not.toContain(codigo);
    expect(JSON.stringify(await e.prisma.registroAuditoria.findMany())).not.toContain(codigo);
  });

  it("tras 5 códigos incorrectos se bloquea 15 minutos, aunque el siguiente sea correcto", async () => {
    const { ticket } = await ingreso();
    for (let i = 0; i < 5; i++) {
      await anular(cajero, ticket.id, { motivo: "x", codigoAutorizacion: "000000" }, `clave-fb-${i}`);
    }
    const { codigo } = await generarCodigo();
    const bloqueado = await anular(cajero, ticket.id, { motivo: "x", codigoAutorizacion: codigo }, "clave-fb-5");
    expect(bloqueado.json()).toMatchObject({ codigo: "AUTH_CODE_INVALID" });
    expect(await e.prisma.registroAuditoria.count({ where: { accion: "ACCESO_DENEGADO", tipoEntidad: "CODIGO_AUTORIZACION" } })).toBe(6);

    e.reloj.avanzarMinutos(16);
    const nuevo = await generarCodigo();
    expect((await anular(cajero, ticket.id, { motivo: "x", codigoAutorizacion: nuevo.codigo }, "clave-fb-6")).statusCode).toBe(201);
  });

  it("Limpieza no puede entrar a anular ni con código", async () => {
    const { ticket } = await ingreso();
    const { codigo } = await generarCodigo();
    const limpieza = await e.login("limpieza");
    expect((await anular(limpieza, ticket.id, { motivo: "x", codigoAutorizacion: codigo }, "clave-limp-1")).statusCode).toBe(403);
  });

  it("solo quien tiene tickets.void genera códigos", async () => {
    expect((await e.llamar("POST", RUTAS.generarCodigoAutorizacion, cajero, {})).statusCode).toBe(403);
  });
});

function venta() {
  return {
    items: [{ productoId: "prod-agua", cantidad: 1 }],
    esHuesped: false,
    habitacionReferenciaId: null,
    ajuste: null,
    pagos: [efectivo(200)],
  };
}

describe("Anular una venta restituye el stock (RF-30)", () => {
  it("el stock vuelve y queda un movimiento ANULACION_VENTA con el compensatorio", async () => {
    const r = await e.llamar("POST", RUTAS.registrarVenta, cajero, venta(), "clave-venta-stock");
    expect(r.statusCode).toBe(201);
    expect((await e.prisma.producto.findUniqueOrThrow({ where: { id: "prod-agua" } })).stock).toBe(4);

    const { compensatorio } = AnularTicketRespuestaSchema.parse(
      (await anular(admin, r.json<{ id: string }>().id, { motivo: "cliente devolvió", codigoAutorizacion: null }, "clave-anula-venta")).json(),
    );
    expect((await e.prisma.producto.findUniqueOrThrow({ where: { id: "prod-agua" } })).stock).toBe(5);
    expect(await e.prisma.movimientoInventario.findFirst({ where: { tipo: "ANULACION_VENTA" } })).toMatchObject({
      cantidad: 1,
      ticketId: compensatorio.id,
    });
  });
});

beforeEach(async () => {
  await e.prisma.categoriaProducto.create({ data: { id: "cat-bebidas", nombre: "Bebidas" } });
  await e.prisma.producto.create({
    data: { id: "prod-agua", categoriaId: "cat-bebidas", nombre: "Agua", codigoBarras: null, precioHuesped: 150, precioPublico: 200, controlaStock: true, stock: 5, activo: true },
  });
});
