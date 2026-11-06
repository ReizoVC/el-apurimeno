import { EstadoActualizacionSchema, RUTAS } from "@apurimeno/contracts";
import type { FastifyInstance } from "fastify";
import type { ControlActualizacion } from "./actualizacion/control.js";

/** Aviso de versiones nuevas (decisión 30), de `system.update`. */
export function registrarRutasActualizacion(app: FastifyInstance, actualizacion: ControlActualizacion): void {
  app.get(RUTAS.estadoActualizacion, { config: { operacion: "CONSULTAR_ACTUALIZACION" } }, async () =>
    EstadoActualizacionSchema.parse(actualizacion.estado()),
  );
}
