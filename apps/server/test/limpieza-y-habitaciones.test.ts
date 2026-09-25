import { HabitacionSchema, RUTAS, RegistrarIngresoRespuestaSchema } from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { efectivo, prepararEntorno, ruta, type Entorno } from "./entorno.js";

let e: Entorno;
let cajero: string;
let limpieza: string;
let admin: string;

beforeEach(async () => {
  e = await prepararEntorno();
  cajero = await e.login("cajero");
  limpieza = await e.login("limpieza");
  admin = await e.login("admin");
});
afterEach(() => e.cerrar());

const estadoDe = async (id: string) => (await e.prisma.habitacion.findUniqueOrThrow({ where: { id } })).estado;
const pendiente = (id: string) => e.prisma.habitacion.update({ where: { id }, data: { estado: "PENDIENTE_LIMPIEZA" } });

describe("Limpieza (CU-15 a CU-17) · lo que consume apps/cleaning", () => {
  it("tras una salida, la habitación aparece en la lista de limpieza; al marcarla lista vuelve a LIBRE", async () => {
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 });
    const ingreso = await e.llamar(
      "POST",
      RUTAS.registrarIngreso,
      cajero,
      { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
      "clave-limpieza-1",
    );
    const { alquiler } = RegistrarIngresoRespuestaSchema.parse(ingreso.json());
    await e.llamar("POST", ruta(RUTAS.registrarSalida, alquiler.id), cajero, {});

    const lista = await e.llamar("GET", RUTAS.habitacionesPendientesLimpieza, limpieza);
    expect(lista.statusCode).toBe(200);
    expect(HabitacionSchema.array().parse(lista.json()).map((h) => h.numero)).toEqual(["205"]);

    // apps/cleaning envía solo el id: sin cuerpo ni idempotency-key.
    const lista2 = await e.llamar("POST", ruta(RUTAS.marcarHabitacionLista, "hab-205"), limpieza);
    expect(lista2.statusCode).toBe(200);
    expect(HabitacionSchema.parse(lista2.json())).toMatchObject({ id: "hab-205", estado: "LIBRE" });
    expect((await e.llamar("GET", RUTAS.habitacionesPendientesLimpieza, limpieza)).json()).toEqual([]);
    expect(await e.prisma.registroAuditoria.findFirst({ where: { accion: "HABITACION_ESTADO_CAMBIADO", usuarioId: "usuario-limpieza" } })).toMatchObject({
      entidadId: "hab-205",
      valorPrevio: { estado: "PENDIENTE_LIMPIEZA" },
      valorNuevo: { estado: "LIBRE" },
    });
  });

  it("la lista devuelve solo PENDIENTE_LIMPIEZA, nunca las libres, ocupadas ni en mantenimiento (RF-40)", async () => {
    await pendiente("hab-301");
    await pendiente("hab-105");
    await e.prisma.habitacion.update({ where: { id: "hab-202" }, data: { estado: "MANTENIMIENTO" } });
    await e.prisma.habitacion.update({ where: { id: "hab-304" }, data: { estado: "OCUPADA" } });
    const lista = HabitacionSchema.array().parse((await e.llamar("GET", RUTAS.habitacionesPendientesLimpieza, limpieza)).json());
    expect(lista.map((h) => h.numero)).toEqual(["105", "301"]);
    expect(lista.every((h) => h.estado === "PENDIENTE_LIMPIEZA")).toBe(true);
  });

  it("reportar mantenimiento sin cuerpo (como apps/cleaning) o con motivo: PENDIENTE_LIMPIEZA → MANTENIMIENTO", async () => {
    await pendiente("hab-101");
    await pendiente("hab-102");
    const sinCuerpo = await e.llamar("POST", ruta(RUTAS.reportarMantenimiento, "hab-101"), limpieza);
    expect(HabitacionSchema.parse(sinCuerpo.json()).estado).toBe("MANTENIMIENTO");
    const conMotivo = await e.llamar("POST", ruta(RUTAS.reportarMantenimiento, "hab-102"), limpieza, { motivo: "caño roto" });
    expect(HabitacionSchema.parse(conMotivo.json()).estado).toBe("MANTENIMIENTO");
    expect(await e.prisma.registroAuditoria.findFirst({ where: { entidadId: "hab-102", accion: "HABITACION_ESTADO_CAMBIADO" } })).toMatchObject({
      motivo: "caño roto",
    });
  });

  it("marcar lista una habitación que no está pendiente → 422 INVALID_STATE_TRANSITION, sin cambios (§32)", async () => {
    const r = await e.llamar("POST", ruta(RUTAS.marcarHabitacionLista, "hab-205"), limpieza);
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: "INVALID_STATE_TRANSITION" });
    expect(await estadoDe("hab-205")).toBe("LIBRE");
    expect((await e.llamar("POST", ruta(RUTAS.marcarHabitacionLista, "hab-999"), limpieza)).statusCode).toBe(404);
  });

  it("dos personas marcan la misma habitación a la vez: solo una cambia el estado", async () => {
    await pendiente("hab-205");
    const [a, b] = await Promise.all([
      e.llamar("POST", ruta(RUTAS.marcarHabitacionLista, "hab-205"), limpieza),
      e.llamar("POST", ruta(RUTAS.reportarMantenimiento, "hab-205"), admin),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 422]);
    expect(await e.prisma.registroAuditoria.count({ where: { accion: "HABITACION_ESTADO_CAMBIADO" } })).toBe(1);
  });

  it("el Cajero no usa las rutas de limpieza; Limpieza no ve el tablero completo ni administra (§22)", async () => {
    await pendiente("hab-205");
    expect((await e.llamar("GET", RUTAS.habitacionesPendientesLimpieza, cajero)).statusCode).toBe(403);
    expect((await e.llamar("POST", ruta(RUTAS.marcarHabitacionLista, "hab-205"), cajero)).statusCode).toBe(403);
    expect((await e.llamar("GET", RUTAS.habitaciones, limpieza)).statusCode).toBe(403);
    expect((await e.llamar("POST", ruta(RUTAS.reactivarHabitacion, "hab-205"), limpieza)).statusCode).toBe(403);
  });
});

