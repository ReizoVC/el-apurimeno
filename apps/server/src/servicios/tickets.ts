import type { Ticket, TicketsConsulta } from "@apurimeno/contracts";
import { INCLUIR_TICKET, aTicket } from "../mapeo.js";
import type { ContextoServicio } from "./contexto.js";

/** Tickets emitidos, por número o periodo, del más reciente al más antiguo. Solo lectura (CU-22). */
export async function buscarTickets(ctx: ContextoServicio, consulta: TicketsConsulta): Promise<Ticket[]> {
  const { numero, desde, hasta, limite } = consulta;
  const filas = await ctx.prisma.ticket.findMany({
    where: {
      numero,
      creadoEn: { ...(desde === undefined ? {} : { gte: new Date(desde) }), ...(hasta === undefined ? {} : { lt: new Date(hasta) }) },
    },
    include: INCLUIR_TICKET,
    orderBy: { numero: "desc" },
    take: limite,
  });
  return filas.map(aTicket);
}
