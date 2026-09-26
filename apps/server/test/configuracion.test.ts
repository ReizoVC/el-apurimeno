import {
  ConfiguracionGlobalSchema,
  MetodoPagoSchema,
  RUTAS,
  RegistrarIngresoRespuestaSchema,
  ReimpresionRespuestaSchema,
  type ConfiguracionGlobal,
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
});
afterEach(() => e.cerrar());

const ingreso = async (habitacionId: string, clave: string, pagos: unknown[] = [efectivo(4000)]) =>
  e.llamar("POST", RUTAS.registrarIngreso, cajero, { habitacionId, clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos }, clave);

describe("Configuración global (CU-27; RN-43, RF-50 a RF-52)", () => {
  it("un cambio de horas base rige para los alquileres siguientes; el abierto conserva los suyos", async () => {
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 });
    const antes = RegistrarIngresoRespuestaSchema.parse((await ingreso("hab-205", "clave-conf-1")).json()).alquiler;

    const actual = ConfiguracionGlobalSchema.parse((await e.llamar("GET", RUTAS.configuracion, admin)).json());
    const nueva: ConfiguracionGlobal = { ...actual, parametrosAlquiler: { ...actual.parametrosAlquiler, horasBase: 6 } };
    const r = await e.llamar("PUT", RUTAS.configuracion, admin, nueva);
    expect(ConfiguracionGlobalSchema.parse(r.json()).parametrosAlquiler.horasBase).toBe(6);

    const despues = RegistrarIngresoRespuestaSchema.parse((await ingreso("hab-105", "clave-conf-2")).json()).alquiler;
    const horas = (a: typeof antes) => (Date.parse(a.salidaProgramadaEn) - Date.parse(a.ingresoEn)) / 3_600_000;
    expect([horas(antes), horas(despues)]).toEqual([8, 6]);
    expect((await e.prisma.alquiler.findUniqueOrThrow({ where: { id: antes.id } })).salidaProgramadaEn.toISOString()).toBe(antes.salidaProgramadaEn);

    expect(await e.prisma.registroAuditoria.findFirst({ where: { accion: "CONFIGURACION_CAMBIADA", tipoEntidad: "CONFIGURACION" } })).toMatchObject({
      valorPrevio: expect.objectContaining({ parametrosAlquiler: expect.objectContaining({ horasBase: 8 }) }),
      valorNuevo: expect.objectContaining({ parametrosAlquiler: expect.objectContaining({ horasBase: 6 }) }),
    });
  });

  it("el comprobante no admite terminología fiscal (RN-39, RF-52); solo settings.manage configura", async () => {
    const actual = ConfiguracionGlobalSchema.parse((await e.llamar("GET", RUTAS.configuracion, admin)).json());
    const conBoleta = { ...actual, comprobante: { ...actual.comprobante, datosAdicionales: "Boleta de venta electrónica" } };
    expect((await e.llamar("PUT", RUTAS.configuracion, admin, conBoleta)).json()).toMatchObject({ codigo: "VALIDACION" });
    expect((await e.llamar("GET", RUTAS.configuracion, cajero)).statusCode).toBe(403);
    expect((await e.llamar("PUT", RUTAS.configuracion, cajero, actual)).statusCode).toBe(403);
  });
});

describe("Leyenda del comprobante (RN-39, decisión 21)", () => {
  it("se edita desde la configuración y la siguiente impresión ya la usa; vacía o con términos fiscales, no", async () => {
    const actual = ConfiguracionGlobalSchema.parse((await e.llamar("GET", RUTAS.configuracion, admin)).json());
    expect(actual.comprobante).toEqual({
      nombreNegocio: "El Apurimeño",
      datosAdicionales: "Gracias por su preferencia.",
      leyenda: "Documento interno sin valor tributario.",
    });
    const nueva = "Comprobante interno, no válido para fines tributarios.";
    const r = await e.llamar("PUT", RUTAS.configuracion, admin, { ...actual, comprobante: { ...actual.comprobante, leyenda: nueva } });
    expect(r.statusCode).toBe(200);

    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 });
    const ticketId = RegistrarIngresoRespuestaSchema.parse((await ingreso("hab-205", "clave-leyenda-1")).json()).ticket.id;
    const copia = ReimpresionRespuestaSchema.parse((await e.llamar("POST", ruta(RUTAS.reimprimirTicket, ticketId), cajero)).json());
    expect(copia.contenido.slice(-2).map((l) => l.trim()).join(" ")).toBe(nueva);

    for (const leyenda of ["  ", "Boleta de venta electrónica"]) {
      const rechazo = await e.llamar("PUT", RUTAS.configuracion, admin, { ...actual, comprobante: { ...actual.comprobante, leyenda } });
      expect(rechazo.json()).toMatchObject({ codigo: "VALIDACION" });
    }
    expect(await e.prisma.registroAuditoria.count({ where: { accion: "CONFIGURACION_CAMBIADA", tipoEntidad: "CONFIGURACION" } })).toBe(1);
  });
});

describe("Métodos de pago (RF-54, RN-35)", () => {
  const tarjeta = { nombre: "Tarjeta", afectaCaja: false, requiereReferencia: true, activo: true };

  it("alta, uso al cobrar y deshabilitación: un método deshabilitado ya no se acepta", async () => {
    const creado = MetodoPagoSchema.parse((await e.llamar("POST", RUTAS.metodosPago, admin, tarjeta)).json());
    expect(creado).toMatchObject(tarjeta);
    expect(MetodoPagoSchema.array().parse((await e.llamar("GET", RUTAS.metodosPago, cajero)).json()).map((m) => m.nombre)).toContain("Tarjeta");

    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 });
    const pago = { metodoPagoId: creado.id, monto: 4000, montoRecibido: null, referencia: "POS-123" };
    expect((await ingreso("hab-205", "clave-mp-1", [pago])).statusCode).toBe(201);

    const deshabilitado = await e.llamar("PUT", ruta(RUTAS.metodoPago, creado.id), admin, { ...tarjeta, activo: false });
    expect(MetodoPagoSchema.parse(deshabilitado.json()).activo).toBe(false);
    expect((await ingreso("hab-105", "clave-mp-2", [pago])).json()).toMatchObject({ codigo: "VALIDACION" });
    expect(await e.prisma.registroAuditoria.count({ where: { tipoEntidad: "METODO_PAGO" } })).toBe(2);
  });

  it("afectaCaja no se edita (decisión 20); nombre único; solo settings.manage administra", async () => {
    const r = await e.llamar("PUT", ruta(RUTAS.metodoPago, "metodo-yape"), admin, { nombre: "Yape", afectaCaja: true, requiereReferencia: false, activo: true });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: "INVALID_STATE_TRANSITION" });
    expect((await e.prisma.metodoPago.findUniqueOrThrow({ where: { id: "metodo-yape" } })).afectaCaja).toBe(false);

    expect((await e.llamar("POST", RUTAS.metodosPago, admin, { ...tarjeta, nombre: "Yape" })).json()).toMatchObject({ codigo: "VALIDACION" });
    expect((await e.llamar("POST", RUTAS.metodosPago, cajero, tarjeta)).statusCode).toBe(403);
    expect((await e.llamar("PUT", ruta(RUTAS.metodoPago, "metodo-x"), admin, tarjeta)).statusCode).toBe(404);
    expect((await e.llamar("GET", RUTAS.metodosPago, await e.login("limpieza"))).statusCode).toBe(403);
  });
});
