import { z } from "zod";
import { AlquilerSchema, HoraAdicionalSchema } from "./alquileres.js";
import { AccionAuditoriaSchema, RegistroAuditoriaSchema, TipoEntidadAuditadaSchema } from "./auditoria.js";
import { MovimientoCajaSchema, TurnoSchema } from "./caja.js";
import { ClienteSchema, PrecioEspecialClienteSchema } from "./clientes.js";
import {
  CentimosConSignoSchema,
  CentimosSchema,
  FechaISOSchema,
  IdSchema,
  TextoRequeridoSchema,
} from "./comun.js";
import { TrabajoImpresionSchema } from "./comprobantes.js";
import { ConfiguracionGlobalSchema } from "./configuracion.js";
import { CodigoErrorNegocioSchema } from "./errores.js";
import {
  EstadoTemporalAlquilerSchema,
  OrigenPrecioAlquilerSchema,
  OrigenTicketSchema,
  TipoHoraAdicionalSchema,
  TipoMovimientoCajaSchema,
} from "./estados.js";
import { HabitacionSchema } from "./habitaciones.js";
import { sonUnicos } from "./interno.js";
import { PermisoSchema } from "./permisos.js";
import { MovimientoInventarioSchema, ProductoSchema } from "./tienda.js";
import { AjustePuntualSchema, LineaTicketSchema, MetodoPagoSchema, TicketSchema } from "./tickets.js";
import { RangoSchema, UsuarioSchema } from "./usuarios.js";

// Cuerpos de entrada y salida de la API local (Planos §11). El servidor valida con estos esquemas
// y los clientes los usan para sus tipos: ninguno define su propia versión (Planos §16.1).
// Las reglas de negocio (motivo obligatorio, ajuste al alza, etc.) las aplica el dominio y responden
// con `codigo`; aquí solo se valida la forma.

export const RUTAS = {
  login: "/auth/login",
  abrirTurno: "/turnos",
  turnoActual: "/turnos/actual",
  cerrarTurno: "/turnos/actual/cierre",
  turnosAbiertos: "/turnos/abiertos",
  forzarCierreTurno: "/turnos/:id/cierre-forzado",
  tablero: "/tablero",
  cotizarIngreso: "/alquileres/cotizacion",
  registrarIngreso: "/alquileres",
  cotizarHoraAdicional: "/alquileres/:id/hora-adicional/cotizacion",
  registrarHoraAdicional: "/alquileres/:id/horas-adicionales",
  registrarSalida: "/alquileres/:id/salida",
  registrarSalidaSinPago: "/alquileres/:id/salida-sin-pago",
  categoriasProducto: "/categorias-producto",
  productos: "/productos",
  producto: "/productos/:id",
  reponerProducto: "/productos/:id/reposicion",
  registrarVenta: "/ventas",
  generarCodigoAutorizacion: "/codigos-autorizacion",
  anularTicket: "/tickets/:id/anulacion",
  reimprimirTicket: "/tickets/:id/reimpresion",
  tickets: "/tickets",
  reporteVentas: "/reportes/ventas",
  reporteArqueos: "/reportes/arqueos",
  reporteOcupacion: "/reportes/ocupacion",
  // Limpieza (CU-15 a CU-17): lo que consume apps/cleaning.
  habitacionesPendientesLimpieza: "/habitaciones/pendientes-limpieza",
  marcarHabitacionLista: "/habitaciones/:id/lista",
  reportarMantenimiento: "/habitaciones/:id/reporte-mantenimiento",
  // Administración de habitaciones (CU-13, CU-14).
  habitaciones: "/habitaciones",
  habitacion: "/habitaciones/:id",
  bloquearHabitacion: "/habitaciones/:id/bloqueo",
  reactivarHabitacion: "/habitaciones/:id/reactivacion",
  // Clientes y precios especiales (CU-08, CU-09).
  clientes: "/clientes",
  cliente: "/clientes/:id",
  preciosEspecialesCliente: "/clientes/:id/precios-especiales",
  precioEspecialCliente: "/clientes/:id/precios-especiales/:habitacionId",
  // Usuarios (CU-23).
  usuarios: "/usuarios",
  usuario: "/usuarios/:id",
  contrasenaUsuario: "/usuarios/:id/contrasena",
  rangos: "/rangos",
  rango: "/rangos/:id",
  // Movimientos manuales de caja (CU-18).
  movimientosCaja: "/turnos/actual/movimientos",
  // Configuración (CU-27) y métodos de pago (RF-54).
  configuracion: "/configuracion",
  metodosPago: "/metodos-pago",
  metodoPago: "/metodos-pago/:id",
  auditoria: "/auditoria",
  salud: "/health",
} as const;

