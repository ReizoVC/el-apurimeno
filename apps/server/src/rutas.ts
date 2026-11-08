import {
  AbrirTurnoEntradaSchema,
  AnularTicketEntradaSchema,
  AnularTicketRespuestaSchema,
  CategoriaProductoEntradaSchema,
  CategoriaProductoSchema,
  CerrarTurnoEntradaSchema,
  ConteoStockEntradaSchema,
  CotizacionHoraAdicionalRespuestaSchema,
  CotizacionIngresoRespuestaSchema,
  CotizarIngresoEntradaSchema,
  EliminarCategoriaConsultaSchema,
  ForzarCierreTurnoEntradaSchema,
  GenerarCodigoAutorizacionEntradaSchema,
  GenerarCodigoAutorizacionRespuestaSchema,
  MovimientoCajaEntradaSchema,
  MovimientoCajaRespuestaSchema,
  MovimientoHistorialSchema,
  MovimientoStockRespuestaSchema,
  MovimientosInventarioConsultaSchema,
  PeriodoConsultaSchema,
  ProductoEntradaSchema,
  ProductoSchema,
  ProductosConsultaSchema,
  RUTAS,
  SaludRespuestaSchema,
  RegistrarHoraAdicionalEntradaSchema,
  RegistrarHoraAdicionalRespuestaSchema,
  RegistrarIngresoEntradaSchema,
  RegistrarIngresoRespuestaSchema,
  RegistrarVentaEntradaSchema,
  RegistrarVentaRespuestaSchema,
  ReimpresionRespuestaSchema,
  ReporteArqueosSchema,
  ReporteOcupacionSchema,
  ReporteVentasSchema,
  ReposicionEntradaSchema,
  ReposicionRespuestaSchema,
  SalidaRespuestaSchema,
  SalidaSinPagoEntradaSchema,
  SalidaStockEntradaSchema,
  TableroSchema,
  TicketSchema,
  TicketsConsultaSchema,
  TurnoActualRespuestaSchema,
  TurnoRespuestaSchema,
} from "@apurimeno/contracts";
import { puede } from "@apurimeno/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { exigir } from "./auth.js";
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
import { anularTicketServicio } from "./servicios/anulacion.js";
import { generarCodigoServicio, type SecretoCodigos } from "./servicios/codigos.js";
import { claveIdempotencia } from "./servicios/cobros.js";
import { reimprimirTicketServicio } from "./servicios/comprobantes.js";
import { creadorContexto } from "./servicios/contexto.js";
import { reporteArqueosServicio, reporteOcupacionServicio, reporteVentasServicio } from "./servicios/reportes.js";
import {
  conteoDeStock,
  crearCategoria,
  crearProducto,
  editarProducto,
  eliminarCategoria,
  listarCategorias,
  listarMovimientosInventario,
  listarProductos,
  registrarVentaServicio,
  renombrarCategoria,
  reponerProducto,
  salidaDeStock,
} from "./servicios/tienda.js";
import {
  abrirTurno,
  cerrarTurnoPropio,
  forzarCierreTurnoServicio,
  listarTurnosAbiertos,
  registrarMovimientoCajaServicio,
  turnoActualServicio,
} from "./servicios/turnos.js";
import { tableroServicio } from "./servicios/tablero.js";
import { buscarTickets } from "./servicios/tickets.js";

type ConId = FastifyRequest<{ Params: { id: string } }>;

/** Un reintento idempotente responde 200 con el resultado original; la primera vez, 201. */
function responderCobro<T>(reply: FastifyReply, { resultado, repetido }: { resultado: T; repetido: boolean }): T {
  void reply.status(repetido ? 200 : 201).header("idempotent-replayed", String(repetido));
  return resultado;
}

/**
 * Endpoints de la API local: turnos y caja, alquileres, tienda, anulación y reportes. Habitaciones y limpieza,
 * clientes y usuarios están en sus propios archivos (rutas-*.ts). Cada ruta declara la
 * operación que exige; el middleware de auth.ts verifica `puede()` antes de llegar aquí. Toda respuesta
 * se valida con su esquema de contracts.
 */
