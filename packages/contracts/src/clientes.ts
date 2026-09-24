import { z } from "zod";
import {
  CentimosSchema,
  FechaISOSchema,
  IdSchema,
  TextoRequeridoSchema,
} from "./comun.js";
import { problema } from "./interno.js";

/**
 * Persona reconocible en visitas futuras (§18.1). Se identifica por documento, por nombre o por ambos.
 * El documento es texto libre: el SRS no impone un formato (§21). Si hay documento, es la clave preferida (§32).
 * Estos datos nunca aparecen en un comprobante impreso (RN-38).
 */
export const ClienteSchema = z
  .object({
    id: IdSchema,
    documento: TextoRequeridoSchema.nullable(),
    nombre: TextoRequeridoSchema.nullable(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.documento === null && c.nombre === null) {
      problema(ctx, ["documento"], "Un cliente necesita documento o nombre.");
    }
  });
export type Cliente = z.infer<typeof ClienteSchema>;

/**
 * Precio fijo total para un cliente en UNA habitación (RN-14, RN-15).
 * Reemplaza el precio de lista; no se suma. Único por cliente + habitación (§21).
 * Solo lo gestiona quien tiene `client_pricing.manage` (RN-16).
 */
export const PrecioEspecialClienteSchema = z
  .object({
    id: IdSchema,
    clienteId: IdSchema,
    habitacionId: IdSchema,
    precio: CentimosSchema,
    creadoPorId: IdSchema,
    creadoEn: FechaISOSchema,
  })
  .strict();
export type PrecioEspecialCliente = z.infer<typeof PrecioEspecialClienteSchema>;
