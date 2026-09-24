import { describe, expect, it } from "vitest";
import {
  bloquearPorMantenimiento,
  liberarPorAnulacion,
  liberarPorSalida,
  marcarHabitacionLista,
  ocuparHabitacion,
  reactivarHabitacion,
  reportarMantenimiento,
} from "../src/index.js";
import { habitacion } from "./fixtures.js";

const codigo = (c: string) => expect.objectContaining({ codigo: c });

describe("RN-28 · solo se inicia un alquiler sobre una habitación libre", () => {
  it("LIBRE → OCUPADA", () => {
    expect(ocuparHabitacion(habitacion()).estado).toBe("OCUPADA");
  });

  it.each(["OCUPADA", "PENDIENTE_LIMPIEZA", "MANTENIMIENTO"] as const)("%s → ROOM_NOT_AVAILABLE", (estado) => {
    expect(() => ocuparHabitacion(habitacion({ estado }))).toThrow(codigo("ROOM_NOT_AVAILABLE"));
  });
});

describe("RN-29 · la salida deja la habitación pendiente de limpieza", () => {
  it("OCUPADA → PENDIENTE_LIMPIEZA", () => {
    expect(liberarPorSalida(habitacion({ estado: "OCUPADA" })).estado).toBe("PENDIENTE_LIMPIEZA");
  });
});

describe("RN-30 · limpieza la marca lista, sin confirmación del cajero", () => {
  it("PENDIENTE_LIMPIEZA → LIBRE", () => {
    expect(marcarHabitacionLista(habitacion({ estado: "PENDIENTE_LIMPIEZA" })).estado).toBe("LIBRE");
  });

  it("no se puede marcar lista una habitación que no está pendiente de limpieza (§32)", () => {
    expect(() => marcarHabitacionLista(habitacion({ estado: "OCUPADA" }))).toThrow(codigo("INVALID_STATE_TRANSITION"));
  });
});

describe("RN-31 · mantenimiento", () => {
  it("limpieza reporta un daño: PENDIENTE_LIMPIEZA → MANTENIMIENTO (CU-17)", () => {
    expect(reportarMantenimiento(habitacion({ estado: "PENDIENTE_LIMPIEZA" })).estado).toBe("MANTENIMIENTO");
  });

  it("bloqueo administrativo de una habitación libre, con motivo (RF-38)", () => {
    expect(bloquearPorMantenimiento(habitacion(), "caño roto").estado).toBe("MANTENIMIENTO");
    expect(() => bloquearPorMantenimiento(habitacion(), " ")).toThrow(codigo("REASON_REQUIRED"));
  });

  it("no se bloquea una habitación ocupada (RF-38)", () => {
    expect(() => bloquearPorMantenimiento(habitacion({ estado: "OCUPADA" }), "caño roto")).toThrow(
      codigo("INVALID_STATE_TRANSITION"),
    );
  });

  it("solo la reactivación explícita la devuelve a LIBRE (RF-39)", () => {
    expect(reactivarHabitacion(habitacion({ estado: "MANTENIMIENTO" })).estado).toBe("LIBRE");
    expect(() => ocuparHabitacion(habitacion({ estado: "MANTENIMIENTO" }))).toThrow(codigo("ROOM_NOT_AVAILABLE"));
  });
});

describe("RF-30 · anular el ingreso libera la habitación (escenario 31.5)", () => {
  it("OCUPADA → LIBRE", () => {
    expect(liberarPorAnulacion(habitacion({ estado: "OCUPADA" })).estado).toBe("LIBRE");
  });
});

it("las funciones no modifican la habitación recibida", () => {
  const h = habitacion();
  ocuparHabitacion(h);
  expect(h.estado).toBe("LIBRE");
});
