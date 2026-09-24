import type { Id, Producto, Ticket, TipoMovimientoInventario } from "@apurimeno/contracts";
import { ErrorNegocio } from "./errores.js";
import { asegurarEnteroPositivo } from "./interno.js";
import type { ItemVenta } from "./precios.js";

/** Movimiento de kardex antes de persistirse: el backend agrega id, ticketId, autor y fecha. */
export interface BorradorMovimientoInventario {
  productoId: Id;
  tipo: TipoMovimientoInventario;
  cantidad: number;
}

export interface EfectoInventario {
  productos: Producto[];
  movimientos: BorradorMovimientoInventario[];
}

function agrupar(items: readonly ItemVenta[]): Map<Id, { producto: Producto; cantidad: number }> {
  const grupos = new Map<Id, { producto: Producto; cantidad: number }>();
  for (const { producto, cantidad } of items) {
    asegurarEnteroPositivo(cantidad, `cantidad de ${producto.nombre}`);
    const grupo = grupos.get(producto.id);
    if (grupo === undefined) grupos.set(producto.id, { producto, cantidad });
    else grupo.cantidad += cantidad;
  }
  return grupos;
}

/**
 * Descuenta del stock único de cada producto (RN-21, RN-26, RF-24, RF-25).
 * Suma las cantidades de un mismo producto repetido en varias líneas antes de comparar con el stock.
 * Los productos sin control de stock se venden sin verificar ni generar movimiento (§32).
 */
export function aplicarVentaAInventario(
  items: readonly ItemVenta[],
  permitirStockNegativo: boolean,
): EfectoInventario {
  const productos: Producto[] = [];
  const movimientos: BorradorMovimientoInventario[] = [];
  for (const { producto, cantidad } of agrupar(items).values()) {
    if (!producto.controlaStock) continue;
    if (!permitirStockNegativo && cantidad > producto.stock) {
      throw new ErrorNegocio(
        "INSUFFICIENT_STOCK",
        `No hay stock suficiente de ${producto.nombre}: disponible ${producto.stock}, solicitado ${cantidad}.`,
      );
    }
    productos.push({ ...producto, stock: producto.stock - cantidad });
    movimientos.push({ productoId: producto.id, tipo: "VENTA", cantidad: -cantidad });
  }
  return { productos, movimientos };
}

/** Ingreso de mercadería (RN-25, RF-35). El permiso `inventory.manage` lo verifica quien llama. */
export function reponerStock(producto: Producto, cantidad: number): EfectoInventario {
  asegurarEnteroPositivo(cantidad, "cantidad");
  if (!producto.controlaStock) throw new RangeError(`${producto.nombre} no lleva control de stock.`);
  return {
    productos: [{ ...producto, stock: producto.stock + cantidad }],
    movimientos: [{ productoId: producto.id, tipo: "REPOSICION", cantidad }],
  };
}

/** Restituye el stock de una venta anulada (RF-30). `productos` debe incluir los de las líneas del ticket. */
export function revertirVentaEnInventario(ticketOriginal: Ticket, productos: readonly Producto[]): EfectoInventario {
  if (ticketOriginal.origen !== "VENTA_TIENDA") throw new RangeError("El ticket no es una venta de tienda.");
  const porId = new Map(productos.map((p) => [p.id, p]));
  const items: ItemVenta[] = [];
  for (const linea of ticketOriginal.lineas) {
    if (linea.tipo !== "PRODUCTO" || linea.productoId === null) continue;
    const producto = porId.get(linea.productoId);
    if (producto === undefined) throw new RangeError(`Falta el producto ${linea.productoId}.`);
    items.push({ producto, cantidad: linea.cantidad });
  }

  const efecto: EfectoInventario = { productos: [], movimientos: [] };
  for (const { producto, cantidad } of agrupar(items).values()) {
    if (!producto.controlaStock) continue;
    efecto.productos.push({ ...producto, stock: producto.stock + cantidad });
    efecto.movimientos.push({ productoId: producto.id, tipo: "ANULACION_VENTA", cantidad });
  }
  return efecto;
}
