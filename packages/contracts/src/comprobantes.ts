import { z } from "zod";
import { FechaISOSchema, IdSchema } from "./comun.js";
import { EstadoTrabajoImpresionSchema } from "./estados.js";

/**
 * Salida impresa de un ticket (§18.1). Una falla de impresión nunca revierte el cobro (RF-56).
 * El contenido lo compone el servidor: sin datos del cliente (RN-38) y declarado como no fiscal (RN-39).
 */
export const TrabajoImpresionSchema = z
  .object({
    id: IdSchema,
    ticketId: IdSchema,
    estado: EstadoTrabajoImpresionSchema,
    /** Reimpresión: el comprobante muestra "COPIA" (RF-44). */
    esCopia: z.boolean(),
    creadoEn: FechaISOSchema,
  })
  .strict();
export type TrabajoImpresion = z.infer<typeof TrabajoImpresionSchema>;
