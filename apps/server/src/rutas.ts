import {
  AbrirTurnoEntradaSchema,
  AnularTicketEntradaSchema,
  AnularTicketRespuestaSchema,
  CategoriaProductoEntradaSchema,
  CategoriaProductoSchema,
  CerrarTurnoEntradaSchema,
  CotizacionHoraAdicionalRespuestaSchema,
  CotizacionIngresoRespuestaSchema,
  CotizarIngresoEntradaSchema,
  GenerarCodigoAutorizacionRespuestaSchema,
  PeriodoConsultaSchema,
  ProductoEntradaSchema,
  ProductoSchema,
  ProductosConsultaSchema,
  RUTAS,
  RegistrarHoraAdicionalEntradaSchema,
  RegistrarHoraAdicionalRespuestaSchema,
  RegistrarIngresoEntradaSchema,
  RegistrarIngresoRespuestaSchema,
  RegistrarVentaEntradaSchema,
  RegistrarVentaRespuestaSchema,
  ReporteArqueosSchema,
  ReporteOcupacionSchema,
  ReporteVentasSchema,
  ReposicionEntradaSchema,
  ReposicionRespuestaSchema,
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
import { anularTicketServicio, generarCodigoServicio, type SecretoCodigos } from "./servicios/anulacion.js";
import { claveIdempotencia } from "./servicios/cobros.js";
import type { ContextoServicio } from "./servicios/contexto.js";
import { reporteArqueosServicio, reporteOcupacionServicio, reporteVentasServicio } from "./servicios/reportes.js";
import {
  crearCategoria,
  crearProducto,
  editarProducto,
  listarCategorias,
  listarProductos,
  registrarVentaServicio,
  reponerProducto,
} from "./servicios/tienda.js";
import { abrirTurno, cerrarTurnoPropio } from "./servicios/turnos.js";

type ConId = FastifyRequest<{ Params: { id: string } }>;

/** Un reintento idempotente responde 200 con el resultado original; la primera vez, 201. */
function responderCobro<T>(reply: FastifyReply, { resultado, repetido }: { resultado: T; repetido: boolean }): T {
  void reply.status(repetido ? 200 : 201).header("idempotent-replayed", String(repetido));
  return resultado;
}

/**
 * Endpoints de la API local: turnos, alquileres, tienda, anulación y reportes. Cada ruta declara la
 * operación que exige; el middleware de auth.ts verifica `puede()` antes de llegar aquí. Toda respuesta
 * se valida con su esquema de contracts.
 */
export function registrarRutas(
  app: FastifyInstance,
  prisma: PrismaClient,
  ahora: () => Date,
  secretoCodigos: SecretoCodigos,
): void {
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

  // --- Tienda ---

  app.get(RUTAS.categoriasProducto, { config: { operacion: ["VENDER", "GESTIONAR_PRODUCTOS"] } }, async (request) =>
    CategoriaProductoSchema.array().parse(await listarCategorias(ctx(request))),
  );

  app.post(RUTAS.categoriasProducto, { config: { operacion: "GESTIONAR_PRODUCTOS" } }, async (request, reply) => {
    const categoria = await crearCategoria(ctx(request), validar(CategoriaProductoEntradaSchema, request.body));
    void reply.status(201);
    return CategoriaProductoSchema.parse(categoria);
  });

  app.get(RUTAS.productos, { config: { operacion: ["VENDER", "GESTIONAR_PRODUCTOS"] } }, async (request) => {
    const { codigoBarras } = validar(ProductosConsultaSchema, request.query);
    return ProductoSchema.array().parse(await listarProductos(ctx(request), codigoBarras));
  });

  app.post(RUTAS.productos, { config: { operacion: "GESTIONAR_PRODUCTOS" } }, async (request, reply) => {
    const producto = await crearProducto(ctx(request), validar(ProductoEntradaSchema, request.body));
    void reply.status(201);
    return ProductoSchema.parse(producto);
  });

  app.put(RUTAS.producto, { config: { operacion: "GESTIONAR_PRODUCTOS" } }, async (request: ConId) =>
    ProductoSchema.parse(await editarProducto(ctx(request), request.params.id, validar(ProductoEntradaSchema, request.body))),
  );

  app.post(RUTAS.reponerProducto, { config: { operacion: "REPONER_INVENTARIO" } }, async (request: ConId) => {
    const { cantidad } = validar(ReposicionEntradaSchema, request.body);
    return ReposicionRespuestaSchema.parse(await reponerProducto(ctx(request), request.params.id, cantidad));
  });

  app.post(RUTAS.registrarVenta, { config: { operacion: "VENDER" } }, async (request, reply) => {
    const clave = claveIdempotencia(request);
    const entrada = validar(RegistrarVentaEntradaSchema, request.body);
    const r = await registrarVentaServicio(ctx(request), entrada, clave);
    return RegistrarVentaRespuestaSchema.parse(responderCobro(reply, r));
  });

  // --- Anulación (CU-21) ---

  app.post(RUTAS.generarCodigoAutorizacion, { config: { operacion: "GENERAR_CODIGO_AUTORIZACION" } }, async (request, reply) => {
    const codigo = await generarCodigoServicio(ctx(request), secretoCodigos);
    void reply.status(201);
    return GenerarCodigoAutorizacionRespuestaSchema.parse(codigo);
  });

  // Entra quien tiene tickets.void, o un Cajero del POS que luego debe presentar un código (RN-46).
  app.post(
    RUTAS.anularTicket,
    { config: { operacion: ["ANULAR_TICKET", "ANULAR_TICKET_CON_CODIGO"] } },
    async (request: ConId, reply) => {
      const clave = claveIdempotencia(request);
      const entrada = validar(AnularTicketEntradaSchema, request.body);
      const r = await anularTicketServicio(ctx(request), request.params.id, entrada, clave, secretoCodigos);
      return AnularTicketRespuestaSchema.parse(responderCobro(reply, r));
    },
  );

  // --- Reportes (§25) ---

  app.get(RUTAS.reporteVentas, { config: { operacion: "CONSULTAR_REPORTES" } }, async (request) =>
    ReporteVentasSchema.parse(await reporteVentasServicio(ctx(request), validar(PeriodoConsultaSchema, request.query))),
  );

  app.get(RUTAS.reporteArqueos, { config: { operacion: "CONSULTAR_REPORTES" } }, async (request) =>
    ReporteArqueosSchema.parse(await reporteArqueosServicio(ctx(request), validar(PeriodoConsultaSchema, request.query))),
  );

  app.get(RUTAS.reporteOcupacion, { config: { operacion: "CONSULTAR_REPORTES" } }, async (request) =>
    ReporteOcupacionSchema.parse(await reporteOcupacionServicio(ctx(request), validar(PeriodoConsultaSchema, request.query))),
  );
}
