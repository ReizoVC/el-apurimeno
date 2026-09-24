import type { PeriodoConsulta, ReporteArqueos, ReporteOcupacion, ReporteVentas } from "@apurimeno/contracts";
import { resumirArqueos, resumirOcupacion, resumirVentas } from "@apurimeno/domain";
import { INCLUIR_TICKET, aAlquiler, aHabitacion, aHoraAdicional, aTicket, aTurno } from "../mapeo.js";
import type { ContextoServicio } from "./contexto.js";

// El servidor solo selecciona las filas del periodo [desde, hasta); la agregación es de @apurimeno/domain.

function rango(periodo: PeriodoConsulta) {
  return { gte: new Date(periodo.desde), lt: new Date(periodo.hasta) };
}

/** Ventas de los tickets emitidos en el periodo (RF-47). */
export async function reporteVentasServicio(ctx: ContextoServicio, periodo: PeriodoConsulta): Promise<ReporteVentas> {
  const filas = await ctx.prisma.ticket.findMany({ where: { creadoEn: rango(periodo) }, include: INCLUIR_TICKET });
  return resumirVentas(filas.map(aTicket));
}

/** Arqueos de los turnos cerrados en el periodo (§25). */
export async function reporteArqueosServicio(ctx: ContextoServicio, periodo: PeriodoConsulta): Promise<ReporteArqueos> {
  const filas = await ctx.prisma.turno.findMany({ where: { estado: "CERRADO", cerradoEn: rango(periodo) } });
  return resumirArqueos(filas.map(aTurno));
}

/** Ocupación de los alquileres ingresados en el periodo (RF-48). */
export async function reporteOcupacionServicio(ctx: ContextoServicio, periodo: PeriodoConsulta): Promise<ReporteOcupacion> {
  const alquileres = (await ctx.prisma.alquiler.findMany({ where: { ingresoEn: rango(periodo) } })).map(aAlquiler);
  const ids = alquileres.map((a) => a.id);
  const habitaciones = (await ctx.prisma.habitacion.findMany()).map(aHabitacion);
  const horas = (await ctx.prisma.horaAdicional.findMany({ where: { alquilerId: { in: ids } } })).map(aHoraAdicional);
  const tickets = (await ctx.prisma.ticket.findMany({ where: { alquilerId: { in: ids } }, include: INCLUIR_TICKET })).map(aTicket);
  return resumirOcupacion(habitaciones, alquileres, horas, tickets);
}
