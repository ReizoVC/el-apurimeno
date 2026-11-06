import type { Id, Producto, Ticket, TipoMovimientoInventario } from "@apurimeno/contracts";
import { ErrorNegocio } from "./errores.js";
import { asegurarEnteroPositivo, motivoRequerido } from "./interno.js";
import type { ItemVenta } from "./precios.js";

/** Movimiento de kardex antes de persistirse: el backend agrega id, ticketId, autor y fecha. */
export interface BorradorMovimientoInventario {
  productoId: Id;
  tipo: TipoMovimientoInventario;
  cantidad: number;
  motivo?: string | null;
}

export interface EfectoInventario {
  productos: Producto[];
  movimientos: BorradorMovimientoInventario[];
}

/** Producto que se vendió por encima de su stock, con lo que había antes de la venta. */
export interface VentaSinStock {
  productoId: Id;
  nombre: string;
  stockPrevio: number;
  cantidad: number;
}

function asegurarControlaStock(producto: Producto): void {
  if (!producto.controlaStock) {
    throw new ErrorNegocio("INVALID_STATE_TRANSITION", `${producto.nombre} no lleva control de stock.`);
  }
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
 * Vender por encima del stock exige la configuración y, además, que el cajero lo confirme (decisión 29).
 */
export function aplicarVentaAInventario(
  items: readonly ItemVenta[],
  permitirStockNegativo: boolean,
  confirmarSinStock: boolean,
): EfectoInventario & { sinStock: VentaSinStock[] } {
  const productos: Producto[] = [];
  const movimientos: BorradorMovimientoInventario[] = [];
  const sinStock: VentaSinStock[] = [];
  for (const { producto, cantidad } of agrupar(items).values()) {
    if (!producto.controlaStock) continue;
    if (cantidad > producto.stock) {
      if (!permitirStockNegativo || !confirmarSinStock) {
        const faltante = `No hay stock suficiente de ${producto.nombre}: disponible ${producto.stock}, solicitado ${cantidad}.`;
        throw new ErrorNegocio(
          "INSUFFICIENT_STOCK",
          permitirStockNegativo ? `${faltante} Confirme el aviso para vender sin stock.` : `${faltante} La venta sin stock está desactivada en la Configuración.`,
        );
      }
      sinStock.push({ productoId: producto.id, nombre: producto.nombre, stockPrevio: producto.stock, cantidad });
    }
    productos.push({ ...producto, stock: producto.stock - cantidad });
    movimientos.push({ productoId: producto.id, tipo: "VENTA", cantidad: -cantidad });
  }
  return { productos, movimientos, sinStock };
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

/**
 * Salida de mercadería: vencida, dañada, consumo interno (decisión 29). Con motivo, y nunca más de lo que hay: si lo
 * físico no cuadra con el sistema, corresponde un conteo.
 */
export function registrarSalidaStock(producto: Producto, cantidad: number, motivo: string): EfectoInventario {
  asegurarEnteroPositivo(cantidad, "cantidad");
  asegurarControlaStock(producto);
  const limpio = motivoRequerido(motivo);
  if (cantidad > producto.stock) {
    throw new ErrorNegocio(
      "INSUFFICIENT_STOCK",
      `No se pueden sacar ${cantidad} de ${producto.nombre}: el sistema tiene ${producto.stock}. Si lo físico no cuadra, use Contar.`,
    );
  }
  return {
    productos: [{ ...producto, stock: producto.stock - cantidad }],
    movimientos: [{ productoId: producto.id, tipo: "SALIDA", cantidad: -cantidad, motivo: limpio }],
  };
}

/**
 * Conteo físico (decisión 29): el stock queda en lo contado y el kardex guarda la diferencia, también si es 0, como
 * constancia de que se contó.
 */
export function aplicarConteoStock(producto: Producto, contado: number, nota: string | null): EfectoInventario {
  if (!Number.isSafeInteger(contado) || contado < 0) throw new RangeError(`contado debe ser un entero no negativo: ${contado}`);
  asegurarControlaStock(producto);
  const limpia = nota?.trim() ?? "";
  return {
    productos: [{ ...producto, stock: contado }],
    movimientos: [{ productoId: producto.id, tipo: "CONTEO", cantidad: contado - producto.stock, motivo: limpia === "" ? null : limpia }],
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
