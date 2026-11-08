import { EstadoActualizacionSchema, InstalarActualizacionEntradaSchema, RUTAS } from "@apurimeno/contracts";
import type { FastifyInstance } from "fastify";
import type { ControlActualizacion } from "./actualizacion/control.js";
import { auditar } from "./auditoria.js";
import type { PrismaClient } from "./db.js";
import { validar } from "./errores.js";
import { creadorContexto } from "./servicios/contexto.js";

/** Aviso de versiones nuevas e instalación (decisión 30), de `system.update`. */
export function registrarRutasActualizacion(app: FastifyInstance, prisma: PrismaClient, ahora: () => Date, actualizacion: ControlActualizacion): void {
  const ctx = creadorContexto(prisma, ahora);

  app.get(RUTAS.estadoActualizacion, { config: { operacion: "CONSULTAR_ACTUALIZACION" } }, async () =>
    EstadoActualizacionSchema.parse(actualizacion.estado()),
  );

  app.post(RUTAS.instalarActualizacion, { config: { operacion: "INSTALAR_ACTUALIZACION" } }, async (request) => {
    const { version } = validar(InstalarActualizacionEntradaSchema, request.body);
    const c = ctx(request);
    actualizacion.comprobarInstalable(version);
    // Antes de lanzarla: la tarea reinicia este servidor, y después ya no habría quién lo registre.
    await auditar(
      prisma,
      { usuarioId: c.usuario.id, accion: "ACTUALIZACION_INICIADA", tipoEntidad: "SISTEMA", entidadId: null, valorNuevo: { version } },
      c.ahora,
    );
    await actualizacion.instalar(version);
    return EstadoActualizacionSchema.parse(actualizacion.estado());
  });
}
