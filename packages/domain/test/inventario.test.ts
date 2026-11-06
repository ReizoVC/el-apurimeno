import { describe, expect, it } from "vitest";
import {
  aplicarConteoStock,
  aplicarVentaAInventario,
  armarTicketCobro,
  cotizarVenta,
  pagoSinVuelto,
  registrarSalidaStock,
  reponerStock,
  revertirVentaEnInventario,
} from "../src/index.js";
import { EFECTIVO, contexto, en, producto, turnoAbierto } from "./fixtures.js";

const codigo = (c: string) => expect.objectContaining({ codigo: c });

describe("RN-21 · stock único para los dos precios", () => {
  it("10 en stock, se venden 3 → quedan 7, con su movimiento de kardex (RF-24)", () => {
    const efecto = aplicarVentaAInventario([{ producto: producto(), cantidad: 3 }], false, false);
    expect(efecto.productos[0]?.stock).toBe(7);
    expect(efecto.movimientos).toEqual([{ productoId: "prod-gaseosa", tipo: "VENTA", cantidad: -3 }]);
    expect(efecto.sinStock).toEqual([]);
  });
});

describe("RN-26 · sin stock negativo salvo configuración y confirmación (decisión 29)", () => {
  it("2 en stock y se piden 5 → INSUFFICIENT_STOCK, indicando lo disponible (RF-25)", () => {
    expect(() => aplicarVentaAInventario([{ producto: producto({ stock: 2 }), cantidad: 5 }], false, false)).toThrow(
      expect.objectContaining({ codigo: "INSUFFICIENT_STOCK", message: expect.stringContaining("disponible 2") }),
    );
  });

  it("suma el mismo producto repetido en varias líneas", () => {
    const p = producto({ stock: 3 });
    expect(() => aplicarVentaAInventario([{ producto: p, cantidad: 2 }, { producto: p, cantidad: 2 }], false, false)).toThrow(
      codigo("INSUFFICIENT_STOCK"),
    );
  });

  it("autorizada por la configuración, sin confirmar se rechaza", () => {
    expect(() => aplicarVentaAInventario([{ producto: producto({ stock: 2 }), cantidad: 5 }], true, false)).toThrow(
      expect.objectContaining({ codigo: "INSUFFICIENT_STOCK", message: expect.stringContaining("Confirme el aviso") }),
    );
  });

  it("confirmar no alcanza si la configuración no lo autoriza", () => {
    expect(() => aplicarVentaAInventario([{ producto: producto({ stock: 2 }), cantidad: 5 }], false, true)).toThrow(
      expect.objectContaining({ codigo: "INSUFFICIENT_STOCK", message: expect.stringContaining("desactivada") }),
    );
  });

  it("autorizada y confirmada, el stock queda negativo e informa qué se vendió sin stock", () => {
    const efecto = aplicarVentaAInventario([{ producto: producto({ stock: 2 }), cantidad: 5 }], true, true);
    expect(efecto.productos[0]?.stock).toBe(-3);
    expect(efecto.sinStock).toEqual([{ productoId: "prod-gaseosa", nombre: producto().nombre, stockPrevio: 2, cantidad: 5 }]);
  });

  it("confirmar no marca como sin stock lo que sí alcanza", () => {
    expect(aplicarVentaAInventario([{ producto: producto({ stock: 5 }), cantidad: 5 }], true, true).sinStock).toEqual([]);
  });

  it("un producto sin control de stock se vende sin verificar ni mover kardex (§32)", () => {
    const servicio = producto({ controlaStock: false, stock: 0 });
    expect(aplicarVentaAInventario([{ producto: servicio, cantidad: 9 }], false, false)).toEqual({ productos: [], movimientos: [], sinStock: [] });
  });
});

describe("Salida de mercadería (decisión 29)", () => {
  it("resta lo indicado y guarda el motivo limpio", () => {
    const efecto = registrarSalidaStock(producto(), 4, "  Vencido ");
    expect(efecto.productos[0]?.stock).toBe(6);
    expect(efecto.movimientos).toEqual([{ productoId: "prod-gaseosa", tipo: "SALIDA", cantidad: -4, motivo: "Vencido" }]);
  });

  it("exige motivo", () => {
    expect(() => registrarSalidaStock(producto(), 1, "   ")).toThrow(codigo("REASON_REQUIRED"));
  });

  it("no saca más de lo que hay, aunque se permita vender sin stock", () => {
    expect(() => registrarSalidaStock(producto({ stock: 2 }), 3, "Dañado")).toThrow(codigo("INSUFFICIENT_STOCK"));
    expect(registrarSalidaStock(producto({ stock: 2 }), 2, "Dañado").productos[0]?.stock).toBe(0);
  });

  it("un producto sin control de stock no tiene salidas", () => {
    expect(() => registrarSalidaStock(producto({ controlaStock: false }), 1, "Dañado")).toThrow(codigo("INVALID_STATE_TRANSITION"));
  });
});

describe("Conteo físico (decisión 29)", () => {
  it("deja el stock en lo contado y guarda la diferencia con signo", () => {
    const menos = aplicarConteoStock(producto(), 7, "Faltaban en el estante");
    expect(menos.productos[0]?.stock).toBe(7);
    expect(menos.movimientos).toEqual([{ productoId: "prod-gaseosa", tipo: "CONTEO", cantidad: -3, motivo: "Faltaban en el estante" }]);
    expect(aplicarConteoStock(producto(), 12, null).movimientos[0]).toMatchObject({ cantidad: 2, motivo: null });
  });

  it("sin diferencia también queda el movimiento, y una nota vacía se guarda como null", () => {
    expect(aplicarConteoStock(producto(), 10, "  ").movimientos).toEqual([{ productoId: "prod-gaseosa", tipo: "CONTEO", cantidad: 0, motivo: null }]);
  });

  it("corrige un stock negativo", () => {
    const efecto = aplicarConteoStock(producto({ stock: -3 }), 0, null);
    expect(efecto.productos[0]?.stock).toBe(0);
    expect(efecto.movimientos[0]?.cantidad).toBe(3);
  });

  it("lo contado no puede ser negativo", () => {
    expect(() => aplicarConteoStock(producto(), -1, null)).toThrow(RangeError);
  });

  it("un producto sin control de stock no se cuenta", () => {
    expect(() => aplicarConteoStock(producto({ controlaStock: false }), 1, null)).toThrow(codigo("INVALID_STATE_TRANSITION"));
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
