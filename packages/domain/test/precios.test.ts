import type { PrecioEspecialCliente } from "@apurimeno/contracts";
import { describe, expect, it } from "vitest";
import {
  aplicarAjustePuntual,
  cotizarHoraAdicional,
  cotizarIngreso,
  cotizarVenta,
  precioProducto,
  resolverPrecioHabitacion,
} from "../src/index.js";
import { PARAMETROS, alquiler, en, habitacion, producto } from "./fixtures.js";

const especial205: PrecioEspecialCliente = {
  id: "pe-1",
  clienteId: "cli-juan",
  habitacionId: "hab-205",
  precio: 5000,
  creadoPorId: "admin-1",
  creadoEn: en("09:00"),
};

function ingreso(parcial: Partial<Parameters<typeof cotizarIngreso>[0]> = {}) {
  return cotizarIngreso({
    habitacion: habitacion(),
    clienteId: null,
    preciosEspeciales: [],
    parametros: PARAMETROS,
    horasAdicionalesAlIngreso: 0,
    ...parcial,
  });
}

describe("RN-13 · precio individual por habitación", () => {
  it("ingreso normal a una habitación de S/ 30.00 → total S/ 30.00 (T-01)", () => {
    const c = ingreso();
    expect(c.total).toBe(3000);
    expect(c.origenPrecio).toBe("LISTA");
  });

  it("cada habitación cobra su propio precio de lista", () => {
    expect(ingreso({ habitacion: habitacion({ id: "hab-105", numero: "105", precioBase: 4000 }) }).total).toBe(4000);
  });
});

describe("RN-14 · el precio especial reemplaza al de lista", () => {
  it("cliente con precio especial de S/ 50.00 → total S/ 50.00, no 30 + 50 (T-08)", () => {
    const c = ingreso({ clienteId: "cli-juan", preciosEspeciales: [especial205] });
    expect(c.total).toBe(5000);
    expect(c.origenPrecio).toBe("PRECIO_ESPECIAL");
  });

  it("sin cliente identificado no se aplica ningún precio especial (CU-04 A1)", () => {
    expect(resolverPrecioHabitacion(habitacion(), null, [especial205]).origenPrecio).toBe("LISTA");
  });
});

describe("RN-15 · el precio especial no se extiende a otras habitaciones", () => {
  it("el mismo cliente en otra habitación paga el precio de lista (T-09)", () => {
    const otra = habitacion({ id: "hab-202", numero: "202", precioBase: 3000 });
    const c = ingreso({ habitacion: otra, clienteId: "cli-juan", preciosEspeciales: [especial205] });
    expect(c.total).toBe(3000);
    expect(c.origenPrecio).toBe("LISTA");
  });

  it("el precio especial de otro cliente no se aplica", () => {
    expect(resolverPrecioHabitacion(habitacion(), "cli-otro", [especial205]).origenPrecio).toBe("LISTA");
  });
});

describe("RN-08 caso a · horas pagadas al ingreso", () => {
  it("S/ 30.00 + 2 × S/ 8.00 = S/ 46.00, en una línea de horas adicionales (T-16, RF-64)", () => {
    const c = ingreso({ horasAdicionalesAlIngreso: 2 });
    expect(c.total).toBe(4600);
    expect(c.lineas).toEqual([
      expect.objectContaining({ tipo: "BASE_HABITACION", importe: 3000 }),
      expect.objectContaining({ tipo: "HORA_ADICIONAL", cantidad: 2, precioUnitario: 800, importe: 1600 }),
    ]);
  });
});

describe("RN-10 · precio fijo de la hora adicional", () => {
  it("S/ 8.00 sin importar el precio de la habitación ni el precio especial", () => {
    const cara = alquiler({ precioHabitacionAplicado: 4000, origenPrecio: "PRECIO_ESPECIAL", clienteId: "cli-juan" });
    expect(cotizarHoraAdicional(cara).total).toBe(800);
  });

  it("usa el precio copiado al ingreso, no la configuración actual (RN-43)", () => {
    expect(cotizarHoraAdicional(alquiler({ parametrosAplicados: { ...PARAMETROS, precioHoraAdicional: 900 } })).total).toBe(900);
  });
});

