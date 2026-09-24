import { z } from "zod";
import {
  CentimosConSignoSchema,
  CentimosSchema,
  FechaISOSchema,
  IdSchema,
  TextoRequeridoSchema,
} from "./comun.js";
import {
  EstadoTicketSchema,
  OrigenTicketSchema,
  TipoLineaTicketSchema,
  TipoTicketSchema,
  type OrigenTicket,
  type TipoLineaTicket,
} from "./estados.js";
import { problema } from "./interno.js";

/** Forma de pago aceptada (§18.1). Solo las que afectan caja cuentan para el efectivo esperado (RN-35). */
export const MetodoPagoSchema = z
  .object({
    id: IdSchema,
    nombre: TextoRequeridoSchema,
    afectaCaja: z.boolean(),
    requiereReferencia: z.boolean(),
    activo: z.boolean(),
  })
  .strict();
export type MetodoPago = z.infer<typeof MetodoPagoSchema>;

/**
 * Dinero recibido para saldar un ticket (§18.1). Solo existe dentro de `Ticket.pagos`.
 * En un ticket compensatorio el monto es negativo (devolución).
 * `montoRecibido` y `vuelto` solo aplican a cobros en efectivo (RF-04).
 */
export const PagoSchema = z
  .object({
    id: IdSchema,
    metodoPagoId: IdSchema,
    monto: CentimosConSignoSchema,
    /** Número de operación (Yape, Plin, etc.). */
    referencia: TextoRequeridoSchema.nullable(),
    montoRecibido: CentimosSchema.nullable(),
    vuelto: CentimosSchema.nullable(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if ((p.montoRecibido === null) !== (p.vuelto === null)) {
      problema(ctx, ["vuelto"], "montoRecibido y vuelto van juntos.");
      return;
    }
    if (p.montoRecibido === null || p.vuelto === null) return;
    if (p.monto <= 0) {
      problema(ctx, ["montoRecibido"], "montoRecibido solo aplica a un cobro con monto positivo.");
    }
    if (p.montoRecibido < p.monto) {
      problema(ctx, ["montoRecibido"], "El monto recibido no cubre el pago (PAYMENT_INSUFFICIENT).");
    } else if (p.vuelto !== p.montoRecibido - p.monto) {
      problema(ctx, ["vuelto"], "vuelto debe ser montoRecibido - monto.");
    }
  });
export type Pago = z.infer<typeof PagoSchema>;

/** Concepto dentro de un ticket (§18.1). Solo existe dentro de `Ticket.lineas`. */
export const LineaTicketSchema = z
  .object({
    id: IdSchema,
    tipo: TipoLineaTicketSchema,
    /** Texto impreso, ej. "Habitación 205 — 8 horas". Nunca incluye datos del cliente (RN-38). */
    descripcion: TextoRequeridoSchema,
    cantidad: z.number().int().positive(),
    precioUnitario: CentimosConSignoSchema,
    importe: CentimosConSignoSchema,
    productoId: IdSchema.nullable(),
  })
  .strict()
  .superRefine((l, ctx) => {
    if (l.importe !== l.cantidad * l.precioUnitario) {
      problema(ctx, ["importe"], "importe debe ser cantidad × precioUnitario.");
    }
    if ((l.tipo === "PRODUCTO") !== (l.productoId !== null)) {
      problema(ctx, ["productoId"], "productoId es obligatorio en líneas PRODUCTO y prohibido en las demás.");
    }
    if ((l.tipo === "BASE_HABITACION" || l.tipo === "AJUSTE_PUNTUAL") && l.cantidad !== 1) {
      problema(ctx, ["cantidad"], `Una línea ${l.tipo} tiene cantidad 1.`);
    }
  });
export type LineaTicket = z.infer<typeof LineaTicketSchema>;

/**
 * Ajuste puntual del cajero: solo al alza y con motivo (RN-17, RN-18, RN-19).
 * `montoOriginal` es el total calculado automáticamente; la diferencia va en una línea AJUSTE_PUNTUAL.
 */
export const AjustePuntualSchema = z
  .object({
    montoOriginal: CentimosSchema,
    montoAjustado: CentimosSchema,
    motivo: TextoRequeridoSchema,
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.montoAjustado < a.montoOriginal) {
      problema(ctx, ["montoAjustado"], "El ajuste solo puede aumentar el precio (ADJUSTMENT_BELOW_MINIMUM).");
    }
  });
