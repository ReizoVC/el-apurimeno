import { z } from "zod";
import { AlquilerSchema, HoraAdicionalSchema } from "./alquileres.js";
import { TurnoSchema } from "./caja.js";
import { CentimosSchema, FechaISOSchema, IdSchema, TextoRequeridoSchema } from "./comun.js";
import { CodigoErrorNegocioSchema } from "./errores.js";
import {
  EstadoTemporalAlquilerSchema,
  OrigenPrecioAlquilerSchema,
  TipoHoraAdicionalSchema,
} from "./estados.js";
import { HabitacionSchema } from "./habitaciones.js";
import { PermisoSchema } from "./permisos.js";
import { AjustePuntualSchema, LineaTicketSchema, TicketSchema } from "./tickets.js";
import { UsuarioSchema } from "./usuarios.js";

// Cuerpos de entrada y salida de la API local (Planos §11). El servidor valida con estos esquemas
// y los clientes los usan para sus tipos: ninguno define su propia versión (Planos §16.1).
// Las reglas de negocio (motivo obligatorio, ajuste al alza, etc.) las aplica el dominio y responden
// con `codigo`; aquí solo se valida la forma.

export const RUTAS = {
  login: "/auth/login",
  abrirTurno: "/turnos",
  cerrarTurno: "/turnos/actual/cierre",
  cotizarIngreso: "/alquileres/cotizacion",
  registrarIngreso: "/alquileres",
  cotizarHoraAdicional: "/alquileres/:id/hora-adicional/cotizacion",
  registrarHoraAdicional: "/alquileres/:id/horas-adicionales",
  registrarSalida: "/alquileres/:id/salida",
  registrarSalidaSinPago: "/alquileres/:id/salida-sin-pago",
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

export const SalidaSinPagoEntradaSchema = z.object({ motivo: z.string() }).strict();
export type SalidaSinPagoEntrada = z.infer<typeof SalidaSinPagoEntradaSchema>;

export const SalidaRespuestaSchema = z.object({ alquiler: AlquilerSchema, habitacion: HabitacionSchema }).strict();
export type SalidaRespuesta = z.infer<typeof SalidaRespuestaSchema>;

// --- Tienda (definida, todavía sin ruta HTTP) ---

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
