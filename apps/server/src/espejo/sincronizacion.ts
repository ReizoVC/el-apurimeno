import { aFilaResumenDia, aFilaResumenTurno, type DiaCalendario } from "@apurimeno/contracts";
import { diaLocal, periodoDelDia, resumirDia, resumirTurno, sumarDias } from "@apurimeno/domain";
import type { PrismaClient } from "../db.js";
import { INCLUIR_TICKET, aAlquiler, aHabitacion, aHoraAdicional, aMetodoPago, aTicket, aTurno } from "../mapeo.js";
import type { TransporteEspejo } from "./transporte.js";

// El servidor solo elige qué días y turnos publicar y lee sus filas; el resumen lo calcula @apurimeno/domain.

/**
 * Margen hacia atrás al buscar cambios: una operación que empezó antes de la última sincronización pero se
 * confirmó después tiene su hora dentro de este margen, y no se pierde.
 */
export const MARGEN_CAMBIOS_MS = 5 * 60_000;

export interface OpcionesPublicacion {
  /** Hora del servidor al empezar: es la hora "datos al…" que verá la propietaria. */
  ahora: Date;
  /** Publicar todo el historial, no solo lo que cambió. */
  completo: boolean;
  intervaloMinutos: number;
  versionServidor: string;
}

export interface ResultadoPublicacion {
  dias: number;
  turnos: number;
  /** Si publicó todo el historial: porque se pidió o porque nunca se había sincronizado. */
  completo: boolean;
}

const dia = (fecha: Date) => diaLocal(fecha.toISOString());

/**
 * Días y turnos a publicar. Siempre hoy y ayer (así un día sin movimiento aparece en cero). Además, los días de
 * todo ticket emitido desde la última sincronización y los que ese ticket afecta: una anulación cambia el día
 * del cobro original; una hora adicional cambia la ocupación del día en que ingresó su alquiler. Y los turnos que
 * se cerraron o cuyas ventas cambiaron por una anulación. Sin sincronización previa, o si se pide, todo.
 */
async function elegir(prisma: PrismaClient, ahora: Date, cambiosDesde: Date | null) {
  const hoy = dia(ahora);
  const dias = new Set<DiaCalendario>([hoy, sumarDias(hoy, -1)]);

  if (cambiosDesde === null) {
    for (const t of await prisma.ticket.findMany({ select: { creadoEn: true } })) dias.add(dia(t.creadoEn));
    for (const a of await prisma.alquiler.findMany({ select: { ingresoEn: true } })) dias.add(dia(a.ingresoEn));
    const turnos = await prisma.turno.findMany({ where: { estado: "CERRADO" }, select: { id: true } });
    return { dias, turnoIds: new Set(turnos.map((t) => t.id)) };
  }

  const seleccion = { creadoEn: true, alquilerId: true, turnoId: true, ticketOriginalId: true } as const;
  const nuevos = await prisma.ticket.findMany({ where: { creadoEn: { gte: cambiosDesde } }, select: seleccion });
  const idsOriginales = nuevos.flatMap((t) => (t.ticketOriginalId === null ? [] : [t.ticketOriginalId]));
  const originales = await prisma.ticket.findMany({ where: { id: { in: idsOriginales } }, select: seleccion });
  const afectados = [...nuevos, ...originales];

  for (const t of afectados) dias.add(dia(t.creadoEn));
  const alquilerIds = afectados.flatMap((t) => (t.alquilerId === null ? [] : [t.alquilerId]));
  for (const a of await prisma.alquiler.findMany({ where: { id: { in: alquilerIds } }, select: { ingresoEn: true } })) {
    dias.add(dia(a.ingresoEn));
  }

  const turnos = await prisma.turno.findMany({
    where: {
      estado: "CERRADO",
      OR: [{ cerradoEn: { gte: cambiosDesde } }, { id: { in: afectados.map((t) => t.turnoId) } }],
    },
    select: { id: true },
  });
  return { dias, turnoIds: new Set(turnos.map((t) => t.id)) };
}

