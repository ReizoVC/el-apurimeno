import { z } from "zod";
import { FechaISOSchema, IdSchema, TextoRequeridoSchema } from "./comun.js";
import { OperacionAutorizableSchema } from "./estados.js";
import { milisegundos, problema } from "./interno.js";

/** Acciones sensibles que deben auditarse (§23.1, RN-42). */
export const AccionAuditoriaSchema = z.enum([
  "SESION_INICIADA",
  "SESION_CERRADA",
  "SESION_FALLIDA",
  "ACCESO_DENEGADO",
  "TURNO_ABIERTO",
  "TURNO_CERRADO",
  "TURNO_CIERRE_FORZADO",
  "MOVIMIENTO_CAJA_REGISTRADO",
  "INGRESO_REGISTRADO",
  "HORA_ADICIONAL_COBRADA",
  "SALIDA_REGISTRADA",
  "SALIDA_SIN_PAGO_REGISTRADA",
  "PRECIO_ESPECIAL_CREADO",
  "PRECIO_ESPECIAL_EDITADO",
  "PRECIO_ESPECIAL_ELIMINADO",
  "AJUSTE_PUNTUAL_APLICADO",
  "VENTA_REGISTRADA",
  "MERCADERIA_INGRESADA",
  "HABITACION_CREADA",
  "HABITACION_EDITADA",
  "HABITACION_ESTADO_CAMBIADO",
  "PRODUCTO_CREADO",
  "PRODUCTO_EDITADO",
  "TICKET_ANULADO",
  "CODIGO_AUTORIZACION_GENERADO",
  "COMPROBANTE_REIMPRESO",
  "USUARIO_CREADO",
  "USUARIO_EDITADO",
  "USUARIO_DESACTIVADO",
  "USUARIO_RANGOS_ASIGNADOS",
  "RANGO_CREADO",
  "RANGO_EDITADO",
  "CONFIGURACION_CAMBIADA",
  /** Sincronización con el espejo pedida a mano desde el Dashboard; las automáticas no se auditan. */
  "ESPEJO_SINCRONIZADO",
]);
export type AccionAuditoria = z.infer<typeof AccionAuditoriaSchema>;
export const AccionAuditoria = AccionAuditoriaSchema.enum;

/** Acciones cuyo registro exige motivo (RN-12, RN-17, RF-29, RF-42). */
export const ACCIONES_CON_MOTIVO: readonly AccionAuditoria[] = [
  "SALIDA_SIN_PAGO_REGISTRADA",
  "AJUSTE_PUNTUAL_APLICADO",
  "TICKET_ANULADO",
  "MOVIMIENTO_CAJA_REGISTRADO",
];

export const TipoEntidadAuditadaSchema = z.enum([
  "SESION",
  "HABITACION",
  "CLIENTE",
  "PRECIO_ESPECIAL_CLIENTE",
  "ALQUILER",
  "HORA_ADICIONAL",
  "TICKET",
  "TURNO",
  "MOVIMIENTO_CAJA",
  "PRODUCTO",
  "MOVIMIENTO_INVENTARIO",
  "USUARIO",
  "RANGO",
  "CONFIGURACION",
  "METODO_PAGO",
  "CODIGO_AUTORIZACION",
  "TRABAJO_IMPRESION",
  "ESPEJO",
]);
export type TipoEntidadAuditada = z.infer<typeof TipoEntidadAuditadaSchema>;
export const TipoEntidadAuditada = TipoEntidadAuditadaSchema.enum;

type ValorJson = string | number | boolean | null | ValorJson[] | { [clave: string]: ValorJson };
const ValorJsonSchema: z.ZodType<ValorJson> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(ValorJsonSchema),
    z.record(ValorJsonSchema),
  ]),
);

/** Constancia inmutable de una acción sensible (§18.1, §23.1). Nunca se edita ni se borra (RF-57). */
export const RegistroAuditoriaSchema = z
  .object({
    id: IdSchema,
    ocurridoEn: FechaISOSchema,
    /** null solo en un intento de sesión fallido, donde no hay usuario autenticado. */
    usuarioId: IdSchema.nullable(),
    accion: AccionAuditoriaSchema,
    tipoEntidad: TipoEntidadAuditadaSchema,
    entidadId: IdSchema.nullable(),
    valorPrevio: ValorJsonSchema.nullable(),
    valorNuevo: ValorJsonSchema.nullable(),
    motivo: TextoRequeridoSchema.nullable(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.usuarioId === null && r.accion !== "SESION_FALLIDA") {
      problema(ctx, ["usuarioId"], "Toda acción auditada tiene un usuario responsable.");
    }
    if (ACCIONES_CON_MOTIVO.includes(r.accion) && r.motivo === null) {
      problema(ctx, ["motivo"], `La acción ${r.accion} exige motivo.`);
    }
  });
export type RegistroAuditoria = z.infer<typeof RegistroAuditoriaSchema>;

/**
 * Habilitación de un solo uso y vigencia breve que un Administrador genera, incluso de forma remota,
 * para que un Cajero ejecute una operación sensible (RN-46, RF-65, RF-66).
 * "Vigente", "usado" o "expirado" se deriva de estos campos y de la hora del servidor; no se guarda.
 */
export const CodigoAutorizacionSchema = z
  .object({
    id: IdSchema,
    /** Secreto: se muestra una vez al Administrador que lo genera; no debe listarse después. */
    codigo: TextoRequeridoSchema,
    operacion: OperacionAutorizableSchema,
    generadoPorId: IdSchema,
    generadoEn: FechaISOSchema,
    expiraEn: FechaISOSchema,
    usadoEn: FechaISOSchema.nullable(),
    usadoPorId: IdSchema.nullable(),
    /** Ticket anulado con este código. */
    ticketId: IdSchema.nullable(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const generado = milisegundos(c.generadoEn);
    const expira = milisegundos(c.expiraEn);
    if (generado !== null && expira !== null && expira <= generado) {
      problema(ctx, ["expiraEn"], "expiraEn debe ser posterior a generadoEn.");
    }
    const usado = [c.usadoEn, c.usadoPorId, c.ticketId].map((v) => v !== null);
    if (usado.some(Boolean) && !usado.every(Boolean)) {
      problema(ctx, ["usadoEn"], "usadoEn, usadoPorId y ticketId se registran juntos.");
    }
    const uso = c.usadoEn === null ? null : milisegundos(c.usadoEn);
    if (uso !== null && generado !== null && expira !== null && (uso < generado || uso > expira)) {
      problema(ctx, ["usadoEn"], "El código solo puede usarse dentro de su vigencia (AUTH_CODE_INVALID).");
    }
  });
export type CodigoAutorizacion = z.infer<typeof CodigoAutorizacionSchema>;
