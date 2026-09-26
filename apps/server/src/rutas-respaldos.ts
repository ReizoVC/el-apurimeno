import { EstadoRespaldosSchema, RUTAS, RespaldarEntradaSchema, RespaldoRespuestaSchema } from "@apurimeno/contracts";
import type { FastifyInstance } from "fastify";
import { auditar } from "./auditoria.js";
import type { PrismaClient } from "./db.js";
import { validar } from "./errores.js";
import type { ControlRespaldos } from "./respaldo/control.js";
import { creadorContexto } from "./servicios/contexto.js";

/** Estado de los respaldos y "copiar ahora" (Planos §14.3), de `settings.manage`. */
export function registrarRutasRespaldos(app: FastifyInstance, prisma: PrismaClient, ahora: () => Date, respaldos: ControlRespaldos): void {
  const ctx = creadorContexto(prisma, ahora);

  app.get(RUTAS.estadoRespaldos, { config: { operacion: "CONSULTAR_ESTADO_RESPALDOS" } }, async () =>
    EstadoRespaldosSchema.parse(await respaldos.estado()),
  );

  // Espera a que termine la copia (segundos): el Dashboard muestra el resultado, no un "en proceso".
  app.post(RUTAS.respaldar, { config: { operacion: "RESPALDAR" } }, async (request) => {
    const { destino } = validar(RespaldarEntradaSchema, request.body);
    const c = ctx(request);
    const exito = await respaldos.respaldar(destino);
    const estado = await respaldos.estado();
    const copia = destino === "LOCAL" ? estado.local : estado.externo;
    // Solo las manuales se auditan; las automáticas quedan en el registro del servidor.
    await auditar(
      prisma,
      {
        usuarioId: c.usuario.id,
        accion: "RESPALDO_MANUAL",
        tipoEntidad: "RESPALDO",
        entidadId: null,
        valorNuevo: { destino, exito, archivo: exito ? copia.ultimoArchivo : null, error: copia.ultimoError?.codigo ?? null },
      },
      c.ahora,
    );
    return RespaldoRespuestaSchema.parse({ exito, estado });
  });
}