/** Cabecera obligatoria en toda operación que cobra (RF-59): reintentar con la misma clave no cobra dos veces. */
export const CABECERA_IDEMPOTENCIA = "idempotency-key";
export const ClaveIdempotenciaSchema = z.string().trim().min(8).max(128);

/** Errores técnicos de la API; los de negocio usan `CodigoErrorNegocio`. */
export const CodigoErrorApiSchema = z.enum([
  "VALIDACION",
  "NO_AUTENTICADO",
  "PERMISO_DENEGADO",
  "NO_ENCONTRADO",
  "CLAVE_IDEMPOTENCIA_REUTILIZADA",
  "ERROR_INTERNO",
]);
export type CodigoErrorApi = z.infer<typeof CodigoErrorApiSchema>;

export const RespuestaErrorSchema = z
  .object({
    codigo: z.union([CodigoErrorNegocioSchema, CodigoErrorApiSchema]),
    mensaje: z.string(),
  })
  .strict();
export type RespuestaError = z.infer<typeof RespuestaErrorSchema>;

// --- Autenticación ---

export const LoginEntradaSchema = z
  .object({ nombreUsuario: TextoRequeridoSchema, contrasena: z.string().min(1) })
  .strict();
export type LoginEntrada = z.infer<typeof LoginEntradaSchema>;

export const LoginRespuestaSchema = z
  .object({ token: z.string().min(1), usuario: UsuarioSchema, permisos: z.array(PermisoSchema) })
  .strict();
export type LoginRespuesta = z.infer<typeof LoginRespuestaSchema>;

// --- Cobros ---

/** Un pago recibido. `montoRecibido` solo para efectivo con vuelto (RF-04). */
export const PagoEntradaSchema = z
  .object({
    metodoPagoId: IdSchema,
    monto: CentimosSchema,
    montoRecibido: CentimosSchema.nullable(),
    referencia: z.string().nullable(),
  })
  .strict();
export type PagoEntrada = z.infer<typeof PagoEntradaSchema>;

/** Ajuste puntual pedido por el cajero (RN-17, RN-18). `motivo` lo valida el dominio (REASON_REQUIRED). */
export const AjusteEntradaSchema = z.object({ montoAjustado: CentimosSchema, motivo: z.string() }).strict();
export type AjusteEntrada = z.infer<typeof AjusteEntradaSchema>;

/** Cotización devuelta antes de cobrar: el total que el POS muestra al cajero. */
export const CotizacionSchema = z
  .object({
    lineas: z.array(LineaTicketSchema.innerType().omit({ id: true })),
    total: CentimosSchema,
    ajustePuntual: AjustePuntualSchema.nullable(),
  })
  .strict();
export type CotizacionApi = z.infer<typeof CotizacionSchema>;

// --- Turnos ---

export const AbrirTurnoEntradaSchema = z.object({ efectivoInicial: CentimosSchema }).strict();
export type AbrirTurnoEntrada = z.infer<typeof AbrirTurnoEntradaSchema>;

/** Arqueo ciego (RN-34): el cajero envía lo contado; el esperado solo se revela en la respuesta. */
export const CerrarTurnoEntradaSchema = z
  .object({ efectivoContado: CentimosSchema, comentario: z.string().nullable() })
  .strict();
export type CerrarTurnoEntrada = z.infer<typeof CerrarTurnoEntradaSchema>;

export const TurnoRespuestaSchema = TurnoSchema;

/** Turno abierto de quien consulta, o null si no tiene: el POS lo pide al iniciar (RN-32). */
export const TurnoActualRespuestaSchema = z.object({ turno: TurnoSchema.nullable() }).strict();
export type TurnoActualRespuesta = z.infer<typeof TurnoActualRespuestaSchema>;

