import { describe, expect, it } from "vitest";
import { calcularEstadoTemporal, calcularHoraAdicional, calcularSalidaInicial } from "../src/index.js";
import { PARAMETROS, alquiler, alquilerConSalida, en } from "./fixtures.js";

describe("RN-01 · duración base configurable", () => {
  it("ingreso 14:00 con 8 horas base → salida 22:00 (T-01, RF-03)", () => {
    expect(calcularSalidaInicial(en("14:00"), PARAMETROS, 0)).toBe(en("22:00"));
  });

  it("usa el valor configurado, no un 8 fijo", () => {
    expect(calcularSalidaInicial(en("14:00"), { ...PARAMETROS, horasBase: 6 }, 0)).toBe(en("20:00"));
  });
});

describe("RN-08 caso a · horas pagadas al ingreso", () => {
  it("base + 2 horas → salida 00:00 del día siguiente (T-16)", () => {
    expect(calcularSalidaInicial(en("14:00"), PARAMETROS, 2)).toBe(en("00:00", 24));
  });

  it("rechaza horas no enteras o negativas", () => {
    expect(() => calcularSalidaInicial(en("14:00"), PARAMETROS, 1.5)).toThrow(RangeError);
    expect(() => calcularSalidaInicial(en("14:00"), PARAMETROS, -1)).toThrow(RangeError);
  });
});

describe("RN-03 · aviso 10 minutos antes", () => {
  it("A_TIEMPO hasta antes de las 21:50, POR_VENCER desde las 21:50 hasta las 22:00", () => {
    expect(calcularEstadoTemporal(alquiler(), "2026-09-23T21:49:59.999Z")).toBe("A_TIEMPO");
    expect(calcularEstadoTemporal(alquiler(), en("21:50"))).toBe("POR_VENCER");
    expect(calcularEstadoTemporal(alquiler(), en("22:00"))).toBe("POR_VENCER");
  });
});

describe("RN-04 · cortesía de 15 minutos", () => {
  it("10 minutos tarde está en cortesía, sin cargo (T-03)", () => {
    expect(calcularEstadoTemporal(alquiler(), en("22:10"))).toBe("EN_CORTESIA");
  });

  it("el minuto 15 todavía es cortesía", () => {
    expect(calcularEstadoTemporal(alquiler(), en("22:15"))).toBe("EN_CORTESIA");
  });
});

describe("RN-05 · superada la cortesía, pagar o retirarse", () => {
  it("16 minutos tarde está en sobretiempo (T-04)", () => {
    expect(calcularEstadoTemporal(alquiler(), en("22:16"))).toBe("EN_SOBRETIEMPO");
  });
});

describe("RN-06 · la liquidación de sobretiempo cuenta desde el pago", () => {
  it("salida 16:00, pago 16:20 → nueva salida 17:20, no 17:00 (RF-10)", () => {
    const efecto = calcularHoraAdicional(alquilerConSalida("16:00"), en("16:20"));
    expect(efecto.tipo).toBe("LIQUIDACION_SOBRETIEMPO");
    expect(efecto.salidaAnterior).toBe(en("16:00"));
    expect(efecto.salidaNueva).toBe(en("17:20"));
  });
});

describe("RN-07 · la cortesía no se vuelve a otorgar", () => {
  it("liquidar un sobretiempo consume la cortesía (RF-11)", () => {
    const efecto = calcularHoraAdicional(alquilerConSalida("16:00"), en("16:20"));
    expect(efecto.cortesiaConsumida).toBe(true);
  });

  it("con la cortesía consumida, un minuto tarde ya es sobretiempo (T-07)", () => {
    expect(calcularEstadoTemporal(alquiler({ cortesiaConsumida: true }), en("22:01"))).toBe("EN_SOBRETIEMPO");
  });
});

describe("RN-08 caso b · extensión anticipada durante la estadía", () => {
  it("a las 15:30 con salida 16:00 → nueva salida 17:00, cortesía intacta (T-06, RF-10)", () => {
    const efecto = calcularHoraAdicional(alquilerConSalida("16:00"), en("15:30"));
    expect(efecto.tipo).toBe("EXTENSION_ANTICIPADA");
    expect(efecto.salidaNueva).toBe(en("17:00"));
    expect(efecto.cortesiaConsumida).toBe(false);
  });

  it("pagar en POR_VENCER tampoco consume la cortesía", () => {
    const efecto = calcularHoraAdicional(alquilerConSalida("16:00"), en("15:55"));
    expect(efecto.estadoTemporalAlPagar).toBe("POR_VENCER");
    expect(efecto.cortesiaConsumida).toBe(false);
  });
});

describe("Decisión 13 de contracts · hora adicional pagada en cortesía", () => {
  const enCortesia = alquilerConSalida("16:00");

  it("se suma como extensión anticipada a la salida vigente: 16:00 → 17:00, no 17:10", () => {
    const efecto = calcularHoraAdicional(enCortesia, en("16:10"));
    expect(efecto.estadoTemporalAlPagar).toBe("EN_CORTESIA");
    expect(efecto.tipo).toBe("EXTENSION_ANTICIPADA");
    expect(efecto.salidaNueva).toBe(en("17:00"));
  });

  it("la cortesía quedó consumida: pasarse de la nueva salida es sobretiempo inmediato", () => {
    const efecto = calcularHoraAdicional(enCortesia, en("16:10"));
    expect(efecto.cortesiaConsumida).toBe(true);
    const despues = alquiler({ salidaProgramadaEn: efecto.salidaNueva, cortesiaConsumida: efecto.cortesiaConsumida });
    expect(calcularEstadoTemporal(despues, en("17:01"))).toBe("EN_SOBRETIEMPO");
  });
});

describe("RN-09 · bloque de una hora completa", () => {
  it("cada hora adicional mueve la salida exactamente 60 minutos", () => {
    const anticipada = calcularHoraAdicional(alquiler(), en("20:00"));
    expect(Date.parse(anticipada.salidaNueva) - Date.parse(anticipada.salidaAnterior)).toBe(60 * 60_000);
  });
});

describe("RN-11 · el estado temporal se calcula, nunca se guarda", () => {
  it("el mismo alquiler da estados distintos según la hora del servidor", () => {
    const a = alquiler();
    expect(calcularEstadoTemporal(a, en("15:00"))).toBe("A_TIEMPO");
    expect(calcularEstadoTemporal(a, en("23:00"))).toBe("EN_SOBRETIEMPO");
  });

  it("solo aplica a alquileres abiertos", () => {
    expect(() => calcularEstadoTemporal(alquiler({ estado: "ANULADO" }), en("15:00"))).toThrow(
      expect.objectContaining({ codigo: "RENTAL_NOT_OPEN" }),
    );
  });
});

describe("RN-43 · los parámetros son los copiados al ingreso", () => {
  it("con una cortesía de 30 minutos copiada al ingreso, las 22:20 siguen siendo cortesía", () => {
    const a = alquiler({ parametrosAplicados: { ...PARAMETROS, minutosCortesia: 30 } });
    expect(calcularEstadoTemporal(a, en("22:20"))).toBe("EN_CORTESIA");
  });
});
