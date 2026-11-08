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

// Cantidades y stock en milésimas (decisión 31 de contracts): 3000 = 3 unidades.
const codigo = (c: string) => expect.objectContaining({ codigo: c });
const cable = (stock: number) => producto({ id: "prod-cable", nombre: "Cable mellizo", unidad: "METRO", stock });

describe("RN-21 · stock único para los dos precios", () => {
  it("10 en stock, se venden 3 → quedan 7, con su movimiento de kardex (RF-24)", () => {
    const efecto = aplicarVentaAInventario([{ producto: producto(), cantidad: 3000 }], false, false);
    expect(efecto.productos[0]?.stock).toBe(7000);
    expect(efecto.movimientos).toEqual([{ productoId: "prod-gaseosa", tipo: "VENTA", cantidad: -3000 }]);
    expect(efecto.sinStock).toEqual([]);
  });

  it("vende fracciones de un producto por metro (decisión 31)", () => {
    const efecto = aplicarVentaAInventario([{ producto: cable(10_000), cantidad: 2500 }], false, false);
    expect(efecto.productos[0]?.stock).toBe(7500);
  });
});

describe("RN-26 · sin stock negativo salvo configuración y confirmación (decisión 29)", () => {
  it("2 en stock y se piden 5 → INSUFFICIENT_STOCK, indicando lo disponible (RF-25)", () => {
    expect(() => aplicarVentaAInventario([{ producto: producto({ stock: 2000 }), cantidad: 5000 }], false, false)).toThrow(
      expect.objectContaining({ codigo: "INSUFFICIENT_STOCK", message: expect.stringContaining("disponible 2, solicitado 5") }),
    );
  });

  it("el aviso muestra la unidad: disponible 1.5 m", () => {
    expect(() => aplicarVentaAInventario([{ producto: cable(1500), cantidad: 2000 }], false, false)).toThrow(
      expect.objectContaining({ message: expect.stringContaining("disponible 1.5 m, solicitado 2 m") }),
    );
  });

  it("suma el mismo producto repetido en varias líneas", () => {
    const p = producto({ stock: 3000 });
    expect(() => aplicarVentaAInventario([{ producto: p, cantidad: 2000 }, { producto: p, cantidad: 2000 }], false, false)).toThrow(
      codigo("INSUFFICIENT_STOCK"),
    );
  });

  it("autorizada por la configuración, sin confirmar se rechaza", () => {
    expect(() => aplicarVentaAInventario([{ producto: producto({ stock: 2000 }), cantidad: 5000 }], true, false)).toThrow(
      expect.objectContaining({ codigo: "INSUFFICIENT_STOCK", message: expect.stringContaining("Confirme el aviso") }),
    );
  });

  it("confirmar no alcanza si la configuración no lo autoriza", () => {
    expect(() => aplicarVentaAInventario([{ producto: producto({ stock: 2000 }), cantidad: 5000 }], false, true)).toThrow(
      expect.objectContaining({ codigo: "INSUFFICIENT_STOCK", message: expect.stringContaining("desactivada") }),
    );
  });

  it("autorizada y confirmada, el stock queda negativo e informa qué se vendió sin stock", () => {
    const efecto = aplicarVentaAInventario([{ producto: producto({ stock: 2000 }), cantidad: 5000 }], true, true);
    expect(efecto.productos[0]?.stock).toBe(-3000);
    expect(efecto.sinStock).toEqual([{ productoId: "prod-gaseosa", nombre: producto().nombre, stockPrevio: 2000, cantidad: 5000 }]);
  });

  it("confirmar no marca como sin stock lo que sí alcanza", () => {
    expect(aplicarVentaAInventario([{ producto: producto({ stock: 5000 }), cantidad: 5000 }], true, true).sinStock).toEqual([]);
  });

  it("un producto sin control de stock se vende sin verificar ni mover kardex (§32)", () => {
    const servicio = producto({ controlaStock: false, stock: 0 });
    expect(aplicarVentaAInventario([{ producto: servicio, cantidad: 9000 }], false, false)).toEqual({ productos: [], movimientos: [], sinStock: [] });
  });

  it("un producto por unidad no se vende en fracciones (decisión 31)", () => {
    expect(() => aplicarVentaAInventario([{ producto: producto(), cantidad: 500 }], false, false)).toThrow(codigo("INVALID_QUANTITY"));
  });
});

