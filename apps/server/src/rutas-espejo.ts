import {
  EstadoEspejoSchema,
  RUTAS,
  SincronizacionEspejoRespuestaSchema,
  SincronizarEspejoEntradaSchema,
} from "@apurimeno/contracts";
import type { FastifyInstance } from "fastify";
import { auditar } from "./auditoria.js";
import type { PrismaClient } from "./db.js";
import type { ControlEspejo } from "./espejo/control.js";
import { validar } from "./errores.js";
import { creadorContexto } from "./servicios/contexto.js";

/** Estado del espejo en la nube y "sincronizar ahora" (ADR-06), de `settings.manage`. */
export function registrarRutasEspejo(app: FastifyInstance, prisma: PrismaClient, ahora: () => Date, espejo: ControlEspejo): void {
  const ctx = creadorContexto(prisma, ahora);

  app.get(RUTAS.estadoEspejo, { config: { operacion: "CONSULTAR_ESTADO_ESPEJO" } }, async () =>
    EstadoEspejoSchema.parse(await espejo.estado()),
  );

  // Espera a que termine la vuelta (segundos): el Dashboard muestra el resultado, no un "en proceso".
  app.post(RUTAS.sincronizarEspejo, { config: { operacion: "SINCRONIZAR_ESPEJO" } }, async (request) => {
    const { completo } = validar(SincronizarEspejoEntradaSchema, request.body);
    const c = ctx(request);
    const resultado = await espejo.sincronizar(completo);
    const estado = await espejo.estado();
    // Solo las manuales se auditan: quién pidió publicar y qué pasó. Las automáticas quedan en el registro del servidor.
    await auditar(
      prisma,
      {
        usuarioId: c.usuario.id,
        accion: "ESPEJO_SINCRONIZADO",
        tipoEntidad: "ESPEJO",
        entidadId: null,
        valorNuevo: { completo, ...resultado, error: estado.ultimoError?.codigo ?? null },
      },
      c.ahora,
    );
    return SincronizacionEspejoRespuestaSchema.parse({ ...resultado, estado });
  });
}
