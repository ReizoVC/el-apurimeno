import { RUTAS, RegistrarIngresoRespuestaSchema, TableroSchema, TurnoActualRespuestaSchema } from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { efectivo, prepararEntorno, type Entorno } from "./entorno.js";

let e: Entorno;
let cajero: string;

beforeEach(async () => {
  e = await prepararEntorno();
  cajero = await e.login("cajero");
});
afterEach(() => e.cerrar());

const tablero = async () => TableroSchema.parse((await e.llamar("GET", RUTAS.tablero, cajero)).json());

describe("Tablero del POS (Planos §11.2)", () => {
  it("las 17 habitaciones por número; la ocupada trae su alquiler, su estado temporal y sus tickets", async () => {
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 });
    const r = await e.llamar(
      "POST",
      RUTAS.registrarIngreso,
      cajero,
      { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
      "clave-tablero-1",
    );
    const { alquiler, ticket } = RegistrarIngresoRespuestaSchema.parse(r.json());

    const t = await tablero();
    expect(t.ahora).toBe("2026-09-23T14:00:00.000Z");
    expect(t.habitaciones).toHaveLength(17);
    expect(t.habitaciones.map((h) => h.habitacion.numero)).toEqual([...t.habitaciones.map((h) => h.habitacion.numero)].sort());
    const h205 = t.habitaciones.find((h) => h.habitacion.id === "hab-205");
    expect(h205?.habitacion.estado).toBe("OCUPADA");
    expect(h205?.alquiler).toMatchObject({ alquiler: { id: alquiler.id }, estadoTemporal: "A_TIEMPO" });
    expect(h205?.alquiler?.tickets.map((x) => x.id)).toEqual([ticket.id]);
    expect(t.habitaciones.filter((h) => h.alquiler !== null)).toHaveLength(1);
  });

  it("el estado temporal usa la hora del servidor (RN-11)", async () => {
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 });
    await e.llamar(
      "POST",
      RUTAS.registrarIngreso,
      cajero,
      { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
      "clave-tablero-2",
    );
    const estado = async () => (await tablero()).habitaciones.find((h) => h.habitacion.id === "hab-205")?.alquiler?.estadoTemporal;
    e.reloj.avanzarMinutos(8 * 60 - 5);
    expect(await estado()).toBe("POR_VENCER");
    e.reloj.avanzarMinutos(10);
    expect(await estado()).toBe("EN_CORTESIA");
    e.reloj.avanzarMinutos(15);
    expect(await estado()).toBe("EN_SOBRETIEMPO");
  });

  it("Limpieza no ve el tablero (pos.access)", async () => {
    expect((await e.llamar("GET", RUTAS.tablero, await e.login("limpieza"))).statusCode).toBe(403);
  });
});

describe("Turno actual", () => {
  it("null sin turno; el turno abierto después, sin revelar el esperado (RN-34)", async () => {
    const actual = async () => TurnoActualRespuestaSchema.parse((await e.llamar("GET", RUTAS.turnoActual, cajero)).json()).turno;
    expect(await actual()).toBeNull();
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 5000 });
    expect(await actual()).toMatchObject({ usuarioId: "usuario-cajero", estado: "ABIERTO", efectivoInicial: 5000, efectivoEsperado: null });
    await e.llamar("POST", RUTAS.cerrarTurno, cajero, { efectivoContado: 5000, comentario: null });
    expect(await actual()).toBeNull();
  });
});
