import type { Ticket } from "@apurimeno/contracts";
import { describe, expect, it } from "vitest";
import {
  anularTicket,
  armarTicketCobro,
  cotizarIngreso,
  crearCodigoAutorizacion,
  pagoEnEfectivo,
  type DatosAnulacion,
} from "../src/index.js";
import { EFECTIVO, PARAMETROS, contexto, en, habitacion, turnoAbierto, turnoCerrado } from "./fixtures.js";

const codigo = (c: string) => expect.objectContaining({ codigo: c });

function ingreso(): Ticket {
  return armarTicketCobro(
    {
      numero: 1,
      origen: "INGRESO_ALQUILER",
      turno: turnoAbierto(),
      alquilerId: "alq-1",
      habitacionReferenciaId: null,
      cotizacion: cotizarIngreso({ habitacion: habitacion(), clienteId: null, preciosEspeciales: [], parametros: PARAMETROS, horasAdicionalesAlIngreso: 0 }),
      pagos: [pagoEnEfectivo(EFECTIVO.id, 3000, 5000)],
      creadoPorId: "cajero-1",
    },
    contexto(en("14:00")),
  );
}

const codigoGenerado = crearCodigoAutorizacion(
  { codigo: "482913", operacion: "ANULAR_TICKET", generadoPorId: "admin-1", minutosVigencia: 5 },
  contexto(en("14:10")),
);

function anular(parcial: Partial<DatosAnulacion> = {}, ahora = en("14:12")) {
  return anularTicket(
    {
      ticket: ingreso(),
      motivo: "habitación incorrecta",
      numero: 2,
      turno: turnoAbierto(),
      usuario: { id: "admin-1", permisos: ["tickets.void"] },
      autorizacion: null,
      ...parcial,
    },
    contexto(ahora),
  );
}

describe("RN-36 · corregir con un ticket compensatorio, nunca borrar", () => {
  it("el original queda ANULADO y el compensatorio es por −S/ 30.00, vinculado a él (RF-29)", () => {
    const { original, compensatorio } = anular();
    expect(original.estado).toBe("ANULADO");
    expect(compensatorio).toMatchObject({
      tipo: "COMPENSATORIO",
      estado: "EMITIDO",
      total: -3000,
      ticketOriginalId: original.id,
      anulacion: { motivo: "habitación incorrecta", codigoAutorizacionId: null },
    });
    expect(compensatorio.pagos).toEqual([expect.objectContaining({ metodoPagoId: EFECTIVO.id, monto: -3000, montoRecibido: null })]);
  });

  it("conserva todos los datos del original salvo el estado", () => {
    const ticket = ingreso();
    const { original } = anular({ ticket });
    expect({ ...original, estado: ticket.estado }).toEqual(ticket);
  });

  it("no se anula dos veces (TICKET_ALREADY_VOIDED)", () => {
    expect(() => anular({ ticket: { ...ingreso(), estado: "ANULADO" } })).toThrow(codigo("TICKET_ALREADY_VOIDED"));
  });

  it("un compensatorio no se anula", () => {
    const { compensatorio } = anular();
    expect(() => anular({ ticket: compensatorio })).toThrow(codigo("INVALID_STATE_TRANSITION"));
  });

  it("exige motivo y un turno abierto", () => {
    expect(() => anular({ motivo: " " })).toThrow(codigo("REASON_REQUIRED"));
    expect(() => anular({ turno: turnoCerrado })).toThrow(codigo("SHIFT_NOT_OPEN"));
  });
});

describe("RN-46 · un Cajero anula solo con código de autorización", () => {
  const cajero = { id: "cajero-1", permisos: [] };

  it("sin código → AUTH_CODE_INVALID", () => {
    expect(() => anular({ usuario: cajero })).toThrow(codigo("AUTH_CODE_INVALID"));
  });

  it("con un código vigente anula, y el código queda consumido", () => {
    const r = anular({ usuario: cajero, autorizacion: { codigo: codigoGenerado, valorIngresado: " 482913 " } });
    expect(r.compensatorio.anulacion?.codigoAutorizacionId).toBe(codigoGenerado.id);
    expect(r.codigoConsumido).toMatchObject({ usadoEn: en("14:12"), usadoPorId: "cajero-1", ticketId: r.original.id });
  });

  it("un código ya usado no sirve otra vez", () => {
    const { codigoConsumido } = anular({ usuario: cajero, autorizacion: { codigo: codigoGenerado, valorIngresado: "482913" } });
    expect(codigoConsumido).not.toBeNull();
    expect(() => anular({ usuario: cajero, autorizacion: { codigo: codigoConsumido!, valorIngresado: "482913" } })).toThrow(
      codigo("AUTH_CODE_INVALID"),
    );
  });

  it("un código vencido o incorrecto no sirve", () => {
    expect(() => anular({ usuario: cajero, autorizacion: { codigo: codigoGenerado, valorIngresado: "482913" } }, en("14:16"))).toThrow(
      codigo("AUTH_CODE_INVALID"),
    );
    expect(() => anular({ usuario: cajero, autorizacion: { codigo: codigoGenerado, valorIngresado: "000000" } })).toThrow(
      codigo("AUTH_CODE_INVALID"),
    );
  });

  it("el código vence a los minutos configurados (RF-65)", () => {
    expect(codigoGenerado.expiraEn).toBe(en("14:15"));
  });
});
