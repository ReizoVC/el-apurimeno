import {
  ClienteEntradaSchema,
  ClienteSchema,
  ClientesConsultaSchema,
  CrearPrecioEspecialEntradaSchema,
  EditarPrecioEspecialEntradaSchema,
  PrecioEspecialRespuestaSchema,
  RUTAS,
} from "@apurimeno/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "./db.js";
import { validar } from "./errores.js";
import {
  buscarClientes,
  crearClienteServicio,
  crearPrecioEspecialServicio,
  editarClienteServicio,
  editarPrecioEspecialServicio,
  eliminarPrecioEspecialServicio,
  listarPreciosEspeciales,
} from "./servicios/clientes.js";
import { creadorContexto } from "./servicios/contexto.js";

type ConId = FastifyRequest<{ Params: { id: string } }>;
type ConHabitacion = FastifyRequest<{ Params: { id: string; habitacionId: string } }>;

/**
 * Clientes (CU-09) y precios especiales (CU-08). El cajero busca y registra clientes al tomar un ingreso;
 * solo quien tiene `client_pricing.manage` gestiona precios especiales (RN-16).
 */
export function registrarRutasClientes(app: FastifyInstance, prisma: PrismaClient, ahora: () => Date): void {
  const ctx = creadorContexto(prisma, ahora);

  app.get(RUTAS.clientes, { config: { operacion: ["BUSCAR_CLIENTE", "GESTIONAR_PRECIO_ESPECIAL"] } }, async (request) => {
    const { q } = validar(ClientesConsultaSchema, request.query);
    return ClienteSchema.array().parse(await buscarClientes(ctx(request), q));
  });

  app.post(RUTAS.clientes, { config: { operacion: ["REGISTRAR_CLIENTE", "GESTIONAR_PRECIO_ESPECIAL"] } }, async (request, reply) => {
    const cliente = await crearClienteServicio(ctx(request), validar(ClienteEntradaSchema, request.body));
    void reply.status(201);
    return ClienteSchema.parse(cliente);
  });

  app.put(RUTAS.cliente, { config: { operacion: ["REGISTRAR_CLIENTE", "GESTIONAR_PRECIO_ESPECIAL"] } }, async (request: ConId) =>
    ClienteSchema.parse(await editarClienteServicio(ctx(request), request.params.id, validar(ClienteEntradaSchema, request.body))),
  );

  app.get(RUTAS.preciosEspecialesCliente, { config: { operacion: "GESTIONAR_PRECIO_ESPECIAL" } }, async (request: ConId) =>
    PrecioEspecialRespuestaSchema.array().parse(await listarPreciosEspeciales(ctx(request), request.params.id)),
  );

  app.post(RUTAS.preciosEspecialesCliente, { config: { operacion: "GESTIONAR_PRECIO_ESPECIAL" } }, async (request: ConId, reply) => {
    const entrada = validar(CrearPrecioEspecialEntradaSchema, request.body);
    const precio = await crearPrecioEspecialServicio(ctx(request), request.params.id, entrada);
    void reply.status(201);
    return PrecioEspecialRespuestaSchema.parse(precio);
  });

  app.put(RUTAS.precioEspecialCliente, { config: { operacion: "GESTIONAR_PRECIO_ESPECIAL" } }, async (request: ConHabitacion) => {
    const { precio } = validar(EditarPrecioEspecialEntradaSchema, request.body);
    const { id, habitacionId } = request.params;
    return PrecioEspecialRespuestaSchema.parse(await editarPrecioEspecialServicio(ctx(request), id, habitacionId, precio));
  });

  app.delete(RUTAS.precioEspecialCliente, { config: { operacion: "GESTIONAR_PRECIO_ESPECIAL" } }, async (request: ConHabitacion, reply) => {
    await eliminarPrecioEspecialServicio(ctx(request), request.params.id, request.params.habitacionId);
    return reply.status(204).send();
  });
}
