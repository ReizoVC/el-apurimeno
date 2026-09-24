import { describe, expect, it } from "vitest";
import {
  aplicarVentaAInventario,
  armarTicketCobro,
  cotizarVenta,
  pagoSinVuelto,
  reponerStock,
  revertirVentaEnInventario,
} from "../src/index.js";
import { EFECTIVO, contexto, en, producto, turnoAbierto } from "./fixtures.js";

const codigo = (c: string) => expect.objectContaining({ codigo: c });

describe("RN-21 · stock único para los dos precios", () => {
  it("10 en stock, se venden 3 → quedan 7, con su movimiento de kardex (RF-24)", () => {
    const efecto = aplicarVentaAInventario([{ producto: producto(), cantidad: 3 }], false);
    expect(efecto.productos[0]?.stock).toBe(7);
    expect(efecto.movimientos).toEqual([{ productoId: "prod-gaseosa", tipo: "VENTA", cantidad: -3 }]);
  });
});

describe("RN-26 · sin stock negativo salvo configuración", () => {
  it("2 en stock y se piden 5 → INSUFFICIENT_STOCK, indicando lo disponible (RF-25)", () => {
    expect(() => aplicarVentaAInventario([{ producto: producto({ stock: 2 }), cantidad: 5 }], false)).toThrow(
      expect.objectContaining({ codigo: "INSUFFICIENT_STOCK", message: expect.stringContaining("disponible 2") }),
    );
  });

  it("suma el mismo producto repetido en varias líneas", () => {
    const p = producto({ stock: 3 });
    expect(() => aplicarVentaAInventario([{ producto: p, cantidad: 2 }, { producto: p, cantidad: 2 }], false)).toThrow(
      codigo("INSUFFICIENT_STOCK"),
    );
  });

  it("con la configuración que lo autoriza, el stock puede quedar negativo", () => {
    expect(aplicarVentaAInventario([{ producto: producto({ stock: 2 }), cantidad: 5 }], true).productos[0]?.stock).toBe(-3);
  });

  it("un producto sin control de stock se vende sin verificar ni mover kardex (§32)", () => {
    const servicio = producto({ controlaStock: false, stock: 0 });
    expect(aplicarVentaAInventario([{ producto: servicio, cantidad: 9 }], false)).toEqual({ productos: [], movimientos: [] });
  });
});

describe("RN-25 · ingreso de mercadería", () => {
  it("suma exactamente lo ingresado (RF-35)", () => {
    const efecto = reponerStock(producto(), 24);
    expect(efecto.productos[0]?.stock).toBe(34);
    expect(efecto.movimientos).toEqual([{ productoId: "prod-gaseosa", tipo: "REPOSICION", cantidad: 24 }]);
  });

  it("la cantidad debe ser positiva", () => {
    expect(() => reponerStock(producto(), 0)).toThrow(RangeError);
  });
});

describe("RF-30 · anular una venta restituye el stock", () => {
  it("devuelve las unidades vendidas con un movimiento ANULACION_VENTA", () => {
    const p = producto();
    const venta = armarTicketCobro(
      {
        numero: 1,
        origen: "VENTA_TIENDA",
        turno: turnoAbierto(),
        alquilerId: null,
        habitacionReferenciaId: null,
        cotizacion: cotizarVenta([{ producto: p, cantidad: 3 }], false),
        pagos: [pagoSinVuelto(EFECTIVO.id, 1050, null)],
        creadoPorId: "cajero-1",
      },
      contexto(en("12:00")),
    );
    const efecto = revertirVentaEnInventario(venta, [{ ...p, stock: 7 }]);
    expect(efecto.productos[0]?.stock).toBe(10);
    expect(efecto.movimientos).toEqual([{ productoId: p.id, tipo: "ANULACION_VENTA", cantidad: 3 }]);
  });
});
