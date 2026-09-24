import { z } from "zod";
import {
  CentimosSchema,
  FechaISOSchema,
  IdSchema,
  TextoRequeridoSchema,
} from "./comun.js";
import { TipoMovimientoInventarioSchema } from "./estados.js";
import { problema } from "./interno.js";

// Módulo desacoplado del hospedaje (RES-02): nada aquí referencia habitaciones ni alquileres.

export const CategoriaProductoSchema = z
  .object({
    id: IdSchema,
    nombre: TextoRequeridoSchema,
  })
  .strict();
export type CategoriaProducto = z.infer<typeof CategoriaProductoSchema>;

/** Artículo de la tienda: dos precios sobre un único stock (RN-20, RN-21). */
export const ProductoSchema = z
  .object({
    id: IdSchema,
    categoriaId: IdSchema,
    nombre: TextoRequeridoSchema,
    /** Código leído por un scanner USB (se comporta como teclado). null si el producto no tiene código. */
    codigoBarras: TextoRequeridoSchema.nullable(),
    precioHuesped: CentimosSchema,
    precioPublico: CentimosSchema,
    /** false para artículos sin control de stock (§32). */
    controlaStock: z.boolean(),
    /** Puede ser negativo solo si la configuración lo autoriza (RN-26). */
    stock: z.number().int(),
    activo: z.boolean(),
  })
  .strict();
export type Producto = z.infer<typeof ProductoSchema>;

/**
 * Kardex (§18.1). `cantidad` es el cambio de stock con signo:
 * REPOSICION > 0 sin ticket; VENTA < 0 con el ticket de venta; ANULACION_VENTA > 0 con el ticket compensatorio.
 */
export const MovimientoInventarioSchema = z
  .object({
    id: IdSchema,
    productoId: IdSchema,
    tipo: TipoMovimientoInventarioSchema,
    cantidad: z.number().int(),
    ticketId: IdSchema.nullable(),
    creadoPorId: IdSchema,
    creadoEn: FechaISOSchema,
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.tipo === "VENTA" ? m.cantidad >= 0 : m.cantidad <= 0) {
      problema(ctx, ["cantidad"], m.tipo === "VENTA" ? "Una venta descuenta stock (cantidad < 0)." : `Un movimiento ${m.tipo} suma stock (cantidad > 0).`);
    }
    if ((m.tipo === "REPOSICION") !== (m.ticketId === null)) {
      problema(ctx, ["ticketId"], "Ventas y anulaciones de venta referencian su ticket; una reposición no.");
    }
  });
export type MovimientoInventario = z.infer<typeof MovimientoInventarioSchema>;
