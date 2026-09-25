import {
  CambiarContrasenaEntradaSchema,
  CrearUsuarioEntradaSchema,
  EditarUsuarioEntradaSchema,
  RUTAS,
  RangoEntradaSchema,
  RangoRespuestaSchema,
  UsuarioRespuestaSchema,
} from "@apurimeno/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "./db.js";
import { validar } from "./errores.js";
import { creadorContexto } from "./servicios/contexto.js";
import {
  cambiarContrasenaServicio,
  crearRangoServicio,
  crearUsuarioServicio,
  editarRangoServicio,
  editarUsuarioServicio,
  listarRangos,
  listarUsuarios,
} from "./servicios/usuarios.js";

type ConId = FastifyRequest<{ Params: { id: string } }>;

/** Usuarios (CU-23) y rangos (CU-24), exclusivo de `users.manage`. Las respuestas nunca incluyen la contraseña ni su hash. */
export function registrarRutasUsuarios(app: FastifyInstance, prisma: PrismaClient, ahora: () => Date, costoBcrypt: number): void {
  const ctx = creadorContexto(prisma, ahora);

  app.get(RUTAS.usuarios, { config: { operacion: "GESTIONAR_USUARIOS" } }, async (request) =>
    UsuarioRespuestaSchema.array().parse(await listarUsuarios(ctx(request))),
  );

  app.post(RUTAS.usuarios, { config: { operacion: "GESTIONAR_USUARIOS" } }, async (request, reply) => {
    const usuario = await crearUsuarioServicio(ctx(request), validar(CrearUsuarioEntradaSchema, request.body), costoBcrypt);
    void reply.status(201);
    return UsuarioRespuestaSchema.parse(usuario);
  });

  app.put(RUTAS.usuario, { config: { operacion: "GESTIONAR_USUARIOS" } }, async (request: ConId) =>
    UsuarioRespuestaSchema.parse(
      await editarUsuarioServicio(ctx(request), request.params.id, validar(EditarUsuarioEntradaSchema, request.body)),
    ),
  );

  app.put(RUTAS.contrasenaUsuario, { config: { operacion: "GESTIONAR_USUARIOS" } }, async (request: ConId, reply) => {
    const { contrasena } = validar(CambiarContrasenaEntradaSchema, request.body);
    await cambiarContrasenaServicio(ctx(request), request.params.id, contrasena, costoBcrypt);
    return reply.status(204).send();
  });

  app.get(RUTAS.rangos, { config: { operacion: ["GESTIONAR_USUARIOS", "GESTIONAR_RANGOS"] } }, async (request) =>
    RangoRespuestaSchema.array().parse(await listarRangos(ctx(request))),
  );

  // --- Rangos (CU-24) ---

  app.post(RUTAS.rangos, { config: { operacion: "GESTIONAR_RANGOS" } }, async (request, reply) => {
    const rango = await crearRangoServicio(ctx(request), validar(RangoEntradaSchema, request.body));
    void reply.status(201);
    return RangoRespuestaSchema.parse(rango);
  });

  app.put(RUTAS.rango, { config: { operacion: "GESTIONAR_RANGOS" } }, async (request: ConId) =>
    RangoRespuestaSchema.parse(await editarRangoServicio(ctx(request), request.params.id, validar(RangoEntradaSchema, request.body))),
  );
}
