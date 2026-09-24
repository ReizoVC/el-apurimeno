import {
  AbrirTurnoEntradaSchema,
  CerrarTurnoEntradaSchema,
  CotizacionHoraAdicionalRespuestaSchema,
  CotizacionIngresoRespuestaSchema,
  CotizarIngresoEntradaSchema,
  RUTAS,
  RegistrarHoraAdicionalEntradaSchema,
  RegistrarHoraAdicionalRespuestaSchema,
  RegistrarIngresoEntradaSchema,
  RegistrarIngresoRespuestaSchema,
  SalidaRespuestaSchema,
  SalidaSinPagoEntradaSchema,
  TurnoRespuestaSchema,
} from "@apurimeno/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { usuarioDe } from "./auth.js";
import type { PrismaClient } from "./db.js";
import { validar } from "./errores.js";
import {
  cotizarHoraAdicionalServicio,
  cotizarIngresoServicio,
  registrarHoraAdicionalServicio,
  registrarIngresoServicio,
  registrarSalidaServicio,
  registrarSalidaSinPagoServicio,
} from "./servicios/alquileres.js";
import { claveIdempotencia } from "./servicios/cobros.js";
import type { ContextoServicio } from "./servicios/contexto.js";
import { abrirTurno, cerrarTurnoPropio } from "./servicios/turnos.js";

type ConId = FastifyRequest<{ Params: { id: string } }>;

/** Un reintento idempotente responde 200 con el resultado original; la primera vez, 201. */
function responderCobro<T>(reply: FastifyReply, { resultado, repetido }: { resultado: T; repetido: boolean }): T {
  void reply.status(repetido ? 200 : 201).header("idempotent-replayed", String(repetido));
  return resultado;
}

/**
 * Endpoints del flujo de ingreso de punta a punta: turnos y alquileres. Cada ruta declara la operación
 * que exige; el middleware de auth.ts verifica `puede()` antes de llegar aquí. Toda respuesta se valida
 * con su esquema de contracts.
 */
export function registrarRutas(app: FastifyInstance, prisma: PrismaClient, ahora: () => Date): void {
  const ctx = (request: FastifyRequest): ContextoServicio => ({ prisma, usuario: usuarioDe(request), ahora: ahora() });

  app.get(RUTAS.salud, { config: { publica: true } }, async () => ({ estado: "ok" }));

  app.post(RUTAS.abrirTurno, { config: { operacion: "ABRIR_TURNO" } }, async (request, reply) => {
    const turno = await abrirTurno(ctx(request), validar(AbrirTurnoEntradaSchema, request.body));
    void reply.status(201);
    return TurnoRespuestaSchema.parse(turno);
  });

  app.post(RUTAS.cerrarTurno, { config: { operacion: "CERRAR_TURNO" } }, async (request) =>
    TurnoRespuestaSchema.parse(await cerrarTurnoPropio(ctx(request), validar(CerrarTurnoEntradaSchema, request.body))),
  );

  app.post(RUTAS.cotizarIngreso, { config: { operacion: "REGISTRAR_INGRESO" } }, async (request) =>
    CotizacionIngresoRespuestaSchema.parse(
      await cotizarIngresoServicio(ctx(request), validar(CotizarIngresoEntradaSchema, request.body)),
    ),
  );

  app.post(RUTAS.registrarIngreso, { config: { operacion: "REGISTRAR_INGRESO" } }, async (request, reply) => {
    const clave = claveIdempotencia(request);
    const entrada = validar(RegistrarIngresoEntradaSchema, request.body);
    const r = await registrarIngresoServicio(ctx(request), entrada, clave);
    return RegistrarIngresoRespuestaSchema.parse(responderCobro(reply, r));
  });

  app.get(RUTAS.cotizarHoraAdicional, { config: { operacion: "COBRAR_HORA_ADICIONAL" } }, async (request: ConId) =>
    CotizacionHoraAdicionalRespuestaSchema.parse(await cotizarHoraAdicionalServicio(ctx(request), request.params.id)),
  );

  app.post(RUTAS.registrarHoraAdicional, { config: { operacion: "COBRAR_HORA_ADICIONAL" } }, async (request: ConId, reply) => {
    const clave = claveIdempotencia(request);
    const entrada = validar(RegistrarHoraAdicionalEntradaSchema, request.body);
    const r = await registrarHoraAdicionalServicio(ctx(request), request.params.id, entrada, clave);
    return RegistrarHoraAdicionalRespuestaSchema.parse(responderCobro(reply, r));
  });

  app.post(RUTAS.registrarSalida, { config: { operacion: "REGISTRAR_SALIDA" } }, async (request: ConId) =>
    SalidaRespuestaSchema.parse(await registrarSalidaServicio(ctx(request), request.params.id)),
  );

  app.post(RUTAS.registrarSalidaSinPago, { config: { operacion: "REGISTRAR_SALIDA_SIN_PAGO" } }, async (request: ConId) => {
    const { motivo } = validar(SalidaSinPagoEntradaSchema, request.body);
    return SalidaRespuestaSchema.parse(await registrarSalidaSinPagoServicio(ctx(request), request.params.id, motivo));
  });
}
