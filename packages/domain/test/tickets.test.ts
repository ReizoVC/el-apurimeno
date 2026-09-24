import { describe, expect, it } from "vitest";
import {
  aplicarAjustePuntual,
  armarTicketCobro,
  cotizarIngreso,
  cotizarVenta,
  pagoEnEfectivo,
  pagoSinVuelto,
  validarInvariantesTicket,
  type Cotizacion,
} from "../src/index.js";
import { EFECTIVO, PARAMETROS, YAPE, contexto, en, habitacion, producto, turnoAbierto, turnoCerrado } from "./fixtures.js";

const codigo = (c: string) => expect.objectContaining({ codigo: c });

function cotizacionT16(): Cotizacion {
  return cotizarIngreso({ habitacion: habitacion(), clienteId: null, preciosEspeciales: [], parametros: PARAMETROS, horasAdicionalesAlIngreso: 2 });
}

function ticketIngreso(cotizacion: Cotizacion, pagos = [pagoEnEfectivo(EFECTIVO.id, cotizacion.total, 5000)]) {
  return armarTicketCobro(
    {
      numero: 1,
      origen: "INGRESO_ALQUILER",
      turno: turnoAbierto(),
      alquilerId: "alq-1",
      habitacionReferenciaId: null,
      cotizacion,
      pagos,
      creadoPorId: "cajero-1",
    },
    contexto(en("14:00")),
  );
}

describe("Ticket de cobro", () => {
  it("T-16: ingreso de S/ 46.00 pagado con S/ 50.00 → vuelto S/ 4.00, ticket válido", () => {
    const ticket = ticketIngreso(cotizacionT16());
    expect(ticket).toMatchObject({ tipo: "COBRO", estado: "EMITIDO", total: 4600 });
    expect(ticket.pagos[0]).toMatchObject({ monto: 4600, montoRecibido: 5000, vuelto: 400 });
    expect(validarInvariantesTicket(ticket)).toEqual([]);
  });

  it("RF-04: total S/ 30.00, recibido S/ 50.00 → vuelto S/ 20.00", () => {
    expect(pagoEnEfectivo(EFECTIVO.id, 3000, 5000)).toMatchObject({ monto: 3000, vuelto: 2000 });
  });

  it("T-10: el ticket refleja el ajuste puntual y su motivo", () => {
    const ajustada = aplicarAjustePuntual(
      cotizarIngreso({ habitacion: habitacion(), clienteId: null, preciosEspeciales: [], parametros: PARAMETROS, horasAdicionalesAlIngreso: 0 }),
      4000,
      "cliente ingresó solo",
    );
    const ticket = ticketIngreso(ajustada);
    expect(ticket.total).toBe(4000);
    expect(ticket.ajustePuntual?.motivo).toBe("cliente ingresó solo");
  });

  it("paga en varios métodos", () => {
    const ticket = ticketIngreso(cotizacionT16(), [pagoSinVuelto(YAPE.id, 3000, " 123456 "), pagoEnEfectivo(EFECTIVO.id, 1600, 2000)]);
    expect(ticket.pagos.map((p) => p.monto)).toEqual([3000, 1600]);
    expect(ticket.pagos[0]?.referencia).toBe("123456");
  });
});

describe("RN-23 · todo se cobra en el momento", () => {
  it("monto recibido menor al total → PAYMENT_INSUFFICIENT", () => {
    expect(() => pagoEnEfectivo(EFECTIVO.id, 4600, 4000)).toThrow(codigo("PAYMENT_INSUFFICIENT"));
  });

  it("pagos que no cubren el total → PAYMENT_INSUFFICIENT", () => {
    expect(() => ticketIngreso(cotizacionT16(), [pagoSinVuelto(YAPE.id, 3000, null)])).toThrow(codigo("PAYMENT_INSUFFICIENT"));
  });
});

describe("RN-24 · asociar una venta a una habitación es opcional", () => {
  it("una venta sin habitación se completa igual", () => {
    const venta = armarTicketCobro(
      {
        numero: 2,
        origen: "VENTA_TIENDA",
        turno: turnoAbierto(),
        alquilerId: null,
        habitacionReferenciaId: null,
        cotizacion: cotizarVenta([{ producto: producto(), cantidad: 1 }], false),
        pagos: [pagoSinVuelto(EFECTIVO.id, 350, null)],
        creadoPorId: "cajero-1",
      },
      contexto(en("15:00")),
    );
    expect(venta.habitacionReferenciaId).toBeNull();
  });
});

describe("RN-32 · sin turno abierto no hay ticket", () => {
  it("rechaza con SHIFT_NOT_OPEN", () => {
    expect(() =>
      armarTicketCobro(
        {
          numero: 1,
          origen: "INGRESO_ALQUILER",
          turno: turnoCerrado,
          alquilerId: "alq-1",
          habitacionReferenciaId: null,
          cotizacion: cotizacionT16(),
          pagos: [pagoSinVuelto(EFECTIVO.id, 4600, null)],
          creadoPorId: "cajero-1",
        },
        contexto(en("14:00")),
      ),
    ).toThrow(codigo("SHIFT_NOT_OPEN"));
  });
});

describe("RN-37 · céntimos enteros", () => {
  it("rechaza montos con decimales", () => {
    expect(() => pagoEnEfectivo(EFECTIVO.id, 30.5, 50)).toThrow(RangeError);
  });
});

describe("Invariantes del ticket (§21)", () => {
  it("detecta un total que no es la suma de las líneas", () => {
    const roto = { ...ticketIngreso(cotizacionT16()), total: 3000 };
    expect(validarInvariantesTicket(roto)).toEqual(
      expect.arrayContaining([expect.stringContaining("El total debe ser la suma de las líneas")]),
    );
  });
});
