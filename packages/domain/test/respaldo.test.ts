import { describe, expect, it } from "vitest";
import {
  proximaCitaRespaldoExterno,
  proximaCopiaLocal,
  respaldoExternoDesactualizado,
  respaldoExternoPendiente,
  respaldoLocalDesactualizado,
  respaldosVencidos,
  ultimaCitaRespaldoExterno,
} from "../src/index.js";

// Lima es UTC−5: las 04:00 de Lima son las 09:00 UTC.
const lima = (fechaHora: string) => new Date(`${fechaHora}-05:00`);
const iso = (fechaHora: string) => lima(fechaHora).toISOString();

describe("Copia externa diaria a las 04:00 de Lima", () => {
  it("la cita más reciente es la de hoy desde las 04:00, y la de ayer antes", () => {
    expect(ultimaCitaRespaldoExterno(lima("2026-09-26T04:00:00"))).toEqual(lima("2026-09-26T04:00:00"));
    expect(ultimaCitaRespaldoExterno(lima("2026-09-26T23:59:00"))).toEqual(lima("2026-09-26T04:00:00"));
    expect(ultimaCitaRespaldoExterno(lima("2026-09-26T03:59:59"))).toEqual(lima("2026-09-25T04:00:00"));
    // Entre la medianoche UTC y las 04:00 de Lima: sigue siendo la de ayer.
    expect(ultimaCitaRespaldoExterno(lima("2026-09-26T00:30:00"))).toEqual(lima("2026-09-25T04:00:00"));
  });

  it("la próxima cita es siempre posterior, también a fin de mes", () => {
    expect(proximaCitaRespaldoExterno(lima("2026-09-26T04:00:00"))).toEqual(lima("2026-09-27T04:00:00"));
    expect(proximaCitaRespaldoExterno(lima("2026-09-26T03:00:00"))).toEqual(lima("2026-09-26T04:00:00"));
    expect(proximaCitaRespaldoExterno(lima("2026-09-30T22:00:00"))).toEqual(lima("2026-10-01T04:00:00"));
  });

  it("sin ninguna copia, está pendiente", () => {
    expect(respaldoExternoPendiente(null, lima("2026-09-26T10:00:00"))).toBe(true);
  });

  it("la copia de las 04:00 cubre hasta las 04:00 del día siguiente", () => {
    const copia = iso("2026-09-26T04:00:12");
    expect(respaldoExternoPendiente(copia, lima("2026-09-26T18:00:00"))).toBe(false);
    expect(respaldoExternoPendiente(copia, lima("2026-09-27T03:59:00"))).toBe(false);
    expect(respaldoExternoPendiente(copia, lima("2026-09-27T04:00:00"))).toBe(true);
  });

  it("si el servidor estaba apagado a las 04:00, está pendiente al encender", () => {
    // Última copia: ayer a las 04:00. Se enciende hoy a las 09:15.
    expect(respaldoExternoPendiente(iso("2026-09-25T04:00:05"), lima("2026-09-26T09:15:00"))).toBe(true);
  });

  it("una copia hecha fuera de hora (al encender, a pedido) cuenta hasta las próximas 04:00", () => {
    expect(respaldoExternoPendiente(iso("2026-09-26T09:15:30"), lima("2026-09-27T03:00:00"))).toBe(false);
    expect(respaldoExternoPendiente(iso("2026-09-26T09:15:30"), lima("2026-09-27T04:00:00"))).toBe(true);
  });

  it("se marca desactualizada una hora después de las 04:00 sin la copia del día", () => {
    const ayer = iso("2026-09-25T04:00:05");
    expect(respaldoExternoDesactualizado(ayer, lima("2026-09-26T04:30:00"))).toBe(false);
    expect(respaldoExternoDesactualizado(ayer, lima("2026-09-26T05:00:00"))).toBe(false);
    expect(respaldoExternoDesactualizado(ayer, lima("2026-09-26T05:01:00"))).toBe(true);
    expect(respaldoExternoDesactualizado(iso("2026-09-26T04:00:05"), lima("2026-09-26T23:00:00"))).toBe(false);
    expect(respaldoExternoDesactualizado(null, lima("2026-09-26T23:00:00"))).toBe(false);
  });
});

describe("Copias locales cada 15 minutos", () => {
  it("la primera va ya; las siguientes, 15 minutos después del último intento", () => {
    const ahora = lima("2026-09-26T10:00:00");
    expect(proximaCopiaLocal(null, ahora)).toEqual(ahora);
    expect(proximaCopiaLocal(iso("2026-09-26T09:50:00"), ahora)).toEqual(lima("2026-09-26T10:05:00"));
  });

  it("si el servidor estuvo apagado más de 15 minutos, va ya", () => {
    const ahora = lima("2026-09-26T10:00:00");
    expect(proximaCopiaLocal(iso("2026-09-26T08:00:00"), ahora)).toEqual(ahora);
  });

  it("se marcan desactualizadas tras dos intervalos sin copia (más de 30 minutos)", () => {
    const ultima = iso("2026-09-26T10:00:00");
    expect(respaldoLocalDesactualizado(ultima, lima("2026-09-26T10:30:00"))).toBe(false);
    expect(respaldoLocalDesactualizado(ultima, lima("2026-09-26T10:31:00"))).toBe(true);
  });
});

describe("Retención", () => {
  const horas = (h: number) => h * 3_600_000;
  const ahora = lima("2026-09-26T12:00:00");

  it("borra las que pasaron la retención y conserva el resto", () => {
    const copias = [
      { nombre: "a", creadoEn: iso("2026-09-25T11:45:00") },
      { nombre: "b", creadoEn: iso("2026-09-25T12:00:00") },
      { nombre: "c", creadoEn: iso("2026-09-25T12:15:00") },
      { nombre: "d", creadoEn: iso("2026-09-26T11:45:00") },
    ];
    expect(respaldosVencidos(copias, ahora, horas(24)).map((c) => c.nombre)).toEqual(["a"]);
  });

  it("nunca borra la copia más reciente, aunque sea vieja", () => {
    const copias = [
      { nombre: "vieja", creadoEn: iso("2026-08-01T04:00:00") },
      { nombre: "reciente-pero-vieja", creadoEn: iso("2026-08-20T04:00:00") },
    ];
    expect(respaldosVencidos(copias, ahora, horas(24 * 30)).map((c) => c.nombre)).toEqual(["vieja"]);
    expect(respaldosVencidos([copias[0]!], ahora, horas(24 * 30))).toEqual([]);
    expect(respaldosVencidos([], ahora, horas(24))).toEqual([]);
  });
});
