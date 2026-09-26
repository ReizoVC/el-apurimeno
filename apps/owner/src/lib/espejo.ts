import {
  VERSION_RESUMEN_ESPEJO,
  desdeFilaResumenDia,
  desdeFilaResumenTurno,
  type FilaEstadoEspejo,
  type FilaResumenDia,
  type FilaResumenTurno,
  type ResumenDia,
  type ResumenTurno,
} from "@apurimeno/contracts";
import { diaLima, diasEntre, sumarDias, type Dia } from "@apurimeno/formato";
import { mensajeDe } from "./acceso";
import { supabase } from "./supabase";

// Lectura del resumen publicado por el servidor del local. Solo lectura: esta app nunca escribe en Supabase.

export type Periodo = "hoy" | "ayer" | "semana" | "mes";

export const PERIODOS: { id: Periodo; etiqueta: string }[] = [
  { id: "hoy", etiqueta: "Hoy" },
  { id: "ayer", etiqueta: "Ayer" },
  { id: "semana", etiqueta: "7 días" },
  { id: "mes", etiqueta: "Mes" },
];

/** Días de Lima del periodo, según la hora del celular (solo elige qué días pedir). */
export function diasDelPeriodo(
  periodo: Periodo,
  ahora: Date = new Date(),
): { desde: Dia; hasta: Dia } {
  const hoy = diaLima(ahora);
  switch (periodo) {
    case "hoy":
      return { desde: hoy, hasta: hoy };
    case "ayer":
      return { desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) };
    case "semana":
      return { desde: sumarDias(hoy, -6), hasta: hoy };
    case "mes":
      return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
  }
}

export interface DatosResumen {
  desde: Dia;
  hasta: Dia;
  cantidadDias: number;
  dias: ResumenDia[];
  turnos: ResumenTurno[];
  /** null si el local todavía no publicó nada. */
  estado: { ultimaSincronizacion: string; intervaloMinutos: number } | null;
}

export class ErrorDatos extends Error {}

export async function leerResumen(periodo: Periodo): Promise<DatosResumen> {
  const { desde, hasta } = diasDelPeriodo(periodo);
  const cliente = supabase();
  const [dias, turnos, estado] = await Promise.all([
    cliente
      .from("resumen_dia")
      .select("*")
      .gte("dia", desde)
      .lte("dia", hasta)
      .order("dia"),
    cliente
      .from("resumen_turno")
      .select("*")
      .gte("dia_cierre", desde)
      .lte("dia_cierre", hasta)
      .order("cerrado_en"),
    cliente.from("estado_espejo").select("*").maybeSingle(),
  ]);
  for (const r of [dias, turnos, estado])
    if (r.error !== null)
      throw new ErrorDatos(mensajeDe(new Error(r.error.message)));

  const filasDias = (dias.data ?? []) as FilaResumenDia[];
  const filasTurnos = (turnos.data ?? []) as FilaResumenTurno[];
  // Un formato más nuevo que esta app (el local se actualizó primero): mejor avisar que mostrar números a medias.
  if (
    [...filasDias, ...filasTurnos].some(
      (f) => f.version > VERSION_RESUMEN_ESPEJO,
    )
  ) {
    throw new ErrorDatos(
      "El local publica un formato más nuevo que esta app. Recargue la página para actualizarla.",
    );
  }
  let resumenesDia: ResumenDia[];
  let resumenesTurno: ResumenTurno[];
  try {
    resumenesDia = filasDias.map(desdeFilaResumenDia);
    resumenesTurno = filasTurnos.map(desdeFilaResumenTurno);
  } catch {
    throw new ErrorDatos(
      "Los datos publicados no tienen el formato esperado. Avise a quien administra el sistema.",
    );
  }
  const fila = estado.data as FilaEstadoEspejo | null;
  return {
    desde,
    hasta,
    cantidadDias: diasEntre(desde, hasta).length,
    dias: resumenesDia,
    turnos: resumenesTurno,
    estado:
      fila === null
        ? null
        : {
            ultimaSincronizacion: fila.ultima_sincronizacion,
            intervaloMinutos: fila.intervalo_minutos,
          },
  };
}
