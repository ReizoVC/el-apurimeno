import {
  AuditoriaConsultaSchema,
  AuditoriaRespuestaSchema,
  ConfiguracionEntradaSchema,
  ConfiguracionRespuestaSchema,
  MetodoPagoEntradaSchema,
  MetodoPagoRespuestaSchema,
  RUTAS,
} from "@apurimeno/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "./db.js";
import { validar } from "./errores.js";
import { consultarAuditoria } from "./servicios/auditoria.js";
import { cambiarConfiguracion, leerConfiguracion } from "./servicios/configuracion.js";
import { creadorContexto } from "./servicios/contexto.js";
import { crearMetodoPago, editarMetodoPagoServicio, listarMetodosPago } from "./servicios/metodos-pago.js";

type ConId = FastifyRequest<{ Params: { id: string } }>;

/** Configuración global (CU-27) y métodos de pago (RF-54), de `settings.manage`; consulta de auditoría (CU-25). */
export function registrarRutasConfiguracion(app: FastifyInstance, prisma: PrismaClient, ahora: () => Date): void {
  const ctx = creadorContexto(prisma, ahora);

  app.get(RUTAS.configuracion, { config: { operacion: "CONFIGURAR_PARAMETROS" } }, async (request) =>
    ConfiguracionRespuestaSchema.parse(await leerConfiguracion(ctx(request))),
  );

  app.put(RUTAS.configuracion, { config: { operacion: "CONFIGURAR_PARAMETROS" } }, async (request) =>
    ConfiguracionRespuestaSchema.parse(await cambiarConfiguracion(ctx(request), validar(ConfiguracionEntradaSchema, request.body))),
  );

  // El POS necesita la lista para cobrar; administrarla es de settings.manage.
  app.get(RUTAS.metodosPago, { config: { operacion: ["CONSULTAR_TABLERO", "CONFIGURAR_METODOS_PAGO"] } }, async (request) =>
    MetodoPagoRespuestaSchema.array().parse(await listarMetodosPago(ctx(request))),
  );

  app.post(RUTAS.metodosPago, { config: { operacion: "CONFIGURAR_METODOS_PAGO" } }, async (request, reply) => {
    const metodo = await crearMetodoPago(ctx(request), validar(MetodoPagoEntradaSchema, request.body));
    void reply.status(201);
    return MetodoPagoRespuestaSchema.parse(metodo);
  });

  app.put(RUTAS.metodoPago, { config: { operacion: "CONFIGURAR_METODOS_PAGO" } }, async (request: ConId) =>
    MetodoPagoRespuestaSchema.parse(
      await editarMetodoPagoServicio(ctx(request), request.params.id, validar(MetodoPagoEntradaSchema, request.body)),
    ),
  );

  app.get(RUTAS.auditoria, { config: { operacion: "CONSULTAR_AUDITORIA" } }, async (request) =>
    AuditoriaRespuestaSchema.parse(await consultarAuditoria(ctx(request), validar(AuditoriaConsultaSchema, request.query))),
  );
}
