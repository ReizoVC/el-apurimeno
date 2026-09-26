import { componerLineasComprobante } from "@apurimeno/domain";
import type { PrismaClient, Transaccion } from "../db.js";
import { INCLUIR_TICKET, aConfiguracion, aMetodoPago, aTicket } from "../mapeo.js";
import { comandosComprobante, OPCIONES_ESCPOS_POR_DEFECTO, type OpcionesEscPos } from "./escpos.js";
import type { TransporteImpresora } from "./transporte.js";

// Cola de impresión (ADR-05, RF-56). El trabajo se crea en la misma transacción que el cobro, así ningún cobro
// queda sin comprobante; se envía después de responder, y una falla de la impresora nunca revierte el cobro.

/** Encola el comprobante de un ticket (original o copia) dentro de la transacción del cobro. */
export async function encolarComprobante(tx: Transaccion, ticketId: string, esCopia: boolean, ahora: Date, id: string): Promise<string> {
  await tx.trabajoImpresion.create({ data: { id, ticketId, estado: "PENDIENTE", esCopia, creadoEn: ahora } });
  return id;
}

export interface Registro {
  info(datos: object, mensaje: string): void;
  error(datos: object, mensaje: string): void;
}

/**
 * Envía los trabajos PENDIENTE de un ticket: compone el comprobante (dominio), lo convierte a ESC/POS (parte 1)
 * y lo pasa al transporte. Sin transporte configurado, el trabajo sigue PENDIENTE. Si el envío falla, queda en
 * ERROR para reintentarlo; los reintentos automáticos son de la parte 2.
 */
export async function despacharPendientes(
  prisma: PrismaClient,
  transporte: TransporteImpresora | null,
  ticketId: string,
  registro: Registro,
  opciones: OpcionesEscPos = OPCIONES_ESCPOS_POR_DEFECTO,
): Promise<void> {
  const trabajos = await prisma.trabajoImpresion.findMany({ where: { ticketId, estado: "PENDIENTE" }, orderBy: { creadoEn: "asc" } });
  if (trabajos.length === 0) return;
  if (transporte === null) {
    registro.info({ ticketId, trabajos: trabajos.length }, "Comprobante en cola: no hay impresora configurada (IMPRESORA_DISPOSITIVO)");
    return;
  }
  const ticket = aTicket(await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: INCLUIR_TICKET }));
  const configuracion = await prisma.configuracionGlobal.findUniqueOrThrow({ where: { id: 1 } });
  const { comprobante, impresora } = aConfiguracion(configuracion);
  const metodosPago = (await prisma.metodoPago.findMany()).map(aMetodoPago);

  for (const trabajo of trabajos) {
    const lineas = componerLineasComprobante(ticket, { datos: comprobante, anchoPapelMm: impresora.anchoPapelMm, metodosPago, esCopia: trabajo.esCopia });
    try {
      await transporte.enviar(comandosComprobante(lineas, opciones));
      await prisma.trabajoImpresion.update({ where: { id: trabajo.id }, data: { estado: "IMPRESO" } });
    } catch (error) {
      await prisma.trabajoImpresion.update({ where: { id: trabajo.id }, data: { estado: "ERROR" } });
      registro.error({ err: error, ticketId, trabajoId: trabajo.id, transporte: transporte.descripcion }, "Falló la impresión del comprobante");
    }
  }
}