/**
 * Cierre forzado de un turno ajeno (CU-20, RF-43), p. ej. un turno abandonado. El conteo es opcional: si
 * el Administrador cuenta el cajón, queda registrada la diferencia; si no, solo el esperado.
 */
export const ForzarCierreTurnoEntradaSchema = z
  .object({ efectivoContado: CentimosSchema.nullable(), comentario: z.string().nullable() })
  .strict();
export type ForzarCierreTurnoEntrada = z.infer<typeof ForzarCierreTurnoEntradaSchema>;

/**
 * Ingreso o retiro manual de efectivo en el turno propio (RF-42). Lleva `idempotency-key`: un reintento
 * no debe duplicar un retiro, porque desvirtuaría el arqueo. El motivo lo valida el dominio (REASON_REQUIRED).
 */
export const MovimientoCajaEntradaSchema = z
  .object({ tipo: TipoMovimientoCajaSchema, monto: CentimosSchema.positive(), motivo: z.string() })
  .strict();
export type MovimientoCajaEntrada = z.infer<typeof MovimientoCajaEntradaSchema>;

export const MovimientoCajaRespuestaSchema = MovimientoCajaSchema;

// --- Alquileres ---

export const CotizarIngresoEntradaSchema = z
  .object({
    habitacionId: IdSchema,
    clienteId: IdSchema.nullable(),
    horasAdicionalesAlIngreso: z.number().int().nonnegative(),
  })
  .strict();
export type CotizarIngresoEntrada = z.infer<typeof CotizarIngresoEntradaSchema>;

export const CotizacionIngresoRespuestaSchema = CotizacionSchema.extend({
  origenPrecio: OrigenPrecioAlquilerSchema,
  salidaProgramadaEn: FechaISOSchema,
}).strict();
export type CotizacionIngresoRespuesta = z.infer<typeof CotizacionIngresoRespuestaSchema>;

export const RegistrarIngresoEntradaSchema = CotizarIngresoEntradaSchema.extend({
  ajuste: AjusteEntradaSchema.nullable(),
  pagos: z.array(PagoEntradaSchema).min(1),
}).strict();
export type RegistrarIngresoEntrada = z.infer<typeof RegistrarIngresoEntradaSchema>;

export const RegistrarIngresoRespuestaSchema = z
  .object({ alquiler: AlquilerSchema, habitacion: HabitacionSchema, ticket: TicketSchema })
  .strict();
export type RegistrarIngresoRespuesta = z.infer<typeof RegistrarIngresoRespuestaSchema>;

/** Cotización de la hora adicional: el tipo lo decide el sistema (RF-08). */
export const CotizacionHoraAdicionalRespuestaSchema = z
  .object({
    tipo: TipoHoraAdicionalSchema,
    estadoTemporal: EstadoTemporalAlquilerSchema,
    salidaAnterior: FechaISOSchema,
    salidaNueva: FechaISOSchema,
    cotizacion: CotizacionSchema,
  })
  .strict();
export type CotizacionHoraAdicionalRespuesta = z.infer<typeof CotizacionHoraAdicionalRespuestaSchema>;

export const RegistrarHoraAdicionalEntradaSchema = z
  .object({ ajuste: AjusteEntradaSchema.nullable(), pagos: z.array(PagoEntradaSchema).min(1) })
  .strict();
export type RegistrarHoraAdicionalEntrada = z.infer<typeof RegistrarHoraAdicionalEntradaSchema>;

export const RegistrarHoraAdicionalRespuestaSchema = z
  .object({ alquiler: AlquilerSchema, horaAdicional: HoraAdicionalSchema, ticket: TicketSchema })
  .strict();
export type RegistrarHoraAdicionalRespuesta = z.infer<typeof RegistrarHoraAdicionalRespuestaSchema>;

/**
 * Tablero del POS (Planos §11.2 `/rooms/board`): cada habitación con su alquiler abierto, si lo tiene. El
 * estado temporal lo calcula el servidor con su hora (`ahora`, RF-07, RN-11); el POS usa `ahora` para
 * corregir su reloj entre una consulta y la siguiente. `tickets` son los del alquiler, para anular (CU-21).
 */
