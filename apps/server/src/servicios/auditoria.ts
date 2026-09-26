import type { AuditoriaConsulta, AuditoriaRespuesta } from "@apurimeno/contracts";
import { aRegistroAuditoria } from "../mapeo.js";
import type { ContextoServicio } from "./contexto.js";

/**
 * Consulta de auditoría (CU-25, RF-46): solo lectura, porque el registro es inmutable (RF-57). Todos los
 * filtros se combinan. Página por cursor, del más reciente al más antiguo. El id desempata registros del
 * mismo milisegundo: así el orden es estable y ninguno se repite ni se pierde entre páginas, aunque entre
 * esos pocos no refleja el orden en que ocurrieron.
 */
export async function consultarAuditoria(ctx: ContextoServicio, consulta: AuditoriaConsulta): Promise<AuditoriaRespuesta> {
  const { usuarioId, accion, tipoEntidad, entidadId, desde, hasta, limite, despuesDe } = consulta;
  const filas = await ctx.prisma.registroAuditoria.findMany({
    where: {
      usuarioId,
      accion,
      tipoEntidad,
      entidadId,
      ocurridoEn: { ...(desde === undefined ? {} : { gte: new Date(desde) }), ...(hasta === undefined ? {} : { lt: new Date(hasta) }) },
    },
    orderBy: [{ ocurridoEn: "desc" }, { id: "desc" }],
    take: limite + 1,
    ...(despuesDe === undefined ? {} : { cursor: { id: despuesDe }, skip: 1 }),
  });
  const pagina = filas.slice(0, limite);
  return {
    registros: pagina.map(aRegistroAuditoria),
    siguiente: filas.length > limite ? (pagina.at(-1)?.id ?? null) : null,
  };
}
