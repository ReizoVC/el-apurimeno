import { RUTAS, TurnoSchema } from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { efectivo, prepararEntorno, ruta, type Entorno } from "./entorno.js";

let e: Entorno;
let cajero: string;
let admin: string;
let turnoId: string;

beforeEach(async () => {
  e = await prepararEntorno();
  cajero = await e.login("cajero");
  admin = await e.login("admin");
  turnoId = TurnoSchema.parse((await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 10000 })).json()).id;
  await e.llamar(
    "POST",
    RUTAS.registrarIngreso,
    cajero,
    { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
    "clave-forzado-1",
  );
});
afterEach(() => e.cerrar());

const forzar = (id: string, cuerpo: object, token = admin) => e.llamar("POST", ruta(RUTAS.forzarCierreTurno, id), token, cuerpo);

describe("Cierre forzado de turno (CU-20, RF-43)", () => {
  it("el Administrador ve los turnos abiertos (sin el esperado) y cierra el ajeno contando el cajón", async () => {
    const abiertos = TurnoSchema.array().parse((await e.llamar("GET", RUTAS.turnosAbiertos, admin)).json());
    expect(abiertos).toHaveLength(1);
    expect(abiertos[0]).toMatchObject({ id: turnoId, usuarioId: "usuario-cajero", efectivoEsperado: null });

    const r = await forzar(turnoId, { efectivoContado: 13000, comentario: "cajero se retiró sin cerrar" });
    expect(r.statusCode).toBe(200);
    expect(TurnoSchema.parse(r.json())).toMatchObject({
      estado: "CERRADO",
      cierreForzado: true,
      cerradoPorId: "usuario-admin",
      efectivoEsperado: 14000,
      efectivoContado: 13000,
      diferencia: -1000,
      comentarioCierre: "cajero se retiró sin cerrar",
    });
    expect(await e.prisma.registroAuditoria.findFirst({ where: { accion: "TURNO_CIERRE_FORZADO", entidadId: turnoId } })).toMatchObject({
      usuarioId: "usuario-admin",
      motivo: "cajero se retiró sin cerrar",
    });
    expect((await e.llamar("GET", RUTAS.turnosAbiertos, admin)).json()).toEqual([]);
  });

  it("sin conteo: queda el esperado y ninguna diferencia; el cajero ya no puede cobrar (RN-32)", async () => {
    const cerrado = TurnoSchema.parse((await forzar(turnoId, { efectivoContado: null, comentario: null })).json());
    expect(cerrado).toMatchObject({ efectivoEsperado: 14000, efectivoContado: null, diferencia: null, comentarioCierre: null });
    const cobro = await e.llamar(
      "POST",
      RUTAS.registrarIngreso,
      cajero,
      { habitacionId: "hab-105", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
      "clave-forzado-2",
    );
    expect(cobro.json()).toMatchObject({ codigo: "SHIFT_NOT_OPEN" });
    // Puede abrir un turno nuevo.
    expect((await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 })).statusCode).toBe(201);
  });

  it("un turno ya cerrado → SHIFT_NOT_OPEN; el propio se cierra por la vía normal; inexistente → 404", async () => {
    await forzar(turnoId, { efectivoContado: null, comentario: null });
    expect((await forzar(turnoId, { efectivoContado: null, comentario: null })).json()).toMatchObject({ codigo: "SHIFT_NOT_OPEN" });

    const propio = TurnoSchema.parse((await e.llamar("POST", RUTAS.abrirTurno, admin, { efectivoInicial: 0 })).json());
    expect((await forzar(propio.id, { efectivoContado: 0, comentario: null })).json()).toMatchObject({ codigo: "INVALID_STATE_TRANSITION" });
    expect((await forzar("turno-x", { efectivoContado: null, comentario: null })).statusCode).toBe(404);
  });

  it("el Cajero no fuerza cierres ni ve los turnos ajenos (shifts.force_close)", async () => {
    expect((await e.llamar("GET", RUTAS.turnosAbiertos, cajero)).statusCode).toBe(403);
    expect((await forzar(turnoId, { efectivoContado: null, comentario: null }, cajero)).statusCode).toBe(403);
  });
});