describe("Salida de mercadería (decisiones 29 y 31)", () => {
  it("resta lo indicado con su motivo fijo, y un detalle opcional limpio", () => {
    const efecto = registrarSalidaStock(producto(), 4000, "VENCIDO", "  Lote de agosto ");
    expect(efecto.productos[0]?.stock).toBe(6000);
    expect(efecto.movimientos).toEqual([
      { productoId: "prod-gaseosa", tipo: "SALIDA", cantidad: -4000, motivoSalida: "VENCIDO", motivo: "Lote de agosto" },
    ]);
    expect(registrarSalidaStock(producto(), 1000, "DANADO", "  ").movimientos[0]).toMatchObject({ motivoSalida: "DANADO", motivo: null });
  });

  it("el motivo OTRO exige el detalle", () => {
    expect(() => registrarSalidaStock(producto(), 1000, "OTRO", "   ")).toThrow(codigo("REASON_REQUIRED"));
    expect(registrarSalidaStock(producto(), 1000, "OTRO", "Muestra").movimientos[0]).toMatchObject({ motivo: "Muestra" });
  });

  it("no saca más de lo que hay, aunque se permita vender sin stock", () => {
    expect(() => registrarSalidaStock(producto({ stock: 2000 }), 3000, "DANADO", null)).toThrow(codigo("INSUFFICIENT_STOCK"));
    expect(registrarSalidaStock(producto({ stock: 2000 }), 2000, "DANADO", null).productos[0]?.stock).toBe(0);
  });

  it("saca fracciones de un producto por metro, pero no de uno por unidad", () => {
    expect(registrarSalidaStock(cable(3000), 250, "CONSUMO_INTERNO", null).productos[0]?.stock).toBe(2750);
    expect(() => registrarSalidaStock(producto(), 250, "CONSUMO_INTERNO", null)).toThrow(codigo("INVALID_QUANTITY"));
  });

  it("un producto sin control de stock no tiene salidas", () => {
    expect(() => registrarSalidaStock(producto({ controlaStock: false }), 1000, "DANADO", null)).toThrow(codigo("INVALID_STATE_TRANSITION"));
  });
});

describe("Conteo físico (decisión 29)", () => {
  it("deja el stock en lo contado y guarda la diferencia con signo", () => {
    const menos = aplicarConteoStock(producto(), 7000, "Faltaban en el estante");
    expect(menos.productos[0]?.stock).toBe(7000);
    expect(menos.movimientos).toEqual([{ productoId: "prod-gaseosa", tipo: "CONTEO", cantidad: -3000, motivo: "Faltaban en el estante" }]);
    expect(aplicarConteoStock(producto(), 12_000, null).movimientos[0]).toMatchObject({ cantidad: 2000, motivo: null });
  });

  it("sin diferencia también queda el movimiento, y una nota vacía se guarda como null", () => {
    expect(aplicarConteoStock(producto(), 10_000, "  ").movimientos).toEqual([{ productoId: "prod-gaseosa", tipo: "CONTEO", cantidad: 0, motivo: null }]);
  });

  it("corrige un stock negativo", () => {
    const efecto = aplicarConteoStock(producto({ stock: -3000 }), 0, null);
    expect(efecto.productos[0]?.stock).toBe(0);
    expect(efecto.movimientos[0]?.cantidad).toBe(3000);
  });

  it("cuenta 12.75 m de cable", () => {
    expect(aplicarConteoStock(cable(10_000), 12_750, null).movimientos[0]?.cantidad).toBe(2750);
  });

  it("lo contado no puede ser negativo ni una fracción de un producto por unidad", () => {
    expect(() => aplicarConteoStock(producto(), -1000, null)).toThrow(codigo("INVALID_QUANTITY"));
    expect(() => aplicarConteoStock(producto(), 7500, null)).toThrow(codigo("INVALID_QUANTITY"));
  });

  it("un producto sin control de stock no se cuenta", () => {
    expect(() => aplicarConteoStock(producto({ controlaStock: false }), 1000, null)).toThrow(codigo("INVALID_STATE_TRANSITION"));
  });
});

describe("RN-25 · ingreso de mercadería", () => {
  it("suma exactamente lo ingresado (RF-35)", () => {
    const efecto = reponerStock(producto(), 24_000);
    expect(efecto.productos[0]?.stock).toBe(34_000);
    expect(efecto.movimientos).toEqual([{ productoId: "prod-gaseosa", tipo: "REPOSICION", cantidad: 24_000 }]);
  });

  it("la cantidad debe ser positiva y entera si el producto es por unidad", () => {
    expect(() => reponerStock(producto(), 0)).toThrow(codigo("INVALID_QUANTITY"));
    expect(() => reponerStock(producto(), 1500)).toThrow(codigo("INVALID_QUANTITY"));
    expect(reponerStock(cable(0), 1500).productos[0]?.stock).toBe(1500);
  });

  it("un producto sin control de stock no recibe mercadería", () => {
    expect(() => reponerStock(producto({ controlaStock: false }), 1000)).toThrow(codigo("INVALID_STATE_TRANSITION"));
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
        cotizacion: cotizarVenta([{ producto: p, cantidad: 3000 }], false),
        pagos: [pagoSinVuelto(EFECTIVO.id, 1050, null)],
        creadoPorId: "cajero-1",
      },
      contexto(en("12:00")),
    );
    const efecto = revertirVentaEnInventario(venta, [{ ...p, stock: 7000 }]);
    expect(efecto.productos[0]?.stock).toBe(10_000);
    expect(efecto.movimientos).toEqual([{ productoId: p.id, tipo: "ANULACION_VENTA", cantidad: 3000 }]);
  });
});
