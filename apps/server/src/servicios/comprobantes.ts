import type { ReimpresionRespuesta } from "@apurimeno/contracts";
import { componerComprobante } from "@apurimeno/domain";
import { auditar } from "../auditoria.js";
import { INCLUIR_TICKET, aConfiguracion, aMetodoPago, aTicket, aTrabajoImpresion } from "../mapeo.js";
import { contextoDominio, noEncontrado, type ContextoServicio } from "./contexto.js";

/**
 * Reimpresión (CU-22, RF-44): encola una copia del comprobante de un ticket ya emitido y la audita. El
 * contenido lo compone el dominio con la configuración vigente. Enviarlo a la impresora (ESC/POS por USB
 * o Bluetooth, ADR-05) todavía no está implementado: el trabajo queda PENDIENTE hasta que exista el
 * servicio de impresión.
 */
export async function reimprimirTicketServicio(ctx: ContextoServicio, ticketId: string): Promise<ReimpresionRespuesta> {
  return ctx.prisma.$transaction(async (tx) => {
    const fila = await tx.ticket.findUnique({ where: { id: ticketId }, include: INCLUIR_TICKET });
    if (fila === null) throw noEncontrado("El ticket");
    const configuracion = await tx.configuracionGlobal.findUnique({ where: { id: 1 } });
    if (configuracion === null) throw new Error("Falta la configuración global: ejecute la semilla.");
    const { comprobante, impresora } = aConfiguracion(configuracion);

    const contenido = componerComprobante(aTicket(fila), {
      datos: comprobante,
      anchoPapelMm: impresora.anchoPapelMm,
      metodosPago: (await tx.metodoPago.findMany()).map(aMetodoPago),
      esCopia: true,
    });
    const trabajo = aTrabajoImpresion(
      await tx.trabajoImpresion.create({
        data: { id: contextoDominio(ctx.ahora).generarId(), ticketId, estado: "PENDIENTE", esCopia: true, creadoEn: ctx.ahora },
      }),
    );
    await auditar(
      tx,
      { usuarioId: ctx.usuario.id, accion: "COMPROBANTE_REIMPRESO", tipoEntidad: "TICKET", entidadId: ticketId, valorNuevo: { trabajoId: trabajo.id } },
      ctx.ahora,
    );
    return { trabajo, contenido };
  });
}
