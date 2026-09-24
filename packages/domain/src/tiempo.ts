import {
  MINUTOS_HORA_ADICIONAL,
  type Alquiler,
  type EstadoTemporalAlquiler,
  type FechaISO,
  type ParametrosTiempoPrecio,
  type TipoHoraAdicional,
} from "@apurimeno/contracts";
import { ErrorNegocio } from "./errores.js";
import { MS_POR_HORA, MS_POR_MINUTO, iso, ms } from "./interno.js";

/** Lo que el cálculo de tiempo necesita de un alquiler. */
export type AlquilerParaTiempo = Pick<
  Alquiler,
  "estado" | "salidaProgramadaEn" | "cortesiaConsumida" | "parametrosAplicados"
>;

export function asegurarAlquilerAbierto(alquiler: Pick<Alquiler, "estado">): void {
  if (alquiler.estado !== "ABIERTO") throw new ErrorNegocio("RENTAL_NOT_OPEN");
}

/** Salida programada de un ingreso: horas base + horas pagadas al ingreso (RN-01, RN-08 caso a, RF-03). */
export function calcularSalidaInicial(
  ingresoEn: FechaISO,
  parametros: ParametrosTiempoPrecio,
  horasAdicionalesAlIngreso: number,
): FechaISO {
  if (!Number.isSafeInteger(horasAdicionalesAlIngreso) || horasAdicionalesAlIngreso < 0) {
    throw new RangeError(`Horas adicionales al ingreso inválidas: ${horasAdicionalesAlIngreso}`);
  }
  return iso(ms(ingresoEn) + (parametros.horasBase + horasAdicionalesAlIngreso) * MS_POR_HORA);
}

/**
 * Estado temporal de un alquiler abierto (RN-03, RN-04, RN-05, RN-11, RF-07).
 * Nunca se guarda: se recalcula con la hora del servidor (`ahora`) y los parámetros copiados al ingreso (RN-43).
 * - A_TIEMPO: faltan más de `minutosAviso` para la salida.
 * - POR_VENCER: faltan `minutosAviso` o menos, hasta la salida inclusive.
 * - EN_CORTESIA: pasó la salida, la cortesía no se consumió y el retraso es ≤ `minutosCortesia`.
 * - EN_SOBRETIEMPO: cualquier otro retraso.
 */
export function calcularEstadoTemporal(
  alquiler: AlquilerParaTiempo,
  ahora: FechaISO,
): EstadoTemporalAlquiler {
  asegurarAlquilerAbierto(alquiler);
  const t = ms(ahora);
  const salida = ms(alquiler.salidaProgramadaEn);
  const { minutosAviso, minutosCortesia } = alquiler.parametrosAplicados;

  if (t < salida - minutosAviso * MS_POR_MINUTO) return "A_TIEMPO";
  if (t <= salida) return "POR_VENCER";
  if (!alquiler.cortesiaConsumida && t <= salida + minutosCortesia * MS_POR_MINUTO) return "EN_CORTESIA";
  return "EN_SOBRETIEMPO";
}

export interface EfectoHoraAdicional {
  tipo: TipoHoraAdicional;
  estadoTemporalAlPagar: EstadoTemporalAlquiler;
  salidaAnterior: FechaISO;
  salidaNueva: FechaISO;
  cortesiaConsumida: boolean;
}

/**
 * Efecto de pagar una hora adicional en `ahora`. Sirve también para cotizar: el tipo se decide solo (RF-08).
 * Reglas (RN-06 a RN-09, RF-10, RF-11, decisión 13 de contracts):
 * - Extensión anticipada: la salida vigente + 1 h.
 * - Liquidación de sobretiempo: el momento del pago + 1 h.
 * - La cortesía queda consumida si al pagar el alquiler está en cortesía o en sobretiempo;
 *   pagar antes de vencer no la consume.
 */
export function calcularHoraAdicional(alquiler: AlquilerParaTiempo, ahora: FechaISO): EfectoHoraAdicional {
  const estado = calcularEstadoTemporal(alquiler, ahora);
  const tipo: TipoHoraAdicional =
    estado === "EN_SOBRETIEMPO" ? "LIQUIDACION_SOBRETIEMPO" : "EXTENSION_ANTICIPADA";
  const bloque = MINUTOS_HORA_ADICIONAL * MS_POR_MINUTO;
  const base = tipo === "EXTENSION_ANTICIPADA" ? ms(alquiler.salidaProgramadaEn) : ms(ahora);

  return {
    tipo,
    estadoTemporalAlPagar: estado,
    salidaAnterior: alquiler.salidaProgramadaEn,
    salidaNueva: iso(base + bloque),
    cortesiaConsumida:
      alquiler.cortesiaConsumida || estado === "EN_CORTESIA" || estado === "EN_SOBRETIEMPO",
  };
}
