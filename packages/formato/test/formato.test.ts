import { describe, expect, it } from "vitest";
import {
  aTextoSoles,
  diaLima,
  diasEntre,
  duracion,
  fechaHora,
  fechaHoraCorta,
  hace,
  hora,
  inicioDiaLima,
  leerSoles,
  nombreDia,
  periodoDeDias,
  soles,
  sumarDias,
} from "../src/index.js";

describe("Dinero", () => {
  it("muestra céntimos como soles, con signo", () => {
    expect(soles(2500)).toBe("S/ 25.00");
    expect(soles(5)).toBe("S/ 0.05");
    expect(soles(-500)).toBe("-S/ 5.00");
    expect(aTextoSoles(4050)).toBe("40.50");
  });

  it("lee montos escritos a mano, con punto o coma", () => {
    expect(leerSoles("40")).toBe(4000);
    expect(leerSoles(" 40.5 ")).toBe(4050);
    expect(leerSoles("40,05")).toBe(4005);
    for (const malo of ["", "-1", "4.005", "abc", "1e3"]) expect(leerSoles(malo)).toBeNull();
  });
});

describe("Días de Lima (UTC−5)", () => {
  it("las 03:00 UTC del 24 son todavía el 23; las 05:00, ya el 24", () => {
    expect(diaLima("2026-09-24T03:00:00.000Z")).toBe("2026-09-23");
    expect(diaLima(new Date("2026-09-24T05:00:00.000Z"))).toBe("2026-09-24");
  });

  it("un día empieza a las 05:00 UTC y un periodo cubre sus días completos", () => {
    expect(inicioDiaLima("2026-09-23").toISOString()).toBe("2026-09-23T05:00:00.000Z");
    expect(periodoDeDias("2026-09-23", "2026-09-24")).toEqual({
      desde: "2026-09-23T05:00:00.000Z",
      hasta: "2026-09-25T05:00:00.000Z",
    });
  });

  it("suma días cruzando meses y años, y lista los días de un rango", () => {
    expect(sumarDias("2026-09-30", 1)).toBe("2026-10-01");
    expect(sumarDias("2027-01-01", -1)).toBe("2026-12-31");
    expect(diasEntre("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(diasEntre("2026-09-29", "2026-09-28")).toEqual([]);
  });

  it("rechaza días y fechas mal escritos", () => {
    expect(() => sumarDias("2026-13-40", 1)).toThrow(RangeError);
    expect(() => sumarDias("2026-02-30", 1)).toThrow(RangeError);
    expect(() => diaLima("ayer")).toThrow(RangeError);
  });
});

describe("Horas en pantalla", () => {
  const instante = "2026-09-26T19:05:00.000Z";

  it("en hora de Lima", () => {
    expect(hora(instante)).toBe("14:05");
    expect(fechaHora(instante)).toBe("26/09/2026, 14:05");
    expect(fechaHoraCorta(instante)).toBe("26/09, 14:05");
    expect(nombreDia("2026-09-26")).toBe("sáb, 26/09");
    expect(fechaHoraCorta("2026-09-27T04:30:00.000Z")).toBe("26/09, 23:30");
  });

  it("duraciones y el tiempo transcurrido", () => {
    expect(duracion(65 * 60_000)).toBe("1 h 05 min");
    expect(duracion(-12 * 60_000)).toBe("12 min");
    const ahora = new Date("2026-09-26T20:15:00.000Z");
    expect(hace("2026-09-26T20:14:50.000Z", ahora)).toBe("hace menos de un minuto");
    expect(hace("2026-09-26T20:03:00.000Z", ahora)).toBe("hace 12 min");
    expect(hace("2026-09-26T18:05:00.000Z", ahora)).toBe("hace 2 h 10 min");
    expect(hace("2026-09-23T20:15:00.000Z", ahora)).toBe("hace 3 días");
  });
});