export const AlquilerEnTableroSchema = z
  .object({ alquiler: AlquilerSchema, estadoTemporal: EstadoTemporalAlquilerSchema, tickets: z.array(TicketSchema) })
  .strict();
export type AlquilerEnTablero = z.infer<typeof AlquilerEnTableroSchema>;

export const TableroSchema = z
  .object({
    ahora: FechaISOSchema,
    habitaciones: z.array(
      z.object({ habitacion: HabitacionSchema, alquiler: AlquilerEnTableroSchema.nullable() }).strict(),
    ),
  })
  .strict();
export type Tablero = z.infer<typeof TableroSchema>;

export const SalidaSinPagoEntradaSchema = z.object({ motivo: z.string() }).strict();
export type SalidaSinPagoEntrada = z.infer<typeof SalidaSinPagoEntradaSchema>;

export const SalidaRespuestaSchema = z.object({ alquiler: AlquilerSchema, habitacion: HabitacionSchema }).strict();
export type SalidaRespuesta = z.infer<typeof SalidaRespuestaSchema>;

// --- Tienda ---

export const CategoriaProductoEntradaSchema = z.object({ nombre: TextoRequeridoSchema }).strict();
export type CategoriaProductoEntrada = z.infer<typeof CategoriaProductoEntradaSchema>;

/** Alta o edición de un producto (RF-53). El stock no se edita aquí: solo cambia con ventas, reposiciones y anulaciones. */
export const ProductoEntradaSchema = z
  .object({
    categoriaId: IdSchema,
    nombre: TextoRequeridoSchema,
    codigoBarras: TextoRequeridoSchema.nullable(),
    precioHuesped: CentimosSchema,
    precioPublico: CentimosSchema,
    controlaStock: z.boolean(),
    activo: z.boolean(),
  })
  .strict();
export type ProductoEntrada = z.infer<typeof ProductoEntradaSchema>;

/** Filtro del catálogo: `codigoBarras` es lo que lee el scanner USB. */
export const ProductosConsultaSchema = z.object({ codigoBarras: TextoRequeridoSchema.optional() }).strict();
export type ProductosConsulta = z.infer<typeof ProductosConsultaSchema>;

/** Ingreso de mercadería (RN-25, RF-35). */
export const ReposicionEntradaSchema = z.object({ cantidad: z.number().int().positive() }).strict();
export type ReposicionEntrada = z.infer<typeof ReposicionEntradaSchema>;

export const ReposicionRespuestaSchema = z
  .object({ producto: ProductoSchema, movimiento: MovimientoInventarioSchema })
  .strict();
export type ReposicionRespuesta = z.infer<typeof ReposicionRespuestaSchema>;

export const ItemVentaEntradaSchema = z
  .object({ productoId: IdSchema, cantidad: z.number().int().positive() })
  .strict();

/**
 * Venta de tienda. `esHuesped` lo indica el cajero de forma explícita (RN-22): la tienda no infiere
 * alquileres (RES-02). Asociar una habitación es opcional (RN-24) y solo tiene sentido si es huésped.
 */
export const RegistrarVentaEntradaSchema = z
  .object({
    items: z.array(ItemVentaEntradaSchema).min(1),
    esHuesped: z.boolean(),
    habitacionReferenciaId: IdSchema.nullable(),
    ajuste: AjusteEntradaSchema.nullable(),
    pagos: z.array(PagoEntradaSchema).min(1),
  })
  .strict()
  .refine((v) => v.habitacionReferenciaId === null || v.esHuesped, {
    path: ["habitacionReferenciaId"],
    message: "Solo una venta a huésped se asocia a una habitación.",
  });
export type RegistrarVentaEntrada = z.infer<typeof RegistrarVentaEntradaSchema>;

export const RegistrarVentaRespuestaSchema = TicketSchema;

// --- Anulación (CU-21, RN-36, RN-46) ---

/**
 * Código de autorización recién generado. Es la única vez que se muestra en claro: el servidor solo
 * guarda su hash y no lo vuelve a listar.
 */
export const GenerarCodigoAutorizacionRespuestaSchema = z
  .object({ id: IdSchema, codigo: TextoRequeridoSchema, expiraEn: FechaISOSchema })
  .strict();
