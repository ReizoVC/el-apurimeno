import type { PrecioEspecialCliente } from "@apurimeno/contracts";
import { describe, expect, it } from "vitest";
import {
  aplicarAjustePuntual,
  calcularEstadoTemporal,
  calcularHoraAdicional,
  cotizarIngreso,
  cotizarVenta,
  iniciarAlquiler,
  registrarSalida,
} from "../src/index.js";
import { PARAMETROS, alquiler, contexto, en, habitacion, producto, turnoAbierto } from "./fixtures.js";

// SRS §16.10: habitación S/ 30.00, 8 horas base, cortesía 15 min, hora adicional S/ 8.00. Ingreso 14:00, salida 22:00.
const ocupada = habitacion({ estado: "OCUPADA" });
const especial: PrecioEspecialCliente = {
  id: "pe-1",
  clienteId: "cli-1",
  habitacionId: "hab-205",
  precio: 5000,
  creadoPorId: "admin-1",
  creadoEn: en("09:00"),
};

function cotizar(parcial: Partial<Parameters<typeof cotizarIngreso>[0]> = {}) {
  return cotizarIngreso({ habitacion: habitacion(), clienteId: null, preciosEspeciales: [], parametros: PARAMETROS, horasAdicionalesAlIngreso: 0, ...parcial });
}

const salir = (ahora: string) => registrarSalida(alquiler(), ocupada, { usuarioId: "cajero-1", ahora });

describe("SRS §16.10 — casos de prueba obligatorios de tiempo y precio", () => {
  it("T-01 ingreso normal: S/ 30.00, salida = ingreso + 8 h", () => {
    const r = iniciarAlquiler({ habitacion: habitacion(), clienteId: null, preciosEspeciales: [], parametros: PARAMETROS, horasAdicionalesAlIngreso: 0, turno: turnoAbierto() }, contexto(en("14:00")));
    expect(r.cotizacion.total).toBe(3000);
    expect(r.alquiler.salidaProgramadaEn).toBe(en("22:00"));
  });

  it("T-02 sale exactamente a la hora: sin cargo", () => {
    expect(salir(en("22:00")).alquiler.estado).toBe("CERRADO");
  });

  it("T-03 sale 10 min tarde: sin cargo, cortesía no consumida", () => {
    expect(calcularEstadoTemporal(alquiler(), en("22:10"))).toBe("EN_CORTESIA");
    expect(salir(en("22:10")).alquiler).toMatchObject({ estado: "CERRADO", cortesiaConsumida: false });
  });

  it("T-04 sale 16 min tarde y paga: S/ 8.00, salida = pago + 60 min, cortesía consumida", () => {
    const efecto = calcularHoraAdicional(alquiler(), en("22:16"));
    expect(efecto).toMatchObject({ tipo: "LIQUIDACION_SOBRETIEMPO", salidaNueva: en("23:16"), cortesiaConsumida: true });
  });

  it("T-05 sale 2 horas antes: sin cargo, sin devolución", () => {
    expect(salir(en("20:00")).alquiler).toMatchObject({ estado: "CERRADO", salidaSinPago: false });
  });

  it("T-06 pide 1 hora más dentro de su tiempo: S/ 8.00, salida anterior + 60 min, cortesía sin cambios", () => {
    const efecto = calcularHoraAdicional(alquiler(), en("20:00"));
    expect(efecto).toMatchObject({ tipo: "EXTENSION_ANTICIPADA", salidaNueva: en("23:00"), cortesiaConsumida: false });
  });

  it("T-07 con la cortesía consumida vuelve a pasarse: sobretiempo inmediato", () => {
    expect(calcularEstadoTemporal(alquiler({ cortesiaConsumida: true }), en("22:01"))).toBe("EN_SOBRETIEMPO");
  });

  it("T-08 cliente con precio especial de S/ 50.00: total S/ 50.00", () => {
    expect(cotizar({ clienteId: "cli-1", preciosEspeciales: [especial] }).total).toBe(5000);
  });

  it("T-09 el mismo cliente en otra habitación: precio de lista", () => {
    const otra = habitacion({ id: "hab-202", numero: "202" });
    expect(cotizar({ habitacion: otra, clienteId: "cli-1", preciosEspeciales: [especial] }).total).toBe(3000);
  });

  it("T-10 ajuste puntual de +S/ 10.00: S/ 40.00 solo esa vez", () => {
    expect(aplicarAjustePuntual(cotizar(), 4000, "cliente solo").total).toBe(4000);
    expect(cotizar().total).toBe(3000);
  });

  it("T-11 ajuste por debajo del mínimo: rechazado", () => {
    expect(() => aplicarAjustePuntual(cotizar(), 2500, "descuento")).toThrow(expect.objectContaining({ codigo: "ADJUSTMENT_BELOW_MINIMUM" }));
  });

  it("T-12 venta asociada a un huésped: precio de huésped", () => {
    expect(cotizarVenta([{ producto: producto(), cantidad: 1 }], true).total).toBe(300);
  });

  it("T-13 venta sin habitación: precio de público", () => {
    expect(cotizarVenta([{ producto: producto(), cantidad: 1 }], false).total).toBe(350);
  });

  it("T-14 cerrar en sobretiempo sin resolver: rechazado", () => {
    expect(() => salir(en("22:30"))).toThrow(expect.objectContaining({ codigo: "OVERTIME_UNRESOLVED" }));
  });

  it("T-15 dos ingresos a la misma habitación: solo uno tiene éxito", () => {
    const datos = { clienteId: null, preciosEspeciales: [], parametros: PARAMETROS, horasAdicionalesAlIngreso: 0, turno: turnoAbierto() };
    const primero = iniciarAlquiler({ ...datos, habitacion: habitacion() }, contexto(en("14:00")));
    expect(() => iniciarAlquiler({ ...datos, habitacion: primero.habitacion }, contexto(en("14:00")))).toThrow(
      expect.objectContaining({ codigo: "ROOM_NOT_AVAILABLE" }),
    );
  });

  it("T-16 paga base + 2 horas al ingreso: S/ 46.00, salida = ingreso + 10 h", () => {
    const r = iniciarAlquiler({ habitacion: habitacion(), clienteId: null, preciosEspeciales: [], parametros: PARAMETROS, horasAdicionalesAlIngreso: 2, turno: turnoAbierto() }, contexto(en("14:00")));
    expect(r.cotizacion.total).toBe(4600);
    expect(r.alquiler.salidaProgramadaEn).toBe(en("00:00", 24));
  });
});
