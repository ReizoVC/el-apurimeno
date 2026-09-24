import type { MovimientoCaja, Ticket } from "@apurimeno/contracts";
import { describe, expect, it } from "vitest";
import {
  anularTicket,
  armarTicketCobro,
  asegurarTurnoAbierto,
  calcularEfectivoEsperado,
  cerrarTurno,
  cotizarVenta,
  forzarCierreTurno,
  pagoSinVuelto,
  prepararMovimientoCaja,
} from "../src/index.js";
import { EFECTIVO, YAPE, contexto, en, producto, turnoAbierto, turnoCerrado } from "./fixtures.js";

const codigo = (c: string) => expect.objectContaining({ codigo: c });
const turno = turnoAbierto();

function cobro(monto: number, metodoPagoId: string, numero: number): Ticket {
  return armarTicketCobro(
    {
      numero,
      origen: "VENTA_TIENDA",
      turno,
      alquilerId: null,
      habitacionReferenciaId: null,
      cotizacion: cotizarVenta([{ producto: producto({ precioPublico: monto }), cantidad: 1 }], false),
      pagos: [pagoSinVuelto(metodoPagoId, monto, null)],
      creadoPorId: "cajero-1",
    },
    contexto(en("12:00")),
  );
}

function movimiento(tipo: "INGRESO" | "RETIRO", monto: number): MovimientoCaja {
  return { id: `mov-${tipo}`, turnoId: turno.id, tipo, monto, motivo: "caja chica", creadoPorId: "cajero-1", creadoEn: en("13:00") };
}

describe("RN-32 · nada se cobra sin turno abierto", () => {
  it("rechaza con SHIFT_NOT_OPEN", () => {
    expect(() => asegurarTurnoAbierto(turnoCerrado)).toThrow(codigo("SHIFT_NOT_OPEN"));
  });

  it("tampoco se registran movimientos manuales", () => {
    expect(() => prepararMovimientoCaja(turnoCerrado, "RETIRO", 2000, "gasto")).toThrow(codigo("SHIFT_NOT_OPEN"));
  });

  it("un movimiento manual exige motivo y monto positivo (RF-42)", () => {
    expect(prepararMovimientoCaja(turno, "RETIRO", 2000, " gasto menor ")).toEqual({
      turnoId: turno.id,
      tipo: "RETIRO",
      monto: 2000,
      motivo: "gasto menor",
    });
    expect(() => prepararMovimientoCaja(turno, "RETIRO", 2000, "")).toThrow(codigo("REASON_REQUIRED"));
    expect(() => prepararMovimientoCaja(turno, "RETIRO", 0, "gasto")).toThrow(RangeError);
  });
});

describe("RN-33 · efectivo esperado", () => {
  it("inicial 100 + efectivo 250 + ingreso 20 − retiro 30 = 340 (RF-27)", () => {
    const esperado = calcularEfectivoEsperado(
      { ...turno, efectivoInicial: 10000 },
      [cobro(25000, EFECTIVO.id, 1)],
      [movimiento("INGRESO", 2000), movimiento("RETIRO", 3000)],
      [EFECTIVO, YAPE],
    );
    expect(esperado).toBe(34000);
  });

  it("una devolución en efectivo por anulación resta del turno donde se hace", () => {
    const original = cobro(3000, EFECTIVO.id, 1);
    const { compensatorio } = anularTicket(
      {
        ticket: original,
        motivo: "error",
        numero: 2,
        turno,
        usuario: { id: "admin-1", permisos: ["tickets.void"] },
        autorizacion: null,
      },
      contexto(en("12:30")),
    );
    expect(calcularEfectivoEsperado(turno, [original, compensatorio], [], [EFECTIVO])).toBe(10000);
  });
});

describe("RN-35 · los pagos digitales no afectan el efectivo", () => {
  it("un cobro por Yape no suma al esperado", () => {
    expect(calcularEfectivoEsperado(turno, [cobro(5000, YAPE.id, 1)], [], [EFECTIVO, YAPE])).toBe(10000);
  });
});

describe("RN-34 · arqueo ciego", () => {
  it("con el contado y el esperado registra la diferencia de −S/ 5.00 (escenario 31.4)", () => {
    const cerrado = cerrarTurno(turno, { efectivoContado: 33500, efectivoEsperado: 34000, ahora: en("20:00") });
    expect(cerrado).toMatchObject({ estado: "CERRADO", efectivoContado: 33500, efectivoEsperado: 34000, diferencia: -500 });
  });

  it("una diferencia no impide cerrar, pero el contado no puede ser negativo", () => {
    expect(() => cerrarTurno(turno, { efectivoContado: -1, efectivoEsperado: 0, ahora: en("20:00") })).toThrow(RangeError);
  });

  it("un turno cerrado no se vuelve a cerrar", () => {
    expect(() => cerrarTurno(turnoCerrado, { efectivoContado: 0, efectivoEsperado: 0, ahora: en("21:00") })).toThrow(
      codigo("SHIFT_NOT_OPEN"),
    );
  });
});

describe("Cierre forzado (CU-20, RF-43)", () => {
  it("un Administrador cierra el turno de otro, con o sin conteo", () => {
    const cerrado = forzarCierreTurno(turno, { cerradoPorId: "admin-1", efectivoContado: null, efectivoEsperado: 10000, ahora: en("23:00") });
    expect(cerrado).toMatchObject({ cierreForzado: true, cerradoPorId: "admin-1", diferencia: null });
  });

  it("no se fuerza el cierre del propio turno", () => {
    expect(() =>
      forzarCierreTurno(turno, { cerradoPorId: "cajero-1", efectivoContado: null, efectivoEsperado: 0, ahora: en("23:00") }),
    ).toThrow(codigo("INVALID_STATE_TRANSITION"));
  });
});
