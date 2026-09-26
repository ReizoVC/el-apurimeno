import type { Tablero } from "@apurimeno/contracts";
import { calcularEstadoTemporal } from "@apurimeno/domain";
import { INCLUIR_TICKET, aAlquiler, aHabitacion, aTicket } from "../mapeo.js";
import type { ContextoServicio } from "./contexto.js";

/**
 * Tablero del POS: las habitaciones por número, cada una con su alquiler abierto (a lo sumo uno, RN-27) y el
 * estado temporal que calcula el dominio con la hora del servidor (RN-11). Solo lectura.
 */
export async function tableroServicio(ctx: ContextoServicio): Promise<Tablero> {
  const ahora = ctx.ahora.toISOString();
  const habitaciones = (await ctx.prisma.habitacion.findMany({ orderBy: { numero: "asc" } })).map(aHabitacion);
  const alquileres = (await ctx.prisma.alquiler.findMany({ where: { estado: "ABIERTO" } })).map(aAlquiler);
  const tickets = (
    await ctx.prisma.ticket.findMany({
      where: { alquilerId: { in: alquileres.map((a) => a.id) } },
      include: INCLUIR_TICKET,
      orderBy: { numero: "asc" },
    })
  ).map(aTicket);

  const porHabitacion = new Map(alquileres.map((a) => [a.habitacionId, a]));
  return {
    ahora,
    habitaciones: habitaciones.map((habitacion) => {
      const alquiler = porHabitacion.get(habitacion.id);
      return {
        habitacion,
        alquiler:
          alquiler === undefined
            ? null
            : {
                alquiler,
                estadoTemporal: calcularEstadoTemporal(alquiler, ahora),
                tickets: tickets.filter((t) => t.alquilerId === alquiler.id),
              },
      };
    }),
  };
}