export type AjustePuntual = z.infer<typeof AjustePuntualSchema>;

/** Datos de la anulación, presentes solo en el ticket COMPENSATORIO (CU-21, RN-46). */
export const AnulacionTicketSchema = z
  .object({
    motivo: TextoRequeridoSchema,
    /** Código usado por un Cajero sin `tickets.void`; null si anuló un Administrador. */
    codigoAutorizacionId: IdSchema.nullable(),
  })
  .strict();
export type AnulacionTicket = z.infer<typeof AnulacionTicketSchema>;

export const TIPOS_LINEA_POR_ORIGEN: Readonly<Record<OrigenTicket, readonly TipoLineaTicket[]>> = {
  INGRESO_ALQUILER: ["BASE_HABITACION", "HORA_ADICIONAL", "AJUSTE_PUNTUAL"],
  HORA_ADICIONAL: ["HORA_ADICIONAL", "AJUSTE_PUNTUAL"],
  VENTA_TIENDA: ["PRODUCTO", "AJUSTE_PUNTUAL"],
};

/**
 * Registro de toda operación cobrada: ingreso, hora adicional o venta (§18.1).
 * Es lo que el pedido original llamaba "Transacción". Nunca se edita ni se borra (RN-36):
 * para corregir se emite un ticket COMPENSATORIO por el importe inverso y el original pasa a ANULADO.
 */
