import {
  AlquilerSchema,
  type Alquiler,
  type FechaISO,
  type Habitacion,
  type Id,
  type Turno,
} from "@apurimeno/contracts";
import { asegurarTurnoAbierto } from "./caja.js";
import { ErrorNegocio } from "./errores.js";
import { liberarPorAnulacion, liberarPorSalida, ocuparHabitacion } from "./habitaciones.js";
import { motivoRequerido } from "./interno.js";
import {
  cotizarHoraAdicional,
  cotizarIngreso,
  type Cotizacion,
  type CotizacionIngreso,
  type DatosCotizacionIngreso,
} from "./precios.js";
import type { Contexto } from "./tickets.js";
import {
  asegurarAlquilerAbierto,
  calcularEstadoTemporal,
  calcularHoraAdicional,
  calcularSalidaInicial,
  type EfectoHoraAdicional,
} from "./tiempo.js";

function asegurarMismaHabitacion(alquiler: Alquiler, habitacion: Habitacion): void {
  if (alquiler.habitacionId !== habitacion.id) {
    throw new RangeError(`El alquiler ${alquiler.id} no corresponde a la habitación ${habitacion.id}.`);
  }
}

export interface ResultadoIngreso {
  alquiler: Alquiler;
  habitacion: Habitacion;
  /** Base para el ticket de ingreso; admite un ajuste puntual antes de cobrar. */
  cotizacion: CotizacionIngreso;
}

/**
 * Registra un ingreso (CU-04; RN-01, RN-08 caso a, RN-13, RN-14, RN-27, RN-28, RN-32, RN-43, RN-44).
 * El alquiler guarda una copia del precio pactado y de la configuración vigente,
 * para que los cambios posteriores no lo afecten.
 */
export function iniciarAlquiler(
  datos: DatosCotizacionIngreso & { turno: Turno },
  ctx: Contexto,
): ResultadoIngreso {
  asegurarTurnoAbierto(datos.turno);
  const habitacion = ocuparHabitacion(datos.habitacion);
  const cotizacion = cotizarIngreso(datos);

  const alquiler = AlquilerSchema.parse({
    id: ctx.generarId(),
    habitacionId: habitacion.id,
    clienteId: datos.clienteId,
    turnoId: datos.turno.id,
    estado: "ABIERTO",
    ingresoEn: ctx.ahora,
    salidaProgramadaEn: calcularSalidaInicial(ctx.ahora, datos.parametros, datos.horasAdicionalesAlIngreso),
    cortesiaConsumida: false,
    origenPrecio: cotizacion.origenPrecio,
    precioHabitacionAplicado: cotizacion.precioHabitacion,
    horasAdicionalesAlIngreso: datos.horasAdicionalesAlIngreso,
    parametrosAplicados: { ...datos.parametros },
    cerradoEn: null,
    cerradoPorId: null,
    salidaSinPago: false,
    motivoSalidaSinPago: null,
  });
  return { alquiler, habitacion, cotizacion };
}

export interface ResultadoHoraAdicional {
  alquiler: Alquiler;
  efecto: EfectoHoraAdicional;
  /** Base para el ticket de la hora adicional; admite un ajuste puntual antes de cobrar. */
  cotizacion: Cotizacion;
}

/** Cobra una hora adicional durante la estadía (CU-05; RN-06 a RN-10, RN-32, decisión 13 de contracts). */
export function registrarHoraAdicional(alquiler: Alquiler, turno: Turno, ahora: FechaISO): ResultadoHoraAdicional {
  asegurarTurnoAbierto(turno);
  const efecto = calcularHoraAdicional(alquiler, ahora);
  return {
    alquiler: AlquilerSchema.parse({
      ...alquiler,
      salidaProgramadaEn: efecto.salidaNueva,
      cortesiaConsumida: efecto.cortesiaConsumida,
    }),
    efecto,
    cotizacion: cotizarHoraAdicional(alquiler),
  };
}

export interface ResultadoSalida {
  alquiler: Alquiler;
  habitacion: Habitacion;
}

/**
 * Salida sin cargo adicional (CU-06; RN-02, RN-12, RN-29): a tiempo, por vencer o en cortesía.
 * Una salida anticipada no genera devolución. En sobretiempo se rechaza con OVERTIME_UNRESOLVED:
 * primero se cobra la hora (`registrarHoraAdicional`) o se registra la salida sin pago.
 */
export function registrarSalida(
  alquiler: Alquiler,
  habitacion: Habitacion,
  datos: { usuarioId: Id; ahora: FechaISO },
): ResultadoSalida {
  asegurarMismaHabitacion(alquiler, habitacion);
  if (calcularEstadoTemporal(alquiler, datos.ahora) === "EN_SOBRETIEMPO") {
    throw new ErrorNegocio("OVERTIME_UNRESOLVED");
  }
  return {
    alquiler: AlquilerSchema.parse({
      ...alquiler,
      estado: "CERRADO",
      cerradoEn: datos.ahora,
      cerradoPorId: datos.usuarioId,
    }),
    habitacion: liberarPorSalida(habitacion),
  };
}

/** Salida en sobretiempo sin cobrar, con motivo obligatorio (CU-07; RN-12, RN-29, RF-15). Solo en sobretiempo. */
export function registrarSalidaSinPago(
  alquiler: Alquiler,
  habitacion: Habitacion,
  datos: { usuarioId: Id; ahora: FechaISO; motivo: string },
): ResultadoSalida {
  asegurarMismaHabitacion(alquiler, habitacion);
  const motivo = motivoRequerido(datos.motivo);
  if (calcularEstadoTemporal(alquiler, datos.ahora) !== "EN_SOBRETIEMPO") {
    throw new ErrorNegocio("INVALID_STATE_TRANSITION", "La salida sin pago solo aplica en sobretiempo.");
  }
  return {
    alquiler: AlquilerSchema.parse({
      ...alquiler,
      estado: "CERRADO",
      cerradoEn: datos.ahora,
      cerradoPorId: datos.usuarioId,
      salidaSinPago: true,
      motivoSalidaSinPago: motivo,
    }),
    habitacion: liberarPorSalida(habitacion),
  };
}

/**
 * Efecto de anular el ticket de ingreso de un alquiler abierto (RF-30, escenario 31.5):
 * el alquiler queda ANULADO y la habitación vuelve a LIBRE. Si el alquiler tiene horas adicionales
 * cuyo ticket sigue vigente, esas se anulan primero (escenario 31.5, alternativo).
 */
export function aplicarAnulacionIngreso(
  alquiler: Alquiler,
  habitacion: Habitacion,
  horasAdicionalesVigentes: number,
): ResultadoSalida {
  asegurarMismaHabitacion(alquiler, habitacion);
  asegurarAlquilerAbierto(alquiler);
  if (horasAdicionalesVigentes > 0) {
    throw new ErrorNegocio(
      "INVALID_STATE_TRANSITION",
      "Anule primero las horas adicionales de este alquiler.",
    );
  }
  return {
    alquiler: AlquilerSchema.parse({ ...alquiler, estado: "ANULADO" }),
    habitacion: liberarPorAnulacion(habitacion),
  };
}
