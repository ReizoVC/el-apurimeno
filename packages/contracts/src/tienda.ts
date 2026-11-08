import { z } from "zod";
import {
  CentimosSchema,
  FechaISOSchema,
  IdSchema,
  MilesimasSchema,
  TextoRequeridoSchema,
} from "./comun.js";
import { MotivoSalidaSchema, TipoMovimientoInventarioSchema, UnidadMedidaSchema } from "./estados.js";
import { problema } from "./interno.js";

// Módulo desacoplado del hospedaje (RES-02): nada aquí referencia habitaciones ni alquileres.

export const CategoriaProductoSchema = z
  .object({
    id: IdSchema,
    nombre: TextoRequeridoSchema,
  })
  .strict();
export type CategoriaProducto = z.infer<typeof CategoriaProductoSchema>;

/**
 * Artículo de la tienda: dos precios sobre un único stock (RN-20, RN-21). Los precios son por unidad (un metro, un
 * kilo); el stock y los mínimos van en milésimas de esa unidad (decisión 31).
 */
export const ProductoSchema = z
  .object({
    id: IdSchema,
    categoriaId: IdSchema,
    nombre: TextoRequeridoSchema,
    /** Código interno, único: la clave para volver a importar sin duplicar. null si el producto todavía no tiene. */
    sku: TextoRequeridoSchema.nullable(),
    /** Código leído por un scanner USB (se comporta como teclado). null si el producto no tiene código. */
    codigoBarras: TextoRequeridoSchema.nullable(),
    unidad: UnidadMedidaSchema,
    precioHuesped: CentimosSchema,
    precioPublico: CentimosSchema,
    /** Lo que cuesta al negocio, por unidad. null si no se registró, o si quien consulta no tiene `inventory.manage`. */
    costo: CentimosSchema.nullable(),
    /** false para artículos sin control de stock (§32). */
    controlaStock: z.boolean(),
    /** Puede ser negativo solo si la configuración lo autoriza (RN-26). */
    stock: MilesimasSchema,
    /** Con este stock o menos, el producto aparece en "Bajo el mínimo". */
    stockMinimo: MilesimasSchema.nonnegative().nullable(),
    /** Hasta dónde conviene reponer. */
    stockOptimo: MilesimasSchema.nonnegative().nullable(),
    activo: z.boolean(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.stockMinimo !== null && p.stockOptimo !== null && p.stockOptimo < p.stockMinimo) {
      problema(ctx, ["stockOptimo"], "El stock óptimo no puede ser menor que el mínimo.");
    }
  });
export type Producto = z.infer<typeof ProductoSchema>;

/**
 * Kardex (§18.1, decisiones 29 y 31). `cantidad` es el cambio de stock con signo, en milésimas:
 * REPOSICION > 0; VENTA < 0 con el ticket de venta; ANULACION_VENTA > 0 con el ticket compensatorio;
 * SALIDA < 0 con su `motivoSalida` (y `motivo` como detalle, obligatorio si es OTRO); CONTEO, lo que ajustó (0 si
 * coincidió), con una nota opcional en `motivo`.
 */
export const MovimientoInventarioSchema = z
  .object({
    id: IdSchema,
    productoId: IdSchema,
    tipo: TipoMovimientoInventarioSchema,
    cantidad: MilesimasSchema,
    ticketId: IdSchema.nullable(),
    motivoSalida: MotivoSalidaSchema.nullable(),
    motivo: TextoRequeridoSchema.nullable(),
    creadoPorId: IdSchema,
    creadoEn: FechaISOSchema,
  })
  .strict()
  .superRefine((m, ctx) => {
    const resta = m.tipo === "VENTA" || m.tipo === "SALIDA";
    if (m.tipo !== "CONTEO" && (resta ? m.cantidad >= 0 : m.cantidad <= 0)) {
      problema(ctx, ["cantidad"], resta ? `Un movimiento ${m.tipo} descuenta stock (cantidad < 0).` : `Un movimiento ${m.tipo} suma stock (cantidad > 0).`);
    }
    if ((m.tipo === "VENTA" || m.tipo === "ANULACION_VENTA") === (m.ticketId === null)) {
      problema(ctx, ["ticketId"], "Ventas y anulaciones de venta referencian su ticket; los demás movimientos no.");
    }
    if ((m.tipo === "SALIDA") !== (m.motivoSalida !== null)) {
      problema(ctx, ["motivoSalida"], "Toda salida lleva su motivo fijo, y solo una salida lo lleva.");
    }
    if (m.motivoSalida === "OTRO" && m.motivo === null) {
      problema(ctx, ["motivo"], "Una salida por otro motivo exige el detalle.");
    }
    if (m.tipo !== "SALIDA" && m.tipo !== "CONTEO" && m.motivo !== null) {
      problema(ctx, ["motivo"], "Solo una salida o un conteo llevan detalle.");
    }
  });
export type MovimientoInventario = z.infer<typeof MovimientoInventarioSchema>;