export const TicketSchema = z
  .object({
    id: IdSchema,
    /** Correlativo interno, sin formato de serie fiscal (RN-39). */
    numero: z.number().int().positive(),
    tipo: TipoTicketSchema,
    origen: OrigenTicketSchema,
    estado: EstadoTicketSchema,
    turnoId: IdSchema,
    /** Obligatorio para ingresos y horas adicionales; siempre null en ventas (la tienda no conoce alquileres). */
    alquilerId: IdSchema.nullable(),
    /** Venta asociada a una habitación, solo como referencia (RN-24). Si existe, se aplicó precio de huésped (RF-22). */
    habitacionReferenciaId: IdSchema.nullable(),
    /** En un COMPENSATORIO, el ticket que anula. */
    ticketOriginalId: IdSchema.nullable(),
    total: CentimosConSignoSchema,
    ajustePuntual: AjustePuntualSchema.nullable(),
    anulacion: AnulacionTicketSchema.nullable(),
    lineas: z.array(LineaTicketSchema).min(1),
    pagos: z.array(PagoSchema).min(1),
    creadoPorId: IdSchema,
    creadoEn: FechaISOSchema,
  })
  .strict()
  .superRefine((t, ctx) => {
    const sumaLineas = t.lineas.reduce((suma, l) => suma + l.importe, 0);
    if (sumaLineas !== t.total) {
      problema(ctx, ["total"], "El total debe ser la suma de las líneas (§21).");
    }
    const sumaPagos = t.pagos.reduce((suma, p) => suma + p.monto, 0);
    if (sumaPagos !== t.total) {
      problema(ctx, ["pagos"], "La suma de los pagos debe ser igual al total (§21).");
    }

    if (t.origen === "VENTA_TIENDA") {
      if (t.alquilerId !== null) {
        problema(ctx, ["alquilerId"], "Una venta de tienda no referencia alquileres (RES-02).");
      }
    } else {
      if (t.alquilerId === null) problema(ctx, ["alquilerId"], `Un ticket ${t.origen} requiere alquilerId.`);
      if (t.habitacionReferenciaId !== null) {
        problema(ctx, ["habitacionReferenciaId"], "habitacionReferenciaId solo aplica a ventas de tienda.");
      }
    }

    const permitidos = TIPOS_LINEA_POR_ORIGEN[t.origen];
    t.lineas.forEach((l, i) => {
      if (!permitidos.includes(l.tipo)) {
        problema(ctx, ["lineas", i, "tipo"], `Una línea ${l.tipo} no corresponde a un ticket ${t.origen}.`);
      }
    });
    const lineasDe = (tipo: TipoLineaTicket) => t.lineas.filter((l) => l.tipo === tipo);
    if (lineasDe("AJUSTE_PUNTUAL").length > 1) {
      problema(ctx, ["lineas"], "Un ticket tiene como máximo una línea de ajuste puntual.");
    }
    if (t.origen === "INGRESO_ALQUILER") {
      if (lineasDe("BASE_HABITACION").length !== 1) {
        problema(ctx, ["lineas"], "Un ingreso tiene exactamente una línea BASE_HABITACION.");
      }
      if (lineasDe("HORA_ADICIONAL").length > 1) {
        problema(ctx, ["lineas"], "Las horas pagadas al ingreso van en una sola línea (RF-64).");
      }
    }
    if (t.origen === "HORA_ADICIONAL") {
      const horas = lineasDe("HORA_ADICIONAL");
      if (horas.length !== 1 || horas[0]?.cantidad !== 1) {
        problema(ctx, ["lineas"], "Un ticket de hora adicional cobra exactamente una hora (RN-09).");
      }
    }
    if (t.origen === "VENTA_TIENDA" && lineasDe("PRODUCTO").length === 0) {
      problema(ctx, ["lineas"], "Una venta tiene al menos una línea PRODUCTO.");
    }

    if (t.tipo === "COBRO") {
      if (t.ticketOriginalId !== null) problema(ctx, ["ticketOriginalId"], "Solo un COMPENSATORIO referencia otro ticket.");
      if (t.anulacion !== null) problema(ctx, ["anulacion"], "Solo un COMPENSATORIO lleva datos de anulación.");
      t.lineas.forEach((l, i) => {
        if (l.precioUnitario < 0) problema(ctx, ["lineas", i, "precioUnitario"], "Un cobro no tiene importes negativos.");
      });
      const ajuste = lineasDe("AJUSTE_PUNTUAL")[0];
      if (t.ajustePuntual === null) {
        if (ajuste !== undefined) problema(ctx, ["ajustePuntual"], "Una línea AJUSTE_PUNTUAL requiere ajustePuntual.");
      } else {
        if (ajuste === undefined) {
          problema(ctx, ["lineas"], "Un ajuste puntual requiere su línea AJUSTE_PUNTUAL.");
        } else if (ajuste.importe !== t.ajustePuntual.montoAjustado - t.ajustePuntual.montoOriginal) {
          problema(ctx, ["lineas"], "La línea de ajuste debe ser montoAjustado - montoOriginal.");
        }
        if (t.total !== t.ajustePuntual.montoAjustado) {
          problema(ctx, ["total"], "Con ajuste puntual, el total es montoAjustado.");
        }
      }
    } else {
      if (t.estado !== "EMITIDO") problema(ctx, ["estado"], "Un ticket compensatorio no se anula.");
      if (t.ticketOriginalId === null) {
        problema(ctx, ["ticketOriginalId"], "Un COMPENSATORIO debe indicar el ticket que anula.");
      } else if (t.ticketOriginalId === t.id) {
        problema(ctx, ["ticketOriginalId"], "Un ticket no puede anularse a sí mismo.");
      }
      if (t.anulacion === null) problema(ctx, ["anulacion"], "Un COMPENSATORIO requiere motivo de anulación.");
      if (t.ajustePuntual !== null) {
        problema(ctx, ["ajustePuntual"], "El detalle del ajuste queda en el ticket original.");
      }
      t.lineas.forEach((l, i) => {
        if (l.precioUnitario > 0) {
          problema(ctx, ["lineas", i, "precioUnitario"], "Un compensatorio lleva importes inversos (≤ 0).");
        }
      });
    }
  });
export type Ticket = z.infer<typeof TicketSchema>;