export function registrarRutas(
  app: FastifyInstance,
  prisma: PrismaClient,
  ahora: () => Date,
  secretoCodigos: SecretoCodigos,
  imprimir: (ticketId: string) => void = () => undefined,
  capacitacion = false,
): void {
  const ctx = creadorContexto(prisma, ahora, imprimir, capacitacion);

  app.get(RUTAS.salud, { config: { publica: true } }, async () => {
    const { instalada, disponible } = app.actualizacion.estado();
    return SaludRespuestaSchema.parse({ estado: "ok", versionSistema: instalada, versionDisponible: disponible?.version ?? null });
  });

  app.get(RUTAS.tablero, { config: { operacion: "CONSULTAR_TABLERO" } }, async (request) =>
    TableroSchema.parse(await tableroServicio(ctx(request))),
  );

  app.get(RUTAS.turnoActual, { config: { operacion: ["ABRIR_TURNO", "CERRAR_TURNO"] } }, async (request) =>
    TurnoActualRespuestaSchema.parse({ turno: await turnoActualServicio(ctx(request)) }),
  );

  app.post(RUTAS.abrirTurno, { config: { operacion: "ABRIR_TURNO" } }, async (request, reply) => {
    const turno = await abrirTurno(ctx(request), validar(AbrirTurnoEntradaSchema, request.body));
    void reply.status(201);
    return TurnoRespuestaSchema.parse(turno);
  });

  app.post(RUTAS.cerrarTurno, { config: { operacion: "CERRAR_TURNO" } }, async (request) =>
    TurnoRespuestaSchema.parse(await cerrarTurnoPropio(ctx(request), validar(CerrarTurnoEntradaSchema, request.body), secretoCodigos)),
  );

  app.get(RUTAS.turnosAbiertos, { config: { operacion: "FORZAR_CIERRE_TURNO" } }, async (request) =>
    TurnoRespuestaSchema.array().parse(await listarTurnosAbiertos(ctx(request))),
  );

  app.post(RUTAS.forzarCierreTurno, { config: { operacion: "FORZAR_CIERRE_TURNO" } }, async (request: ConId) =>
    TurnoRespuestaSchema.parse(
      await forzarCierreTurnoServicio(ctx(request), request.params.id, validar(ForzarCierreTurnoEntradaSchema, request.body)),
    ),
  );

  // Idempotente como un cobro (decisión 18 de contracts): un reintento no duplica el movimiento.
  app.post(RUTAS.movimientosCaja, { config: { operacion: "REGISTRAR_MOVIMIENTO_CAJA" } }, async (request, reply) => {
    const clave = claveIdempotencia(request);
    const entrada = validar(MovimientoCajaEntradaSchema, request.body);
    const r = await registrarMovimientoCajaServicio(ctx(request), entrada, clave);
    return MovimientoCajaRespuestaSchema.parse(responderCobro(reply, r));
  });

  app.post(RUTAS.cotizarIngreso, { config: { operacion: "REGISTRAR_INGRESO" } }, async (request) =>
    CotizacionIngresoRespuestaSchema.parse(
      await cotizarIngresoServicio(ctx(request), validar(CotizarIngresoEntradaSchema, request.body)),
    ),
  );

  app.post(RUTAS.registrarIngreso, { config: { operacion: "REGISTRAR_INGRESO" } }, async (request, reply) => {
    const clave = claveIdempotencia(request);
    const entrada = validar(RegistrarIngresoEntradaSchema, request.body);
    const r = await registrarIngresoServicio(ctx(request), entrada, clave);
    if (!r.repetido) imprimir(r.resultado.ticket.id);
    return RegistrarIngresoRespuestaSchema.parse(responderCobro(reply, r));
  });

  app.get(RUTAS.cotizarHoraAdicional, { config: { operacion: "COBRAR_HORA_ADICIONAL" } }, async (request: ConId) =>
    CotizacionHoraAdicionalRespuestaSchema.parse(await cotizarHoraAdicionalServicio(ctx(request), request.params.id)),
  );

  app.post(RUTAS.registrarHoraAdicional, { config: { operacion: "COBRAR_HORA_ADICIONAL" } }, async (request: ConId, reply) => {
    const clave = claveIdempotencia(request);
    const entrada = validar(RegistrarHoraAdicionalEntradaSchema, request.body);
    const r = await registrarHoraAdicionalServicio(ctx(request), request.params.id, entrada, clave);
    if (!r.repetido) imprimir(r.resultado.ticket.id);
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

  app.put(RUTAS.categoriaProducto, { config: { operacion: "GESTIONAR_PRODUCTOS" } }, async (request: ConId) =>
    CategoriaProductoSchema.parse(await renombrarCategoria(ctx(request), request.params.id, validar(CategoriaProductoEntradaSchema, request.body))),
  );

  app.delete(RUTAS.categoriaProducto, { config: { operacion: "GESTIONAR_PRODUCTOS" } }, async (request: ConId, reply) => {
    const { moverA } = validar(EliminarCategoriaConsultaSchema, request.query);
    await eliminarCategoria(ctx(request), request.params.id, moverA);
    return reply.status(204).send();
  });

  app.get(RUTAS.productos, { config: { operacion: ["VENDER", "GESTIONAR_PRODUCTOS"] } }, async (request) => {
    const { codigoBarras, incluirInactivos = false } = validar(ProductosConsultaSchema, request.query);
    const c = ctx(request);
    if (incluirInactivos) exigir(c.usuario, "GESTIONAR_PRODUCTOS");
    // Decisión 31: el costo solo lo ve quien gestiona el inventario, no quien solo vende.
    const verCosto = puede(c.usuario.permisos, "GESTIONAR_PRODUCTOS");
    return ProductoSchema.array().parse(await listarProductos(c, codigoBarras, incluirInactivos, verCosto));
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

  app.post(RUTAS.salidaStock, { config: { operacion: "REGISTRAR_SALIDA_STOCK" } }, async (request: ConId) =>
    MovimientoStockRespuestaSchema.parse(await salidaDeStock(ctx(request), request.params.id, validar(SalidaStockEntradaSchema, request.body))),
  );

  app.post(RUTAS.conteoStock, { config: { operacion: "CONTAR_STOCK" } }, async (request: ConId) =>
    MovimientoStockRespuestaSchema.parse(await conteoDeStock(ctx(request), request.params.id, validar(ConteoStockEntradaSchema, request.body))),
  );

  app.get(RUTAS.movimientosInventario, { config: { operacion: "CONSULTAR_MOVIMIENTOS_INVENTARIO" } }, async (request) => {
    const { productoId } = validar(MovimientosInventarioConsultaSchema, request.query);
    return MovimientoHistorialSchema.array().parse(await listarMovimientosInventario(ctx(request), productoId));
  });

  app.post(RUTAS.registrarVenta, { config: { operacion: "VENDER" } }, async (request, reply) => {
    const clave = claveIdempotencia(request);
    const entrada = validar(RegistrarVentaEntradaSchema, request.body);
    const r = await registrarVentaServicio(ctx(request), entrada, clave);
    if (!r.repetido) imprimir(r.resultado.id);
    return RegistrarVentaRespuestaSchema.parse(responderCobro(reply, r));
  });

  // --- Anulación (CU-21) ---

  app.post(RUTAS.generarCodigoAutorizacion, { config: { operacion: "GENERAR_CODIGO_AUTORIZACION" } }, async (request, reply) => {
    const { operacion } = validar(GenerarCodigoAutorizacionEntradaSchema, request.body ?? {});
    const codigo = await generarCodigoServicio(ctx(request), secretoCodigos, operacion);
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

  app.get(RUTAS.tickets, { config: { operacion: ["REIMPRIMIR_COMPROBANTE", "CONSULTAR_REPORTES"] } }, async (request) =>
    TicketSchema.array().parse(await buscarTickets(ctx(request), validar(TicketsConsultaSchema, request.query))),
  );

  // Reimpresión (CU-22): una copia marcada como tal. Pulsar dos veces imprime dos copias, como en papel.
  app.post(RUTAS.reimprimirTicket, { config: { operacion: "REIMPRIMIR_COMPROBANTE" } }, async (request: ConId, reply) => {
    const r = await reimprimirTicketServicio(ctx(request), request.params.id);
    imprimir(r.trabajo.ticketId);
    void reply.status(201);
    return ReimpresionRespuestaSchema.parse(r);
  });

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
