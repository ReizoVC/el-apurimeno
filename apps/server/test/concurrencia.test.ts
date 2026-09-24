import { RUTAS, RegistrarIngresoRespuestaSchema } from "@apurimeno/contracts";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aAlquiler, datosAlquiler } from "../src/mapeo.js";
import { efectivo, prepararEntorno, ruta, type Entorno } from "./entorno.js";

let e: Entorno;
let cajero: string;

beforeEach(async () => {
  e = await prepararEntorno();
  cajero = await e.login("cajero");
  await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 10000 });
});
afterEach(() => e.cerrar());

const cuerpoIngreso = (habitacionId = "hab-205") => ({
  habitacionId,
  clienteId: null,
  horasAdicionalesAlIngreso: 0,
  ajuste: null,
  pagos: [efectivo(4000, 5000)],
});

describe("RN-27 / T-15 · un solo alquiler abierto por habitación", () => {
  it("dos ingresos simultáneos a la misma habitación: exactamente uno tiene éxito", async () => {
    const admin = await e.login("admin");
    await e.llamar("POST", RUTAS.abrirTurno, admin, { efectivoInicial: 0 });

    const [a, b] = await Promise.all([
      e.llamar("POST", RUTAS.registrarIngreso, cajero, cuerpoIngreso(), "clave-cajero-t15"),
      e.llamar("POST", RUTAS.registrarIngreso, admin, cuerpoIngreso(), "clave-admin-t15"),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 422]);
    expect([a, b].find((r) => r.statusCode === 422)?.json()).toMatchObject({ codigo: "ROOM_NOT_AVAILABLE" });
    expect(await e.prisma.alquiler.count({ where: { habitacionId: "hab-205", estado: "ABIERTO" } })).toBe(1);
    expect(await e.prisma.ticket.count()).toBe(1);
  });

  it("la base de datos lo impide aunque se salte el dominio (índice único parcial)", async () => {
    const r = RegistrarIngresoRespuestaSchema.parse(
      (await e.llamar("POST", RUTAS.registrarIngreso, cajero, cuerpoIngreso(), "clave-directa-1")).json(),
    );
    const fila = datosAlquiler(aAlquiler(await e.prisma.alquiler.findUniqueOrThrow({ where: { id: r.alquiler.id } })));
    await expect(e.prisma.alquiler.create({ data: { ...fila, id: "alquiler-duplicado" } })).rejects.toMatchObject({ code: "P2002" });

    // Un alquiler CERRADO no cuenta: el índice es parcial.
    await expect(
      e.prisma.alquiler.create({ data: { ...fila, id: "alquiler-historico", estado: "CERRADO" } }),
    ).resolves.toBeDefined();
  });

  it("tampoco admite dos turnos abiertos del mismo usuario", async () => {
    const turno = await e.prisma.turno.findFirstOrThrow({ where: { estado: "ABIERTO" } });
    await expect(e.prisma.turno.create({ data: { ...turno, id: "turno-duplicado" } })).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("RF-59 · idempotencia de cobros", () => {
  it("reintentar con la misma clave devuelve el mismo resultado sin cobrar dos veces", async () => {
    const primera = await e.llamar("POST", RUTAS.registrarIngreso, cajero, cuerpoIngreso(), "clave-reintento-1");
    const segunda = await e.llamar("POST", RUTAS.registrarIngreso, cajero, cuerpoIngreso(), "clave-reintento-1");

    expect(primera.statusCode).toBe(201);
    expect(segunda.statusCode).toBe(200);
    expect(segunda.headers["idempotent-replayed"]).toBe("true");
    expect(segunda.json()).toEqual(primera.json());
    expect(await e.prisma.ticket.count()).toBe(1);
    expect(await e.prisma.alquiler.count()).toBe(1);
  });

  it("dos solicitudes simultáneas con la misma clave (doble clic) cobran una sola vez", async () => {
    const [a, b] = await Promise.all([
      e.llamar("POST", RUTAS.registrarIngreso, cajero, cuerpoIngreso(), "clave-doble-clic"),
      e.llamar("POST", RUTAS.registrarIngreso, cajero, cuerpoIngreso(), "clave-doble-clic"),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(a.json<{ ticket: { id: string } }>().ticket.id).toBe(b.json<{ ticket: { id: string } }>().ticket.id);
    expect(await e.prisma.ticket.count()).toBe(1);
  });

  it("la hora adicional también es idempotente", async () => {
    const { alquiler } = RegistrarIngresoRespuestaSchema.parse(
      (await e.llamar("POST", RUTAS.registrarIngreso, cajero, cuerpoIngreso(), "clave-ingreso-h")).json(),
    );
    const url = ruta(RUTAS.registrarHoraAdicional, alquiler.id);
    const cuerpo = { ajuste: null, pagos: [efectivo(800)] };
    const primera = await e.llamar("POST", url, cajero, cuerpo, "clave-hora-reintento");
    const segunda = await e.llamar("POST", url, cajero, cuerpo, "clave-hora-reintento");
    expect([primera.statusCode, segunda.statusCode]).toEqual([201, 200]);
    expect(await e.prisma.horaAdicional.count()).toBe(1);
    // La salida se movió una sola hora: 22:00 → 23:00.
    expect(segunda.json()).toMatchObject({ alquiler: { salidaProgramadaEn: "2026-09-23T23:00:00.000Z" } });
  });

  it("una clave reutilizada en otra operación se rechaza", async () => {
    const { alquiler } = RegistrarIngresoRespuestaSchema.parse(
      (await e.llamar("POST", RUTAS.registrarIngreso, cajero, cuerpoIngreso(), "clave-compartida")).json(),
    );
    const r = await e.llamar("POST", ruta(RUTAS.registrarHoraAdicional, alquiler.id), cajero, { ajuste: null, pagos: [efectivo(800)] }, "clave-compartida");
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ codigo: "CLAVE_IDEMPOTENCIA_REUTILIZADA" });
  });

  it("un cobro sin clave de idempotencia se rechaza", async () => {
    const r = await e.llamar("POST", RUTAS.registrarIngreso, cajero, cuerpoIngreso());
    expect(r.statusCode).toBe(400);
    expect(await e.prisma.ticket.count()).toBe(0);
  });
});

describe("SQLite en modo WAL", () => {
  it("la base queda en journal_mode = wal", () => {
    const db = new Database(e.ruta, { readonly: true });
    try {
      expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    } finally {
      db.close();
    }
  });
});
