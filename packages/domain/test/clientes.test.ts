import { describe, expect, it } from "vitest";
import { crearPrecioEspecial, editarPrecioEspecial, resolverPrecioHabitacion } from "../src/index.js";
import { contexto, en, habitacion } from "./fixtures.js";

const codigo = (c: string) => expect.objectContaining({ codigo: c });
const datos = { clienteId: "cli-juan", habitacionId: "hab-205", precio: 5000, creadoPorId: "admin" };

describe("RF-16 · alta de precio especial", () => {
  it("crea el precio para la combinación exacta, con autor y momento", () => {
    const p = crearPrecioEspecial(null, datos, contexto(en("10:00")));
    expect(p).toMatchObject({ ...datos, creadoEn: en("10:00") });
    expect(resolverPrecioHabitacion(habitacion(), "cli-juan", [p])).toEqual({ origenPrecio: "PRECIO_ESPECIAL", precio: 5000 });
  });

  it("si ya existe para ese cliente + habitación → CLIENT_ROOM_PRICE_ALREADY_EXISTS", () => {
    const existente = crearPrecioEspecial(null, datos, contexto(en("10:00")));
    expect(() => crearPrecioEspecial(existente, { ...datos, precio: 4500 }, contexto(en("11:00")))).toThrow(
      codigo("CLIENT_ROOM_PRICE_ALREADY_EXISTS"),
    );
  });

  it("el precio es un entero de céntimos no negativo (RN-37); cero se permite", () => {
    expect(crearPrecioEspecial(null, { ...datos, precio: 0 }, contexto(en("10:00"))).precio).toBe(0);
    expect(() => crearPrecioEspecial(null, { ...datos, precio: 12.5 }, contexto(en("10:00")))).toThrow(RangeError);
  });
});

describe("RF-18 · edición de precio especial", () => {
  it("cambia solo el monto; autor y fecha de alta se conservan", () => {
    const p = crearPrecioEspecial(null, datos, contexto(en("10:00")));
    expect(editarPrecioEspecial(p, 4000)).toEqual({ ...p, precio: 4000 });
  });

  it("rechaza un monto negativo", () => {
    const p = crearPrecioEspecial(null, datos, contexto(en("10:00")));
    expect(() => editarPrecioEspecial(p, -1)).toThrow(RangeError);
  });
});
