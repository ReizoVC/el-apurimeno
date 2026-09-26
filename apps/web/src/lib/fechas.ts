import type { PeriodoConsulta } from "@apurimeno/contracts";
import { ZONA_NEGOCIO } from "./formato";

// Periodos de consulta. El servidor recibe [desde, hasta) en UTC; el negocio piensa en días de Lima.
// Lima está en UTC−5 todo el año (sin horario de verano), así que un día de Lima empieza a las 05:00 UTC.

const DESFASE_LIMA_MS = 5 * 3_600_000;
const formatoDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_NEGOCIO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Día de Lima ("AAAA-MM-DD") de un instante. */
export function diaLima(instante: Date): string {
  return formatoDia.format(instante);
}

/** Inicio (UTC) de un día de Lima. */
export function inicioDia(dia: string): Date {
  return new Date(Date.parse(`${dia}T00:00:00.000Z`) + DESFASE_LIMA_MS);
}

/** Suma días a un día de Lima. */
export function sumarDias(dia: string, dias: number): string {
  const fecha = new Date(`${dia}T12:00:00.000Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** Periodo de días de Lima, ambos incluidos: [inicio de `desde`, inicio del día siguiente a `hasta`). */
export function periodoDeDias(desde: string, hasta: string): PeriodoConsulta {
  return {
    desde: inicioDia(desde).toISOString(),
    hasta: inicioDia(sumarDias(hasta, 1)).toISOString(),
  };
}
