import type { HoraAdicional } from "@apurimeno/contracts";
import { describe, expect, it } from "vitest";
import {
  aplicarAnulacionHoraAdicional,
  aplicarAnulacionIngreso,
  calcularEstadoTemporal,
  iniciarAlquiler,
  registrarHoraAdicional,
  registrarSalida,
  registrarSalidaSinPago,
} from "../src/index.js";
import { PARAMETROS, alquiler, alquilerConSalida, contexto, en, habitacion, turnoAbierto, turnoCerrado } from "./fixtures.js";

const codigo = (c: string) => expect.objectContaining({ codigo: c });
const ocupada = habitacion({ estado: "OCUPADA" });

function ingresar(parcial: Partial<Parameters<typeof iniciarAlquiler>[0]> = {}) {
  return iniciarAlquiler(
    {
      habitacion: habitacion(),
      clienteId: null,
      preciosEspeciales: [],
      parametros: PARAMETROS,
      horasAdicionalesAlIngreso: 0,
      turno: turnoAbierto(),
      ...parcial,
    },
    contexto(en("14:00")),
  );
}

describe("Ingreso (CU-04)", () => {
  it("crea el alquiler abierto, ocupa la habitación y cotiza S/ 30.00 con salida 22:00 (T-01)", () => {
    const r = ingresar();
    expect(r.alquiler).toMatchObject({ estado: "ABIERTO", ingresoEn: en("14:00"), salidaProgramadaEn: en("22:00") });
    expect(r.habitacion.estado).toBe("OCUPADA");
    expect(r.cotizacion.total).toBe(3000);
  });

  it("RN-27 / RN-28: no ingresa a una habitación ocupada (T-15)", () => {
    expect(() => ingresar({ habitacion: ocupada })).toThrow(codigo("ROOM_NOT_AVAILABLE"));
  });

  it("RN-32: no ingresa sin turno abierto", () => {
    expect(() => ingresar({ turno: turnoCerrado })).toThrow(codigo("SHIFT_NOT_OPEN"));
  });

  it("RN-43: copia la configuración vigente; cambiarla después no altera el alquiler", () => {
    const parametros = { ...PARAMETROS };
    const r = ingresar({ parametros });
    parametros.minutosCortesia = 5;
    expect(r.alquiler.parametrosAplicados.minutosCortesia).toBe(15);
  });

  it("RN-44: guarda el precio pactado de la habitación", () => {
    const r = ingresar();
    expect(r.alquiler.precioHabitacionAplicado).toBe(3000);
    expect(r.alquiler.origenPrecio).toBe("LISTA");
  });

  it("RN-08 caso a: horas al ingreso quedan en el alquiler, sin registro de hora adicional (T-16)", () => {
    const r = ingresar({ horasAdicionalesAlIngreso: 2 });
    expect(r.alquiler.horasAdicionalesAlIngreso).toBe(2);
    expect(r.alquiler.salidaProgramadaEn).toBe(en("00:00", 24));
    expect(r.cotizacion.total).toBe(4600);
  });
});

describe("Hora adicional (CU-05)", () => {
  it("actualiza la salida y la cortesía del alquiler, y cotiza S/ 8.00", () => {
    const r = registrarHoraAdicional(alquilerConSalida("16:00"), turnoAbierto(), en("16:20"));
    expect(r.alquiler.salidaProgramadaEn).toBe(en("17:20"));
    expect(r.alquiler.cortesiaConsumida).toBe(true);
    expect(r.cotizacion.total).toBe(800);
  });

  it("RN-32: no cobra sin turno abierto", () => {
    expect(() => registrarHoraAdicional(alquiler(), turnoCerrado, en("20:00"))).toThrow(codigo("SHIFT_NOT_OPEN"));
  });

  it("no cobra sobre un alquiler cerrado", () => {
    const cerrado = alquiler({ estado: "CERRADO", cerradoEn: en("20:00"), cerradoPorId: "cajero-1" });
    expect(() => registrarHoraAdicional(cerrado, turnoAbierto(), en("20:30"))).toThrow(codigo("RENTAL_NOT_OPEN"));
  });
});

describe("RN-02 · salida anticipada sin devolución", () => {
  it("2 horas antes: se cierra sin cargo y sin devolución (T-05)", () => {
    const r = registrarSalida(alquiler(), ocupada, { usuarioId: "cajero-1", ahora: en("20:00") });
    expect(r.alquiler).toMatchObject({ estado: "CERRADO", cerradoEn: en("20:00"), salidaSinPago: false });
    expect(r).not.toHaveProperty("devolucion");
  });
});