describe("RN-17 · ajuste puntual con motivo obligatorio", () => {
  it("rechaza un ajuste sin motivo o con solo espacios", () => {
    expect(() => aplicarAjustePuntual(ingreso(), 4000, "   ")).toThrow(expect.objectContaining({ codigo: "REASON_REQUIRED" }));
  });
});

describe("RN-18 · el ajuste nunca baja del precio calculado", () => {
  it("S/ 30.00 → S/ 40.00 con motivo: total S/ 40.00 y línea de ajuste de S/ 10.00 (T-10)", () => {
    const c = aplicarAjustePuntual(ingreso(), 4000, "cliente ingresó solo");
    expect(c.total).toBe(4000);
    expect(c.ajustePuntual).toEqual({ montoOriginal: 3000, montoAjustado: 4000, motivo: "cliente ingresó solo" });
    expect(c.lineas.at(-1)).toMatchObject({ tipo: "AJUSTE_PUNTUAL", importe: 1000 });
  });

  it("S/ 30.00 → S/ 25.00 se rechaza (T-11, RF-20)", () => {
    expect(() => aplicarAjustePuntual(ingreso(), 2500, "descuento")).toThrow(
      expect.objectContaining({ codigo: "ADJUSTMENT_BELOW_MINIMUM" }),
    );
  });

  it("el mínimo es el precio especial cuando aplica", () => {
    const conEspecial = ingreso({ clienteId: "cli-juan", preciosEspeciales: [especial205] });
    expect(() => aplicarAjustePuntual(conEspecial, 4000, "x")).toThrow(
      expect.objectContaining({ codigo: "ADJUSTMENT_BELOW_MINIMUM" }),
    );
  });
});

describe("RN-19 · el ajuste solo afecta esa transacción", () => {
  it("la cotización original no cambia y la siguiente visita vuelve a S/ 30.00", () => {
    const original = ingreso();
    aplicarAjustePuntual(original, 4000, "cliente ingresó solo");
    expect(original.total).toBe(3000);
    expect(original.ajustePuntual).toBeNull();
    expect(ingreso().total).toBe(3000);
  });
});

describe("RN-37 · dinero en céntimos enteros", () => {
  it("rechaza montos con decimales", () => {
    expect(() => aplicarAjustePuntual(ingreso(), 3050.5, "x")).toThrow(RangeError);
  });
});

describe("RN-38 · las líneas no llevan datos del cliente", () => {
  it("la descripción solo menciona la habitación y las horas", () => {
    const c = ingreso({ clienteId: "cli-juan", preciosEspeciales: [especial205], horasAdicionalesAlIngreso: 1 });
    expect(c.lineas.map((l) => l.descripcion)).toEqual(["Habitación 205 — 8 horas", "Horas adicionales"]);
  });
});

describe("RN-20 · dos precios por producto", () => {
  it("precio de huésped y precio de público", () => {
    expect(precioProducto(producto(), true)).toBe(300);
    expect(precioProducto(producto(), false)).toBe(350);
  });
});

describe("RN-22 · huésped si hay un alquiler abierto asociado", () => {
  it("venta asociada a un huésped → precio de huésped (T-12)", () => {
    expect(cotizarVenta([{ producto: producto(), cantidad: 2 }], true).total).toBe(600);
  });

  it("venta sin habitación asociada → precio de público (T-13)", () => {
    expect(cotizarVenta([{ producto: producto(), cantidad: 2 }], false).total).toBe(700);
  });

  it("la cantidad debe ser un entero positivo (RF-21)", () => {
    expect(() => cotizarVenta([{ producto: producto(), cantidad: 0 }], false)).toThrow(RangeError);
  });
});
