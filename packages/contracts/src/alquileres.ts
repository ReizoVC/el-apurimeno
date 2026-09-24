import { z } from "zod";
import {
  CentimosSchema,
  FechaISOSchema,
  IdSchema,
  TextoRequeridoSchema,
} from "./comun.js";
import {
  EstadoAlquilerSchema,
  OrigenPrecioAlquilerSchema,
  TipoHoraAdicionalSchema,
} from "./estados.js";
import { MS_POR_HORA, MS_POR_MINUTO, milisegundos, problema } from "./interno.js";

/** El bloque de tiempo adicional es siempre de una hora completa (RN-09). No es configurable. */
export const MINUTOS_HORA_ADICIONAL = 60;

/** Parámetros de tiempo y precio configurables globalmente (RN-43, RF-50, RF-51). */
export const ParametrosTiempoPrecioSchema = z
  .object({
    horasBase: z.number().int().positive(),
    minutosAviso: z.number().int().positive(),
    minutosCortesia: z.number().int().positive(),
    precioHoraAdicional: CentimosSchema,
  })
  .strict();
export type ParametrosTiempoPrecio = z.infer<typeof ParametrosTiempoPrecioSchema>;

/** Valores iniciales recomendados (anexo §41.2). */
export const PARAMETROS_TIEMPO_PRECIO_INICIALES: ParametrosTiempoPrecio = {
  horasBase: 8,
  minutosAviso: 10,
  minutosCortesia: 15,
  precioHoraAdicional: 800,
};

/**
 * Estadía de un cliente en una habitación (§18.1).
 * El estado temporal (a tiempo, por vencer, en cortesía, sobretiempo) NO es un campo:
 * se calcula con la hora del servidor (RN-11). Ver `EstadoTemporalAlquiler`.
 */
export const AlquilerSchema = z
  .object({
    id: IdSchema,
    habitacionId: IdSchema,
    /** null si el cliente no se identificó (CU-04 A1). */
    clienteId: IdSchema.nullable(),
    turnoId: IdSchema,
    estado: EstadoAlquilerSchema,
    ingresoEn: FechaISOSchema,
    /** Cambia con cada hora adicional (RN-06, RN-08). */
    salidaProgramadaEn: FechaISOSchema,
    /** La cortesía se otorga una sola vez por alquiler (RN-04, RN-07). */
    cortesiaConsumida: z.boolean(),
    origenPrecio: OrigenPrecioAlquilerSchema,
    /** Precio de la habitación pactado al ingreso (lista o especial), antes de horas adicionales y ajuste (RN-44). */
    precioHabitacionAplicado: CentimosSchema,
    /** Horas adicionales pagadas en el mismo ingreso (RN-08 caso a, RF-64). No generan `HoraAdicional`. */
    horasAdicionalesAlIngreso: z.number().int().nonnegative(),
    /** Copia de la configuración vigente al ingreso: los cambios posteriores no la afectan (RN-43, PEND-08). */
    parametrosAplicados: ParametrosTiempoPrecioSchema,
    cerradoEn: FechaISOSchema.nullable(),
    cerradoPorId: IdSchema.nullable(),
    /** Cierre en sobretiempo sin cobrar (CU-07, RF-15). */
    salidaSinPago: z.boolean(),
    motivoSalidaSinPago: TextoRequeridoSchema.nullable(),
  })
  .strict()
  .superRefine((a, ctx) => {
    const ingreso = milisegundos(a.ingresoEn);
    const salida = milisegundos(a.salidaProgramadaEn);
    if (ingreso !== null && salida !== null) {
      const horasIniciales = a.parametrosAplicados.horasBase + a.horasAdicionalesAlIngreso;
      if (salida < ingreso + horasIniciales * MS_POR_HORA) {
        problema(
          ctx,
          ["salidaProgramadaEn"],
          "La salida programada no puede ser anterior al ingreso más las horas base y las pagadas al ingreso (RF-03).",
        );
      }
    }

    if (a.origenPrecio === "PRECIO_ESPECIAL" && a.clienteId === null) {
      problema(ctx, ["clienteId"], "Un precio especial requiere un cliente identificado (RN-14).");
    }

    if (a.estado === "CERRADO") {
      if (a.cerradoEn === null) problema(ctx, ["cerradoEn"], "Un alquiler cerrado requiere cerradoEn.");
      if (a.cerradoPorId === null) {
        problema(ctx, ["cerradoPorId"], "Un alquiler cerrado requiere cerradoPorId.");
      }
      const cierre = a.cerradoEn === null ? null : milisegundos(a.cerradoEn);
      if (ingreso !== null && cierre !== null && cierre < ingreso) {
        problema(ctx, ["cerradoEn"], "El cierre no puede ser anterior al ingreso.");
      }
    } else {
      if (a.cerradoEn !== null) problema(ctx, ["cerradoEn"], "Solo un alquiler cerrado tiene cerradoEn.");
      if (a.cerradoPorId !== null) {
        problema(ctx, ["cerradoPorId"], "Solo un alquiler cerrado tiene cerradoPorId.");
      }
    }

    if (a.salidaSinPago) {
      if (a.estado !== "CERRADO") {
        problema(ctx, ["salidaSinPago"], "Solo un alquiler cerrado puede registrar salida sin pago.");
      }
      if (a.motivoSalidaSinPago === null) {
        problema(ctx, ["motivoSalidaSinPago"], "La salida sin pago exige motivo (REASON_REQUIRED).");
      }
    } else if (a.motivoSalidaSinPago !== null) {
      problema(ctx, ["motivoSalidaSinPago"], "Solo una salida sin pago lleva motivo.");
    }
  });
export type Alquiler = z.infer<typeof AlquilerSchema>;

/**
 * Cobro de una hora adicional durante la estadía (§18.1, CU-05). Cada registro es exactamente una hora (RN-09).
 * `creadoEn` es el momento del pago:
 * - EXTENSION_ANTICIPADA: salidaNueva = salidaAnterior + 1 h (RN-08).
 * - LIQUIDACION_SOBRETIEMPO: salidaNueva = momento del pago + 1 h (RN-06).
 */
export const HoraAdicionalSchema = z
  .object({
    id: IdSchema,
    alquilerId: IdSchema,
    ticketId: IdSchema,
    tipo: TipoHoraAdicionalSchema,
    salidaAnterior: FechaISOSchema,
    salidaNueva: FechaISOSchema,
    creadoPorId: IdSchema,
    creadoEn: FechaISOSchema,
  })
  .strict()
  .superRefine((h, ctx) => {
    const anterior = milisegundos(h.salidaAnterior);
    const nueva = milisegundos(h.salidaNueva);
    const pago = milisegundos(h.creadoEn);
    if (anterior === null || nueva === null || pago === null) return;
    const bloque = MINUTOS_HORA_ADICIONAL * MS_POR_MINUTO;

    if (h.tipo === "EXTENSION_ANTICIPADA" && nueva !== anterior + bloque) {
      problema(ctx, ["salidaNueva"], "Una extensión anticipada suma una hora a la salida anterior (RN-08).");
    }
    if (h.tipo === "LIQUIDACION_SOBRETIEMPO") {
      if (pago <= anterior) {
        problema(ctx, ["creadoEn"], "Una liquidación de sobretiempo ocurre después de la salida anterior.");
      }
      if (nueva !== pago + bloque) {
        problema(ctx, ["salidaNueva"], "En sobretiempo, la nueva salida es el momento del pago más una hora (RN-06).");
      }
    }
  });
export type HoraAdicional = z.infer<typeof HoraAdicionalSchema>;