describe("RN-12 · no se cierra en sobretiempo sin resolverlo", () => {
  it("a la hora exacta y en cortesía se cierra sin cargo (T-02, T-03)", () => {
    expect(registrarSalida(alquiler(), ocupada, { usuarioId: "cajero-1", ahora: en("22:00") }).alquiler.estado).toBe("CERRADO");
    expect(registrarSalida(alquiler(), ocupada, { usuarioId: "cajero-1", ahora: en("22:10") }).alquiler.estado).toBe("CERRADO");
  });

  it("en sobretiempo se rechaza con OVERTIME_UNRESOLVED (T-14, RF-14)", () => {
    expect(() => registrarSalida(alquiler(), ocupada, { usuarioId: "cajero-1", ahora: en("22:20") })).toThrow(
      codigo("OVERTIME_UNRESOLVED"),
    );
  });

  it("tras pagar la hora ya puede salir (escenario 31.2)", () => {
    const pagado = registrarHoraAdicional(alquiler(), turnoAbierto(), en("22:20")).alquiler;
    expect(calcularEstadoTemporal(pagado, en("23:10"))).toBe("POR_VENCER");
    expect(registrarSalida(pagado, ocupada, { usuarioId: "cajero-1", ahora: en("23:10") }).alquiler.estado).toBe("CERRADO");
  });

  it("salida sin pago en sobretiempo, con motivo (CU-07, RF-15)", () => {
    const r = registrarSalidaSinPago(alquiler(), ocupada, {
      usuarioId: "cajero-1",
      ahora: en("23:00"),
      motivo: "cliente se retiró sin avisar",
    });
    expect(r.alquiler).toMatchObject({ estado: "CERRADO", salidaSinPago: true, motivoSalidaSinPago: "cliente se retiró sin avisar" });
  });

  it("la salida sin pago exige motivo", () => {
    expect(() => registrarSalidaSinPago(alquiler(), ocupada, { usuarioId: "cajero-1", ahora: en("23:00"), motivo: "" })).toThrow(
      codigo("REASON_REQUIRED"),
    );
  });

  it("la salida sin pago solo aplica en sobretiempo", () => {
    expect(() =>
      registrarSalidaSinPago(alquiler(), ocupada, { usuarioId: "cajero-1", ahora: en("22:05"), motivo: "x" }),
    ).toThrow(codigo("INVALID_STATE_TRANSITION"));
  });
});

describe("RN-29 · la salida manda la habitación a limpieza", () => {
  it("la habitación queda PENDIENTE_LIMPIEZA", () => {
    expect(registrarSalida(alquiler(), ocupada, { usuarioId: "cajero-1", ahora: en("20:00") }).habitacion.estado).toBe(
      "PENDIENTE_LIMPIEZA",
    );
  });
});

describe("Anulación de una hora adicional (§32, decisión de domain)", () => {
  function hora(id: string, tipo: HoraAdicional["tipo"], pagadaEn: string, salidaAnterior: string, salidaNueva: string): HoraAdicional {
    return { id, alquilerId: "alq-1", ticketId: `t-${id}`, tipo, salidaAnterior, salidaNueva, creadoPorId: "cajero-1", creadoEn: pagadaEn };
  }
  // Base 22:00. Dos extensiones anticipadas: 22:00 → 23:00 → 00:00.
  const primera = hora("h1", "EXTENSION_ANTICIPADA", en("20:00"), en("22:00"), en("23:00"));
  const segunda = hora("h2", "EXTENSION_ANTICIPADA", en("20:30"), en("23:00"), en("00:00", 24));
  const extendido = alquiler({ salidaProgramadaEn: en("00:00", 24) });

  it("anular la segunda deja la salida base + la hora vigente: 23:00, sin el tiempo de la anulada", () => {
    expect(aplicarAnulacionHoraAdicional(extendido, [primera]).salidaProgramadaEn).toBe(en("23:00"));
  });

  it("el orden no importa: anular la primera también deja 23:00", () => {
    expect(aplicarAnulacionHoraAdicional(extendido, [segunda]).salidaProgramadaEn).toBe(en("23:00"));
  });

  it("sin horas vigentes vuelve a la salida base", () => {
    expect(aplicarAnulacionHoraAdicional(extendido, []).salidaProgramadaEn).toBe(en("22:00"));
  });

  it("la salida base incluye las horas pagadas al ingreso", () => {
    const conHoras = alquiler({ horasAdicionalesAlIngreso: 2, salidaProgramadaEn: en("01:00", 24) });
    expect(aplicarAnulacionHoraAdicional(conHoras, []).salidaProgramadaEn).toBe(en("00:00", 24));
  });

  it("una liquidación vigente conserva su salida desde el pago (RN-06)", () => {
    // Liquidación pagada 22:30 → 23:30; anticipada 23:00 → 00:30. Se anula la anticipada.
    const liquidacion = hora("h3", "LIQUIDACION_SOBRETIEMPO", en("22:30"), en("22:00"), en("23:30"));
    const conLiquidacion = alquiler({ salidaProgramadaEn: en("00:30", 24), cortesiaConsumida: true });
    const r = aplicarAnulacionHoraAdicional(conLiquidacion, [liquidacion]);
    expect(r.salidaProgramadaEn).toBe(en("23:30"));
    expect(r.cortesiaConsumida).toBe(true);
  });

  it("un alquiler cerrado no se modifica", () => {
    const cerrado = alquiler({ estado: "CERRADO", salidaProgramadaEn: en("23:00"), cerradoEn: en("22:30"), cerradoPorId: "cajero-1" });
    expect(aplicarAnulacionHoraAdicional(cerrado, [])).toBe(cerrado);
  });

  it("rechaza horas de otro alquiler", () => {
    expect(() => aplicarAnulacionHoraAdicional(extendido, [{ ...primera, alquilerId: "otro" }])).toThrow(RangeError);
  });
});

describe("Anulación del ingreso (RF-30, escenario 31.5)", () => {
  it("el alquiler queda ANULADO y la habitación LIBRE", () => {
    const r = aplicarAnulacionIngreso(alquiler(), ocupada, 0);
    expect(r.alquiler.estado).toBe("ANULADO");
    expect(r.habitacion.estado).toBe("LIBRE");
  });

  it("exige anular primero las horas adicionales vigentes", () => {
    expect(() => aplicarAnulacionIngreso(alquiler(), ocupada, 1)).toThrow(codigo("INVALID_STATE_TRANSITION"));
  });

  it("solo sobre un alquiler abierto", () => {
    const cerrado = alquiler({ estado: "CERRADO", cerradoEn: en("20:00"), cerradoPorId: "cajero-1" });
    expect(() => aplicarAnulacionIngreso(cerrado, ocupada, 0)).toThrow(codigo("RENTAL_NOT_OPEN"));
  });
});
