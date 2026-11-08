import type { EstadoActualizacion, ManifiestoVersion, ResultadoInstalacion } from "@apurimeno/contracts";
import { describe, expect, it } from "vitest";
import { compararVersiones, exigirVersionInstalable, versionDisponible } from "../src/index.js";

const manifiesto = (version: string, ultimaCompleta: string): ManifiestoVersion => ({
  version,
  commit: "a".repeat(40),
  instaladorPos: { nombre: `ElApurimeno-POS-${version}.msi`, sha256: "A".repeat(64) },
  notas: "Arreglos en la tienda",
  ultimaCompleta,
  publicadaEn: "2026-11-06T12:00:00.000Z",
});

describe("compararVersiones", () => {
  it("compara números, no texto", () => {
    expect(compararVersiones("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compararVersiones("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compararVersiones("1.2.3", "1.2.3")).toBe(0);
    expect(compararVersiones("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });

  it("una versión mal escrita es un defecto", () => {
    expect(() => compararVersiones("1.2", "1.2.3")).toThrow(RangeError);
    expect(() => compararVersiones("1.x.3", "1.2.3")).toThrow(RangeError);
  });
});

describe("exigirVersionInstalable (decisión 30)", () => {
  const disponible = { version: "0.4.0", notas: "Nota", completa: false, publicadaEn: "2026-11-06T12:00:00.000Z" };
  const estado = (extra: Partial<EstadoActualizacion> = {}): EstadoActualizacion => ({
    estado: "DISPONIBLE",
    instalada: "0.3.0",
    disponible,
    ultimaRevisionEn: null,
    ultimaInstalacion: null,
    ...extra,
  });
  const instalacion = (resultado: ResultadoInstalacion) => ({
    resultado,
    version: "0.4.0",
    mensaje: null,
    actualizadaEn: "2026-11-06T12:00:00.000Z",
  });

  it("acepta la versión disponible, también después de un intento fallido", () => {
    expect(() => exigirVersionInstalable(estado(), "0.4.0")).not.toThrow();
    expect(() => exigirVersionInstalable(estado({ ultimaInstalacion: instalacion("ERROR") }), "0.4.0")).not.toThrow();
    expect(() => exigirVersionInstalable(estado({ ultimaInstalacion: instalacion("CORTADA") }), "0.4.0")).not.toThrow();
  });

  it("rechaza otra versión, o si no hay ninguna disponible", () => {
    expect(() => exigirVersionInstalable(estado(), "0.5.0")).toThrow(expect.objectContaining({ codigo: "INVALID_STATE_TRANSITION" }));
    expect(() => exigirVersionInstalable(estado({ estado: "AL_DIA", disponible: null }), "0.4.0")).toThrow(/no está disponible/);
  });

  it("rechaza si ya hay una en curso", () => {
    expect(() => exigirVersionInstalable(estado({ ultimaInstalacion: instalacion("EN_CURSO") }), "0.4.0")).toThrow(/en curso/);
  });
});

describe("versionDisponible (decisión 30)", () => {
  it("no ofrece la misma versión ni una anterior", () => {
    expect(versionDisponible("0.3.0", manifiesto("0.3.0", "0.1.0"))).toBeNull();
    expect(versionDisponible("0.3.0", manifiesto("0.2.0", "0.1.0"))).toBeNull();
  });

  it("es rápida si la instalada ya tiene la última versión que detuvo los servicios", () => {
    expect(versionDisponible("0.3.0", manifiesto("0.4.0", "0.3.0"))).toEqual({
      version: "0.4.0",
      notas: "Arreglos en la tienda",
      completa: false,
      publicadaEn: "2026-11-06T12:00:00.000Z",
    });
  });

  it("es completa si la propia versión la exige", () => {
    expect(versionDisponible("0.3.0", manifiesto("0.4.0", "0.4.0"))?.completa).toBe(true);
  });

  it("es completa si el local se salta una versión que la exigía", () => {
    expect(versionDisponible("0.3.0", manifiesto("0.5.0", "0.4.0"))?.completa).toBe(true);
  });
});
