import type { ConfiguracionGlobal } from "@apurimeno/contracts";
import { auditar } from "../auditoria.js";
import { aConfiguracion } from "../mapeo.js";
import type { ContextoServicio } from "./contexto.js";

export async function leerConfiguracion(ctx: ContextoServicio): Promise<ConfiguracionGlobal> {
  const fila = await ctx.prisma.configuracionGlobal.findUnique({ where: { id: 1 } });
  if (fila === null) throw new Error("Falta la configuración global: ejecute la semilla.");
  return aConfiguracion(fila);
}

/**
 * Reemplaza la configuración (CU-27). Rige para lo que empiece después: los alquileres abiertos conservan
 * los parámetros que copiaron al ingresar (RN-43). El cambio queda auditado con el valor previo.
 */
export async function cambiarConfiguracion(ctx: ContextoServicio, nueva: ConfiguracionGlobal): Promise<ConfiguracionGlobal> {
  return ctx.prisma.$transaction(async (tx) => {
    const fila = await tx.configuracionGlobal.findUnique({ where: { id: 1 } });
    if (fila === null) throw new Error("Falta la configuración global: ejecute la semilla.");
    await tx.configuracionGlobal.update({ where: { id: 1 }, data: nueva });
    await auditar(
      tx,
      {
        usuarioId: ctx.usuario.id,
        accion: "CONFIGURACION_CAMBIADA",
        tipoEntidad: "CONFIGURACION",
        entidadId: null,
        valorPrevio: aConfiguracion(fila),
        valorNuevo: nueva,
      },
      ctx.ahora,
    );
    return nueva;
  });
}
