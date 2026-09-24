import { z } from "zod";

// Patrón: `XSchema` valida, `type X` es el tipo y `X.VALOR` da acceso a los valores.

/** Estado operativo de una habitación (§20.1). Se persiste. */
export const EstadoHabitacionSchema = z.enum([
  "LIBRE",
  "OCUPADA",
  "PENDIENTE_LIMPIEZA",
  "MANTENIMIENTO",
]);
export type EstadoHabitacion = z.infer<typeof EstadoHabitacionSchema>;
export const EstadoHabitacion = EstadoHabitacionSchema.enum;

/** Ciclo de vida de un alquiler (§19.2, §20.2). Se persiste. */
export const EstadoAlquilerSchema = z.enum(["ABIERTO", "CERRADO", "ANULADO"]);
export type EstadoAlquiler = z.infer<typeof EstadoAlquilerSchema>;
export const EstadoAlquiler = EstadoAlquilerSchema.enum;

/**
 * Estado temporal de un alquiler ABIERTO (RN-11, RF-07).
 * NUNCA se persiste ni es un campo de `Alquiler`: se calcula con la hora del servidor.
 */
export const EstadoTemporalAlquilerSchema = z.enum([
  "A_TIEMPO",
  "POR_VENCER",
  "EN_CORTESIA",
  "EN_SOBRETIEMPO",
]);
export type EstadoTemporalAlquiler = z.infer<typeof EstadoTemporalAlquilerSchema>;
export const EstadoTemporalAlquiler = EstadoTemporalAlquilerSchema.enum;

/** Clasificación de una hora adicional cobrada durante la estadía (RN-06, RN-08, RF-08). */
export const TipoHoraAdicionalSchema = z.enum([
  "EXTENSION_ANTICIPADA",
  "LIQUIDACION_SOBRETIEMPO",
]);
export type TipoHoraAdicional = z.infer<typeof TipoHoraAdicionalSchema>;
export const TipoHoraAdicional = TipoHoraAdicionalSchema.enum;

/** De dónde salió el precio de la habitación en un ingreso (RN-13, RN-14, RF-02). */
export const OrigenPrecioAlquilerSchema = z.enum(["LISTA", "PRECIO_ESPECIAL"]);
export type OrigenPrecioAlquiler = z.infer<typeof OrigenPrecioAlquilerSchema>;
export const OrigenPrecioAlquiler = OrigenPrecioAlquilerSchema.enum;

/** Estado de un ticket (§20.3). */
export const EstadoTicketSchema = z.enum(["EMITIDO", "ANULADO"]);
export type EstadoTicket = z.infer<typeof EstadoTicketSchema>;
export const EstadoTicket = EstadoTicketSchema.enum;

/** Un ticket es un cobro o el ticket compensatorio que anula otro (RN-36, RF-29). */
export const TipoTicketSchema = z.enum(["COBRO", "COMPENSATORIO"]);
export type TipoTicket = z.infer<typeof TipoTicketSchema>;
export const TipoTicket = TipoTicketSchema.enum;

/** Operación que originó el ticket (§18.1). */
export const OrigenTicketSchema = z.enum([
  "INGRESO_ALQUILER",
  "HORA_ADICIONAL",
  "VENTA_TIENDA",
]);
export type OrigenTicket = z.infer<typeof OrigenTicketSchema>;
export const OrigenTicket = OrigenTicketSchema.enum;

export const TipoLineaTicketSchema = z.enum([
  "BASE_HABITACION",
  "HORA_ADICIONAL",
  "PRODUCTO",
  "AJUSTE_PUNTUAL",
]);
export type TipoLineaTicket = z.infer<typeof TipoLineaTicketSchema>;
export const TipoLineaTicket = TipoLineaTicketSchema.enum;

/** Estado de un turno de caja (§20.4). */
export const EstadoTurnoSchema = z.enum(["ABIERTO", "CERRADO"]);
export type EstadoTurno = z.infer<typeof EstadoTurnoSchema>;
export const EstadoTurno = EstadoTurnoSchema.enum;

/** Movimiento manual de caja (RN-33, RF-42). */
export const TipoMovimientoCajaSchema = z.enum(["INGRESO", "RETIRO"]);
export type TipoMovimientoCaja = z.infer<typeof TipoMovimientoCajaSchema>;
export const TipoMovimientoCaja = TipoMovimientoCajaSchema.enum;

/** Causa de un cambio de stock (§18.1: venta, anulación de venta o reposición). */
export const TipoMovimientoInventarioSchema = z.enum([
  "REPOSICION",
  "VENTA",
  "ANULACION_VENTA",
]);
export type TipoMovimientoInventario = z.infer<typeof TipoMovimientoInventarioSchema>;
export const TipoMovimientoInventario = TipoMovimientoInventarioSchema.enum;

/** Estado de un trabajo de impresión del comprobante (§20.5). */
export const EstadoTrabajoImpresionSchema = z.enum(["PENDIENTE", "IMPRESO", "ERROR"]);
export type EstadoTrabajoImpresion = z.infer<typeof EstadoTrabajoImpresionSchema>;
export const EstadoTrabajoImpresion = EstadoTrabajoImpresionSchema.enum;

/** Operaciones que un código de autorización temporal puede habilitar (RN-46, RF-65). */
export const OperacionAutorizableSchema = z.enum(["ANULAR_TICKET"]);
export type OperacionAutorizable = z.infer<typeof OperacionAutorizableSchema>;
export const OperacionAutorizable = OperacionAutorizableSchema.enum;

type TablaTransiciones<E extends string> = { readonly [K in E]: readonly E[] };

/**
 * §20.1. OCUPADA → LIBRE solo ocurre al anular el ticket de ingreso (RF-30, escenario 31.5).
 * PENDIENTE_LIMPIEZA → MANTENIMIENTO es el reporte de daño desde limpieza (CU-17).
 */
export const TRANSICIONES_HABITACION: TablaTransiciones<EstadoHabitacion> = {
  LIBRE: ["OCUPADA", "MANTENIMIENTO"],
  OCUPADA: ["PENDIENTE_LIMPIEZA", "LIBRE"],
  PENDIENTE_LIMPIEZA: ["LIBRE", "MANTENIMIENTO"],
  MANTENIMIENTO: ["LIBRE"],
};

/** §20.2: CERRADO y ANULADO son finales. */
export const TRANSICIONES_ALQUILER: TablaTransiciones<EstadoAlquiler> = {
  ABIERTO: ["CERRADO", "ANULADO"],
  CERRADO: [],
  ANULADO: [],
};

export const TRANSICIONES_TICKET: TablaTransiciones<EstadoTicket> = {
  EMITIDO: ["ANULADO"],
  ANULADO: [],
};

export const TRANSICIONES_TURNO: TablaTransiciones<EstadoTurno> = {
  ABIERTO: ["CERRADO"],
  CERRADO: [],
};

export const TRANSICIONES_TRABAJO_IMPRESION: TablaTransiciones<EstadoTrabajoImpresion> = {
  PENDIENTE: ["IMPRESO", "ERROR"],
  ERROR: ["PENDIENTE"],
  IMPRESO: [],
};

export function esTransicionValida<E extends string>(
  tabla: TablaTransiciones<E>,
  desde: E,
  hacia: E,
): boolean {
  return tabla[desde].includes(hacia);
}