export type GenerarCodigoAutorizacionRespuesta = z.infer<typeof GenerarCodigoAutorizacionRespuestaSchema>;

/** `codigoAutorizacion` es obligatorio para quien no tiene `tickets.void` (RN-46). */
export const AnularTicketEntradaSchema = z
  .object({ motivo: z.string(), codigoAutorizacion: z.string().nullable() })
  .strict();
export type AnularTicketEntrada = z.infer<typeof AnularTicketEntradaSchema>;

export const AnularTicketRespuestaSchema = z
  .object({ original: TicketSchema, compensatorio: TicketSchema })
  .strict();
export type AnularTicketRespuesta = z.infer<typeof AnularTicketRespuestaSchema>;

// --- Reportes (§25, RF-47, RF-48) ---

/** Periodo [desde, hasta) en UTC. */
export const PeriodoConsultaSchema = z
  .object({ desde: FechaISOSchema, hasta: FechaISOSchema })
  .strict()
  .refine((p) => Date.parse(p.desde) < Date.parse(p.hasta), {
    path: ["hasta"],
    message: "hasta debe ser posterior a desde.",
  });
export type PeriodoConsulta = z.infer<typeof PeriodoConsultaSchema>;

/**
 * Ventas del periodo (RF-47). Solo cuentan los tickets vigentes: cobros no anulados. Todos los desgloses
 * suman el total, salvo `porProducto`, que solo cubre las líneas de producto.
 */
