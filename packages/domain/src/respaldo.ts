import {
  HORA_RESPALDO_EXTERNO_LIMA,
  INTERVALO_RESPALDO_LOCAL_MINUTOS,
  MARGEN_RESPALDO_EXTERNO_MINUTOS,
} from "@apurimeno/contracts";
import { diaLima, inicioDiaLima, sumarDias } from "@apurimeno/formato";
import { estaDesactualizado } from "./espejo.js";

// Cuándo toca cada respaldo y qué copias se borran (Planos §14.3, RNF-BKP-01). El servidor hace las copias; aquí
// solo se decide, con la hora que se le pase.

const MINUTO_MS = 60_000;

/** Las 04:00 de Lima de un día, en UTC. */
function citaDelDia(dia: string): Date {
  return new Date(inicioDiaLima(dia).getTime() + HORA_RESPALDO_EXTERNO_LIMA * 60 * MINUTO_MS);
}

/** Las 04:00 de Lima más recientes que no son posteriores a `ahora`. */
export function ultimaCitaRespaldoExterno(ahora: Date): Date {
  const hoy = citaDelDia(diaLima(ahora));
  return hoy.getTime() <= ahora.getTime() ? hoy : citaDelDia(sumarDias(diaLima(ahora), -1));
}

/** Las próximas 04:00 de Lima, estrictamente después de `ahora`. */
export function proximaCitaRespaldoExterno(ahora: Date): Date {
  return citaDelDia(sumarDias(diaLima(ultimaCitaRespaldoExterno(ahora)), 1));
}

/**
 * ¿Falta la copia externa del día? Sí, si no hay ninguna o si la más reciente es anterior a las últimas 04:00 de
 * Lima. Así, si el servidor estaba apagado a esa hora, la copia se hace apenas vuelve a encender.
 */
export function respaldoExternoPendiente(ultimoExito: string | null, ahora: Date): boolean {
  if (ultimoExito === null) return true;
  return Date.parse(ultimoExito) < ultimaCitaRespaldoExterno(ahora).getTime();
}

/**
 * ¿La copia externa está desactualizada? Sí, si falta la de hoy y ya pasó el margen después de las 04:00. Sin
 * ninguna copia todavía no se marca (igual que el espejo): la pantalla dice que no hay ninguna.
 */
export function respaldoExternoDesactualizado(ultimoExito: string | null, ahora: Date): boolean {
  if (ultimoExito === null || !respaldoExternoPendiente(ultimoExito, ahora)) return false;
  return ahora.getTime() - ultimaCitaRespaldoExterno(ahora).getTime() > MARGEN_RESPALDO_EXTERNO_MINUTOS * MINUTO_MS;
}

/** ¿Las copias locales están desactualizadas? Mismo criterio que el espejo: más de dos intervalos sin copia. */
export function respaldoLocalDesactualizado(ultimoExito: string | null, ahora: Date): boolean {
  return estaDesactualizado(ultimoExito, INTERVALO_RESPALDO_LOCAL_MINUTOS, ahora);
}

/**
 * Próxima copia local: un intervalo después del último intento (correcto o no), o ya si nunca se intentó o si ese
 * momento ya pasó (el servidor estuvo apagado).
 */
export function proximaCopiaLocal(ultimoIntento: string | null, ahora: Date): Date {
  if (ultimoIntento === null) return ahora;
  const siguiente = Date.parse(ultimoIntento) + INTERVALO_RESPALDO_LOCAL_MINUTOS * MINUTO_MS;
  return new Date(Math.max(siguiente, ahora.getTime()));
}

/**
 * Copias que ya pasaron su retención y se pueden borrar. La más reciente nunca se borra, aunque sea vieja: si las
 * copias dejaran de hacerse, la retención no debe dejar la carpeta vacía.
 */
export function respaldosVencidos<T extends { creadoEn: string }>(copias: readonly T[], ahora: Date, retencionMs: number): T[] {
  if (copias.length === 0) return [];
  const masReciente = copias.reduce((a, b) => (Date.parse(b.creadoEn) > Date.parse(a.creadoEn) ? b : a));
  const limite = ahora.getTime() - retencionMs;
  return copias.filter((c) => c !== masReciente && Date.parse(c.creadoEn) < limite);
}
