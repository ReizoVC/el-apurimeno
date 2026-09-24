import { randomUUID } from "node:crypto";
import {
  RegistroAuditoriaSchema,
  type AccionAuditoria,
  type Id,
  type TipoEntidadAuditada,
} from "@apurimeno/contracts";
import type { Transaccion } from "./db.js";
import { jsonONulo } from "./mapeo.js";

export interface EventoAuditoria {
  usuarioId: Id | null;
  accion: AccionAuditoria;
  tipoEntidad: TipoEntidadAuditada;
  entidadId: Id | null;
  valorPrevio?: object | null;
  valorNuevo?: object | null;
  motivo?: string | null;
}

/**
 * Registra una acción sensible (RN-42, §23.1). Se llama dentro de la misma transacción que la operación:
 * si la operación se revierte, el registro también, y si se confirma, el registro existe siempre.
 */
export async function auditar(tx: Transaccion, evento: EventoAuditoria, ahora: Date): Promise<void> {
  const registro = RegistroAuditoriaSchema.parse({
    id: randomUUID(),
    ocurridoEn: ahora.toISOString(),
    usuarioId: evento.usuarioId,
    accion: evento.accion,
    tipoEntidad: evento.tipoEntidad,
    entidadId: evento.entidadId,
    valorPrevio: evento.valorPrevio ?? null,
    valorNuevo: evento.valorNuevo ?? null,
    motivo: evento.motivo ?? null,
  });
  await tx.registroAuditoria.create({
    data: {
      ...registro,
      ocurridoEn: ahora,
      valorPrevio: jsonONulo(evento.valorPrevio ?? null),
      valorNuevo: jsonONulo(evento.valorNuevo ?? null),
    },
  });
}
