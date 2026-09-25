import { z } from "zod";

/**
 * Códigos de error de negocio que el SRS declara estables (§24.2).
 * Se conservan en inglés, textuales, tal como los nombra la sección 16.
 * Los cuatro últimos los definió el proyecto: el SRS no los nombra (README de contracts, decisión 19).
 */
export const CodigoErrorNegocioSchema = z.enum([
  "ROOM_NOT_AVAILABLE",
  "PAYMENT_INSUFFICIENT",
  "OVERTIME_UNRESOLVED",
  "REASON_REQUIRED",
  "CLIENT_ROOM_PRICE_ALREADY_EXISTS",
  "ADJUSTMENT_BELOW_MINIMUM",
  "INSUFFICIENT_STOCK",
  "TICKET_ALREADY_VOIDED",
  "AUTH_CODE_INVALID",
  // RN-32: ningún cobro sin turno de caja abierto.
  "SHIFT_NOT_OPEN",
  // CU-05, CU-06: la operación exige un alquiler en estado ABIERTO.
  "RENTAL_NOT_OPEN",
  // §20, §32: el cambio de estado no está permitido desde el estado actual.
  "INVALID_STATE_TRANSITION",
  // CU-23: un usuario no puede desactivarse ni quitarse users.manage a sí mismo.
  "SELF_LOCKOUT_FORBIDDEN",
]);
export type CodigoErrorNegocio = z.infer<typeof CodigoErrorNegocioSchema>;
export const CodigoErrorNegocio = CodigoErrorNegocioSchema.enum;

/** Mensaje base para el personal (§24.1: lenguaje comprensible), igual en los tres frontends. */
export const MENSAJE_ERROR_NEGOCIO: Readonly<Record<CodigoErrorNegocio, string>> = {
  ROOM_NOT_AVAILABLE: "La habitación ya no está disponible.",
  PAYMENT_INSUFFICIENT: "El monto recibido no cubre el total.",
  OVERTIME_UNRESOLVED:
    "El alquiler está en sobretiempo: cobre la hora adicional o registre la salida sin pago.",
  REASON_REQUIRED: "Debe indicar un motivo.",
  CLIENT_ROOM_PRICE_ALREADY_EXISTS:
    "Este cliente ya tiene un precio especial para esta habitación; edítelo en lugar de crear otro.",
  ADJUSTMENT_BELOW_MINIMUM:
    "El ajuste no puede ser menor al precio que corresponde automáticamente.",
  INSUFFICIENT_STOCK: "No hay stock suficiente del producto.",
  TICKET_ALREADY_VOIDED: "Este ticket ya fue anulado.",
  AUTH_CODE_INVALID: "El código de autorización es incorrecto, venció o ya fue utilizado.",
  SHIFT_NOT_OPEN: "No hay un turno de caja abierto.",
  RENTAL_NOT_OPEN: "El alquiler ya no está abierto.",
  INVALID_STATE_TRANSITION: "Esta operación no está permitida en el estado actual.",
  SELF_LOCKOUT_FORBIDDEN:
    "No puede desactivar su propia cuenta ni quitarse el permiso de gestionar usuarios; pídaselo a otro administrador.",
};
