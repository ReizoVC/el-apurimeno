import {
  TicketSchema,
  type FechaISO,
  type Id,
  type OrigenTicket,
  type Pago,
  type Ticket,
  type Turno,
} from "@apurimeno/contracts";
import { asegurarTurnoAbierto } from "./caja.js";
import { ErrorNegocio } from "./errores.js";
import { asegurarCentimos } from "./interno.js";
import type { Cotizacion } from "./precios.js";

/** Reloj y generador de ids inyectados, para que las funciones sigan siendo puras y probables. */
export interface Contexto {
  ahora: FechaISO;
  generarId: () => Id;
}

/** Pago antes de persistirse: el backend le asigna `id`. */
export type BorradorPago = Omit<Pago, "id">;

/** Pago en efectivo con vuelto (RF-04). El monto recibido debe cubrir el monto a pagar. */
export function pagoEnEfectivo(metodoPagoId: Id, monto: number, montoRecibido: number): BorradorPago {
  asegurarCentimos(monto, "monto");
  asegurarCentimos(montoRecibido, "montoRecibido");
  if (montoRecibido < monto) throw new ErrorNegocio("PAYMENT_INSUFFICIENT");
  return { metodoPagoId, monto, referencia: null, montoRecibido, vuelto: montoRecibido - monto };
}

/** Pago sin vuelto (Yape, Plin, etc.), con número de operación opcional. */
export function pagoSinVuelto(metodoPagoId: Id, monto: number, referencia: string | null): BorradorPago {
  asegurarCentimos(monto, "monto");
  const limpia = referencia?.trim() ?? "";
  return { metodoPagoId, monto, referencia: limpia === "" ? null : limpia, montoRecibido: null, vuelto: null };
}

export interface DatosTicketCobro {
  /** Correlativo asignado por la base de datos en la misma transacción. */
  numero: number;
  origen: OrigenTicket;
  turno: Turno;
  alquilerId: Id | null;
  habitacionReferenciaId: Id | null;
  cotizacion: Cotizacion;
  pagos: readonly BorradorPago[];
  creadoPorId: Id;
}

/**
 * Arma el ticket de un cobro (RN-23, RN-32, RN-36, RN-37). Todo se cobra en el momento: los pagos
 * deben cubrir exactamente el total. El resultado se valida contra `TicketSchema`, que concentra las
 * invariantes del ticket (§21); si no las cumple, es un error de programación y se lanza ZodError.
 */
export function armarTicketCobro(datos: DatosTicketCobro, ctx: Contexto): Ticket {
  asegurarTurnoAbierto(datos.turno);
  const pagado = datos.pagos.reduce((suma, p) => suma + p.monto, 0);
  if (pagado < datos.cotizacion.total) throw new ErrorNegocio("PAYMENT_INSUFFICIENT");
  if (pagado > datos.cotizacion.total) {
    throw new RangeError(`Los pagos (${pagado}) exceden el total (${datos.cotizacion.total}); el excedente es vuelto.`);
  }

  return TicketSchema.parse({
    id: ctx.generarId(),
    numero: datos.numero,
    tipo: "COBRO",
    origen: datos.origen,
    estado: "EMITIDO",
    turnoId: datos.turno.id,
    alquilerId: datos.alquilerId,
    habitacionReferenciaId: datos.habitacionReferenciaId,
    ticketOriginalId: null,
    total: datos.cotizacion.total,
    ajustePuntual: datos.cotizacion.ajustePuntual,
    anulacion: null,
    lineas: datos.cotizacion.lineas.map((l) => ({ id: ctx.generarId(), ...l })),
    pagos: datos.pagos.map((p) => ({ id: ctx.generarId(), ...p })),
    creadoPorId: datos.creadoPorId,
    creadoEn: ctx.ahora,
  });
}

/**
 * Invariantes de un ticket (§21): total = suma de líneas = suma de pagos, líneas según el origen,
 * ajuste solo al alza, reglas del compensatorio, etc. Devuelve los problemas encontrados; vacío si es válido.
 * La fuente única de estas reglas es `TicketSchema` en `@apurimeno/contracts`.
 */
export function validarInvariantesTicket(ticket: unknown): string[] {
  const resultado = TicketSchema.safeParse(ticket);
  if (resultado.success) return [];
  return resultado.error.issues.map((issue) => `${issue.path.join(".") || "ticket"}: ${issue.message}`);
}