describe("Administración de habitaciones (CU-13, CU-14)", () => {
  it("alta: queda LIBRE y aparece en el tablero; el número es único (RF-36)", async () => {
    const nueva = { numero: "401", descripcion: "Con baño propio", precioBase: 3500 };
    const r = await e.llamar("POST", RUTAS.habitaciones, admin, nueva);
    expect(r.statusCode).toBe(201);
    expect(HabitacionSchema.parse(r.json())).toMatchObject({ ...nueva, estado: "LIBRE" });
    const tablero = HabitacionSchema.array().parse((await e.llamar("GET", RUTAS.habitaciones, cajero)).json());
    expect(tablero).toHaveLength(18);
    expect((await e.llamar("POST", RUTAS.habitaciones, admin, nueva)).json()).toMatchObject({ codigo: "VALIDACION" });
    expect((await e.llamar("POST", RUTAS.habitaciones, cajero, { ...nueva, numero: "402" })).statusCode).toBe(403);
  });

  it("editar el precio no afecta al alquiler abierto (RF-37, RN-44) y queda auditado", async () => {
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 });
    const ingreso = await e.llamar(
      "POST",
      RUTAS.registrarIngreso,
      cajero,
      { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
      "clave-precio-1",
    );
    const { alquiler } = RegistrarIngresoRespuestaSchema.parse(ingreso.json());
    const editada = await e.llamar("PUT", ruta(RUTAS.habitacion, "hab-205"), admin, { numero: "205", descripcion: "Renovada", precioBase: 4500 });
    expect(HabitacionSchema.parse(editada.json())).toMatchObject({ precioBase: 4500, descripcion: "Renovada", estado: "OCUPADA" });
    expect((await e.prisma.alquiler.findUniqueOrThrow({ where: { id: alquiler.id } })).precioHabitacionAplicado).toBe(4000);
    expect(await e.prisma.registroAuditoria.findFirst({ where: { accion: "HABITACION_EDITADA" } })).toMatchObject({
      valorPrevio: expect.objectContaining({ precioBase: 4000 }),
      valorNuevo: expect.objectContaining({ precioBase: 4500 }),
    });
  });

  it("bloqueo con motivo obligatorio y reactivación (RF-38, RF-39)", async () => {
    const sinMotivo = await e.llamar("POST", ruta(RUTAS.bloquearHabitacion, "hab-205"), admin, { motivo: " " });
    expect(sinMotivo.json()).toMatchObject({ codigo: "REASON_REQUIRED" });
    const bloqueada = await e.llamar("POST", ruta(RUTAS.bloquearHabitacion, "hab-205"), admin, { motivo: "pintura" });
    expect(HabitacionSchema.parse(bloqueada.json()).estado).toBe("MANTENIMIENTO");
    const reactivada = await e.llamar("POST", ruta(RUTAS.reactivarHabitacion, "hab-205"), admin);
    expect(HabitacionSchema.parse(reactivada.json()).estado).toBe("LIBRE");
  });

  it("no se bloquea una habitación con alquiler abierto (RF-38)", async () => {
    await e.prisma.habitacion.update({ where: { id: "hab-205" }, data: { estado: "OCUPADA" } });
    const r = await e.llamar("POST", ruta(RUTAS.bloquearHabitacion, "hab-205"), admin, { motivo: "pintura" });
    expect(r.json()).toMatchObject({ codigo: "INVALID_STATE_TRANSITION" });
  });
});