export const ReporteVentasSchema = z
  .object({
    total: CentimosSchema,
    cantidadTickets: z.number().int().nonnegative(),
    porOrigen: z.array(z.object({ origen: OrigenTicketSchema, total: CentimosSchema }).strict()),
    porMetodoPago: z.array(z.object({ metodoPagoId: IdSchema, total: CentimosSchema }).strict()),
    /** Día calendario en la hora de Lima, "AAAA-MM-DD". */
    porDia: z.array(z.object({ dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), total: CentimosSchema }).strict()),
    porTurno: z.array(z.object({ turnoId: IdSchema, total: CentimosSchema }).strict()),
    porProducto: z.array(
      z
        .object({
          productoId: IdSchema,
          descripcion: z.string(),
          cantidad: z.number().int().nonnegative(),
          total: CentimosSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type ReporteVentas = z.infer<typeof ReporteVentasSchema>;

/** Arqueos de los turnos cerrados en el periodo (§25). */
export const ReporteArqueosSchema = z
  .object({
    turnos: z.array(TurnoSchema),
    diferenciaTotal: CentimosConSignoSchema,
    turnosConDiferencia: z.number().int().nonnegative(),
  })
  .strict();
export type ReporteArqueos = z.infer<typeof ReporteArqueosSchema>;

/** Ocupación por habitación de los alquileres ingresados en el periodo (RF-48). No cuenta alquileres anulados. */
export const ReporteOcupacionSchema = z
  .object({
    habitaciones: z.array(
      z
        .object({
          habitacionId: IdSchema,
          numero: z.string(),
          alquileres: z.number().int().nonnegative(),
          horasVendidas: z.number().int().nonnegative(),
          ingresos: CentimosSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type ReporteOcupacion = z.infer<typeof ReporteOcupacionSchema>;

// --- Habitaciones y limpieza (CU-13 a CU-17) ---

/**
 * Reporte de daño desde limpieza (CU-17). El motivo es recomendado, no obligatorio (RF-41): el cuerpo puede
 * omitirse, y entonces vale como `{ motivo: null }`.
 */
export const ReportarMantenimientoEntradaSchema = z.object({ motivo: TextoRequeridoSchema.nullable() }).strict();
export type ReportarMantenimientoEntrada = z.infer<typeof ReportarMantenimientoEntradaSchema>;

/** Bloqueo administrativo (RF-38): el motivo es obligatorio y lo valida el dominio (REASON_REQUIRED). */
export const BloquearHabitacionEntradaSchema = z.object({ motivo: z.string() }).strict();
export type BloquearHabitacionEntrada = z.infer<typeof BloquearHabitacionEntradaSchema>;

/** Alta o edición de una habitación (RF-36, RF-37). El estado no se edita: solo cambia con sus transiciones. */
export const HabitacionEntradaSchema = z
  .object({ numero: TextoRequeridoSchema, descripcion: TextoRequeridoSchema.nullable(), precioBase: CentimosSchema })
  .strict();
export type HabitacionEntrada = z.infer<typeof HabitacionEntradaSchema>;

// --- Clientes y precios especiales (CU-08, CU-09) ---

/** Búsqueda parcial por documento o nombre (RF-34). */
export const ClientesConsultaSchema = z.object({ q: TextoRequeridoSchema.optional() }).strict();
export type ClientesConsulta = z.infer<typeof ClientesConsultaSchema>;

/** Alta o edición de un cliente: documento, nombre o ambos. */
export const ClienteEntradaSchema = ClienteSchema.innerType()
  .omit({ id: true })
  .strict()
  .refine((c) => c.documento !== null || c.nombre !== null, {
    path: ["documento"],
    message: "Un cliente necesita documento o nombre.",
  });
export type ClienteEntrada = z.infer<typeof ClienteEntradaSchema>;

/** Alta de precio especial (RF-16). Si la combinación ya existe responde CLIENT_ROOM_PRICE_ALREADY_EXISTS. */
export const CrearPrecioEspecialEntradaSchema = z
  .object({ habitacionId: IdSchema, precio: CentimosSchema })
  .strict();
export type CrearPrecioEspecialEntrada = z.infer<typeof CrearPrecioEspecialEntradaSchema>;

/** Edición del monto (RF-18). */
export const EditarPrecioEspecialEntradaSchema = z.object({ precio: CentimosSchema }).strict();
export type EditarPrecioEspecialEntrada = z.infer<typeof EditarPrecioEspecialEntradaSchema>;

export const PrecioEspecialRespuestaSchema = PrecioEspecialClienteSchema;

// --- Usuarios (CU-23) ---

/** Longitud mínima de contraseña: decisión del proyecto, el SRS no fija una (README decisión 16). */
export const CONTRASENA_MINIMA = 8;
export const ContrasenaSchema = z.string().min(CONTRASENA_MINIMA).max(128);


/** Alta de una cuenta individual (RN-40). La contraseña nunca vuelve en una respuesta. */
export const CrearUsuarioEntradaSchema = z
  .object({ nombreUsuario: TextoRequeridoSchema, contrasena: ContrasenaSchema, rangoIds: z.array(IdSchema).min(1) })
  .strict()
  .refine((u) => sonUnicos(u.rangoIds), { path: ["rangoIds"], message: "Un rango no se asigna dos veces." });
export type CrearUsuarioEntrada = z.infer<typeof CrearUsuarioEntradaSchema>;

/** Edición, desactivación y asignación de rangos (RF-45). Desactivar reemplaza a eliminar. */
export const EditarUsuarioEntradaSchema = z
  .object({ nombreUsuario: TextoRequeridoSchema, activo: z.boolean(), rangoIds: z.array(IdSchema).min(1) })
  .strict()
  .refine((u) => sonUnicos(u.rangoIds), { path: ["rangoIds"], message: "Un rango no se asigna dos veces." });
export type EditarUsuarioEntrada = z.infer<typeof EditarUsuarioEntradaSchema>;

/** Nueva contraseña fijada por el Administrador. */
export const CambiarContrasenaEntradaSchema = z.object({ contrasena: ContrasenaSchema }).strict();
export type CambiarContrasenaEntrada = z.infer<typeof CambiarContrasenaEntradaSchema>;

export const UsuarioRespuestaSchema = UsuarioSchema;
export const RangoRespuestaSchema = RangoSchema;

// --- Rangos (CU-24; RN-41, RF-62) ---

/**
 * Alta o edición de un rango: nombre único y permisos del catálogo fijo, sin repetir. Editar un rango
 * rige de inmediato para todos los usuarios que lo tienen (RF-63).
 */
export const RangoEntradaSchema = RangoSchema.innerType()
  .omit({ id: true })
  .strict()
  .refine((r) => sonUnicos(r.permisos), { path: ["permisos"], message: "Un permiso no se repite en un rango." });
export type RangoEntrada = z.infer<typeof RangoEntradaSchema>;

// --- Configuración (CU-27; RN-43, RF-50 a RF-52) ---

/**
 * Se lee y se reemplaza completa. Los parámetros de tiempo y precio solo afectan a los alquileres que
 * empiecen después: cada alquiler guarda su copia (RN-43, RN-44). El comprobante no admite terminología
 * fiscal (RN-39).
 */
export const ConfiguracionEntradaSchema = ConfiguracionGlobalSchema;
export const ConfiguracionRespuestaSchema = ConfiguracionGlobalSchema;

// --- Métodos de pago (RF-54, RN-35) ---

/**
 * Alta o edición de un método de pago. Un método deshabilitado deja de aceptarse al cobrar. `afectaCaja`
 * se fija al crearlo y no se edita (decisión 20).
 */
export const MetodoPagoEntradaSchema = MetodoPagoSchema.omit({ id: true }).strict();
export type MetodoPagoEntrada = z.infer<typeof MetodoPagoEntradaSchema>;
export const MetodoPagoRespuestaSchema = MetodoPagoSchema;

// --- Auditoría (CU-25, RF-46) ---

export const LIMITE_AUDITORIA_MAXIMO = 200;

/**
 * Filtros de la consulta de auditoría; todos se combinan (RF-46). El periodo es [desde, hasta) en UTC.
 * Los resultados van del más reciente al más antiguo; `despuesDe` es el `siguiente` de la página anterior.
 */
export const AuditoriaConsultaSchema = z
  .object({
    usuarioId: IdSchema.optional(),
    accion: AccionAuditoriaSchema.optional(),
    tipoEntidad: TipoEntidadAuditadaSchema.optional(),
    entidadId: IdSchema.optional(),
    desde: FechaISOSchema.optional(),
    hasta: FechaISOSchema.optional(),
    limite: z.coerce.number().int().min(1).max(LIMITE_AUDITORIA_MAXIMO).default(50),
    despuesDe: IdSchema.optional(),
  })
  .strict()
  .refine((c) => c.desde === undefined || c.hasta === undefined || Date.parse(c.desde) < Date.parse(c.hasta), {
    path: ["hasta"],
    message: "hasta debe ser posterior a desde.",
  });
export type AuditoriaConsulta = z.infer<typeof AuditoriaConsultaSchema>;

export const AuditoriaRespuestaSchema = z
  .object({ registros: z.array(RegistroAuditoriaSchema), siguiente: IdSchema.nullable() })
  .strict();
export type AuditoriaRespuesta = z.infer<typeof AuditoriaRespuestaSchema>;

// --- Consulta de tickets (para reimprimir, CU-22) ---

export const LIMITE_TICKETS_MAXIMO = 100;

/**
 * Busca tickets ya emitidos: por número exacto, o los de un periodo [desde, hasta), del más reciente al más
 * antiguo. Es solo lectura: sirve para encontrar el comprobante que se quiere reimprimir.
 */
export const TicketsConsultaSchema = z
  .object({
    numero: z.coerce.number().int().positive().optional(),
    desde: FechaISOSchema.optional(),
    hasta: FechaISOSchema.optional(),
    limite: z.coerce.number().int().min(1).max(LIMITE_TICKETS_MAXIMO).default(50),
  })
  .strict()
  .refine((c) => c.desde === undefined || c.hasta === undefined || Date.parse(c.desde) < Date.parse(c.hasta), {
    path: ["hasta"],
    message: "hasta debe ser posterior a desde.",
  });
export type TicketsConsulta = z.infer<typeof TicketsConsultaSchema>;

// --- Reimpresión (CU-22, RF-44) ---

/**
 * Copia de un comprobante ya emitido: el trabajo queda en cola marcado como copia, y `contenido` trae las
 * líneas de texto tal como se imprimirán, con "COPIA" visible y sin datos del cliente (RN-38, RN-39).
 */
export const ReimpresionRespuestaSchema = z
  .object({ trabajo: TrabajoImpresionSchema, contenido: z.array(z.string()) })
  .strict();
export type ReimpresionRespuesta = z.infer<typeof ReimpresionRespuestaSchema>;