async function resumirDias(prisma: PrismaClient, dias: readonly DiaCalendario[], actualizadoEn: string) {
  const habitaciones = (await prisma.habitacion.findMany()).map(aHabitacion);
  const metodosPago = (await prisma.metodoPago.findMany()).map(aMetodoPago);
  const filas = [];
  for (const d of dias) {
    const periodo = periodoDelDia(d);
    const rango = { gte: new Date(periodo.desde), lt: new Date(periodo.hasta) };
    const tickets = (await prisma.ticket.findMany({ where: { creadoEn: rango }, include: INCLUIR_TICKET })).map(aTicket);
    const alquileres = (await prisma.alquiler.findMany({ where: { ingresoEn: rango } })).map(aAlquiler);
    const ids = alquileres.map((a) => a.id);
    const horasAdicionales = (await prisma.horaAdicional.findMany({ where: { alquilerId: { in: ids } } })).map(aHoraAdicional);
    const ticketsDeAlquileres = (
      await prisma.ticket.findMany({ where: { alquilerId: { in: ids } }, include: INCLUIR_TICKET })
    ).map(aTicket);
    const resumen = resumirDia(d, { tickets, alquileres, horasAdicionales, ticketsDeAlquileres, habitaciones, metodosPago });
    filas.push(aFilaResumenDia(resumen, actualizadoEn));
  }
  return filas;
}

async function resumirTurnos(prisma: PrismaClient, turnoIds: readonly string[], actualizadoEn: string) {
  const turnos = await prisma.turno.findMany({ where: { id: { in: [...turnoIds] } }, include: { usuario: true }, orderBy: { cerradoEn: "asc" } });
  const tickets = (await prisma.ticket.findMany({ where: { turnoId: { in: [...turnoIds] } }, include: INCLUIR_TICKET })).map(aTicket);
  return turnos.map((fila) => aFilaResumenTurno(resumirTurno(aTurno(fila), fila.usuario.nombreUsuario, tickets), actualizadoEn));
}

/**
 * Una vuelta de sincronización: arma el resumen de lo que cambió y lo publica. Solo si el espejo lo aceptó todo,
 * avanza la marca de cambios; si falla, la siguiente vuelta vuelve a intentar lo mismo (no se pierde nada).
 * Nunca escribe datos del negocio: solo lee, y guarda el estado de la sincronización (RNF-SYNC-01).
 */
export async function publicarResumen(
  prisma: PrismaClient,
  transporte: TransporteEspejo,
  opciones: OpcionesPublicacion,
): Promise<ResultadoPublicacion> {
  const { ahora } = opciones;
  const estado = await prisma.estadoEspejo.findUnique({ where: { id: 1 } });
  const cambiosDesde = opciones.completo ? null : (estado?.cambiosDesde ?? null);
  const { dias, turnoIds } = await elegir(prisma, ahora, cambiosDesde);

  const actualizadoEn = ahora.toISOString();
  const filasDias = await resumirDias(prisma, [...dias].sort(), actualizadoEn);
  const filasTurnos = await resumirTurnos(prisma, [...turnoIds], actualizadoEn);
  await transporte.publicar({
    dias: filasDias,
    turnos: filasTurnos,
    estado: { id: true, ultima_sincronizacion: actualizadoEn, intervalo_minutos: opciones.intervaloMinutos, version_servidor: opciones.versionServidor },
  });

  const exito = {
    ultimoIntentoEn: ahora,
    ultimoExitoEn: ahora,
    cambiosDesde: new Date(ahora.getTime() - MARGEN_CAMBIOS_MS),
    ultimoErrorCodigo: null,
    ultimoErrorMensaje: null,
    ultimoErrorEn: null,
  };
  await prisma.estadoEspejo.upsert({ where: { id: 1 }, create: { id: 1, ...exito }, update: exito });
  return { dias: filasDias.length, turnos: filasTurnos.length, completo: cambiosDesde === null };
}
