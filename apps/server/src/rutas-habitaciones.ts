import {
  BloquearHabitacionEntradaSchema,
  HabitacionEntradaSchema,
  HabitacionSchema,
  RUTAS,
  ReportarMantenimientoEntradaSchema,
} from "@apurimeno/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "./db.js";
import { validar } from "./errores.js";
import { creadorContexto } from "./servicios/contexto.js";
import {
  bloquearHabitacionServicio,
  crearHabitacionServicio,
  editarHabitacionServicio,
  listarHabitaciones,
  listarPendientesLimpieza,
  marcarListaServicio,
  reactivarHabitacionServicio,
  reportarMantenimientoServicio,
} from "./servicios/habitaciones.js";

type ConId = FastifyRequest<{ Params: { id: string } }>;

/**
 * Limpieza (CU-15 a CU-17) y administración de habitaciones (CU-13, CU-14).
 *
 * Las tres rutas de limpieza son las que consume apps/cleaning: la lista (solo PENDIENTE_LIMPIEZA, filtrada
 * aquí), "marcar lista" y "reportar mantenimiento". Las dos acciones se envían solo con el id, sin cuerpo ni
 * idempotency-key (decisión 18 de contracts), y responden la habitación con su nuevo estado.
 */
export function registrarRutasHabitaciones(app: FastifyInstance, prisma: PrismaClient, ahora: () => Date): void {
  const ctx = creadorContexto(prisma, ahora);

  // --- Limpieza ---

  app.get(RUTAS.habitacionesPendientesLimpieza, { config: { operacion: "VER_PENDIENTES_LIMPIEZA" } }, async (request) =>
    HabitacionSchema.array().parse(await listarPendientesLimpieza(ctx(request))),
  );

  app.post(RUTAS.marcarHabitacionLista, { config: { operacion: "MARCAR_HABITACION_LISTA" } }, async (request: ConId) =>
    HabitacionSchema.parse(await marcarListaServicio(ctx(request), request.params.id)),
  );

  // El cuerpo es opcional: apps/cleaning hoy no envía motivo (RF-41 lo recomienda, no lo exige).
  app.post(RUTAS.reportarMantenimiento, { config: { operacion: "REPORTAR_MANTENIMIENTO" } }, async (request: ConId) => {
    const { motivo } = request.body === undefined ? { motivo: null } : validar(ReportarMantenimientoEntradaSchema, request.body);
    return HabitacionSchema.parse(await reportarMantenimientoServicio(ctx(request), request.params.id, motivo));
  });

  // --- Administración ---

  app.get(
    RUTAS.habitaciones,
    { config: { operacion: ["CONSULTAR_TABLERO", "GESTIONAR_HABITACIONES", "BLOQUEAR_O_REACTIVAR_HABITACION"] } },
    async (request) => HabitacionSchema.array().parse(await listarHabitaciones(ctx(request))),
  );

  app.post(RUTAS.habitaciones, { config: { operacion: "GESTIONAR_HABITACIONES" } }, async (request, reply) => {
    const habitacion = await crearHabitacionServicio(ctx(request), validar(HabitacionEntradaSchema, request.body));
    void reply.status(201);
    return HabitacionSchema.parse(habitacion);
  });

  app.put(RUTAS.habitacion, { config: { operacion: "GESTIONAR_HABITACIONES" } }, async (request: ConId) =>
    HabitacionSchema.parse(
      await editarHabitacionServicio(ctx(request), request.params.id, validar(HabitacionEntradaSchema, request.body)),
    ),
  );

  app.post(RUTAS.bloquearHabitacion, { config: { operacion: "BLOQUEAR_O_REACTIVAR_HABITACION" } }, async (request: ConId) => {
    const { motivo } = validar(BloquearHabitacionEntradaSchema, request.body);
    return HabitacionSchema.parse(await bloquearHabitacionServicio(ctx(request), request.params.id, motivo));
  });

  app.post(RUTAS.reactivarHabitacion, { config: { operacion: "BLOQUEAR_O_REACTIVAR_HABITACION" } }, async (request: ConId) =>
    HabitacionSchema.parse(await reactivarHabitacionServicio(ctx(request), request.params.id)),
  );
}
