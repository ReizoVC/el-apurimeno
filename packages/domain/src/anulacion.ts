import {
  CodigoAutorizacionSchema,
  TicketSchema,
  type CodigoAutorizacion,
  type Id,
  type OperacionAutorizable,
  type Permiso,
  type Ticket,
  type Turno,
} from "@apurimeno/contracts";
import { asegurarTurnoAbierto } from "./caja.js";
import { ErrorNegocio } from "./errores.js";
import { MS_POR_MINUTO, asegurarEnteroPositivo, iso, motivoRequerido, ms } from "./interno.js";
import type { Contexto } from "./tickets.js";

/**
 * Crea un código de autorización temporal (RN-46, RF-65). `codigo` debe venir de una fuente aleatoria
 * criptográfica del backend. Que el generador tenga `tickets.void` lo verifica quien llama.
 */
export function crearCodigoAutorizacion(
  datos: { codigo: string; operacion: OperacionAutorizable; generadoPorId: Id; minutosVigencia: number },
  ctx: Contexto,
): CodigoAutorizacion {
  asegurarEnteroPositivo(datos.minutosVigencia, "minutosVigencia");
  return CodigoAutorizacionSchema.parse({
    id: ctx.generarId(),
    codigo: datos.codigo,
    operacion: datos.operacion,
    generadoPorId: datos.generadoPorId,
    generadoEn: ctx.ahora,
    expiraEn: iso(ms(ctx.ahora) + datos.minutosVigencia * MS_POR_MINUTO),
    usadoEn: null,
    usadoPorId: null,
    ticketId: null,
  });
}

/** Un código sirve una sola vez, para su operación y dentro de su vigencia (RN-46, RF-66). */
export function validarCodigoAutorizacion(
  registro: CodigoAutorizacion,
  valorIngresado: string,
  operacion: OperacionAutorizable,
  ahora: string,
): void {
  const t = ms(ahora);
  const valido =
    registro.codigo === valorIngresado.trim() &&
    registro.operacion === operacion &&
    registro.usadoEn === null &&
    t >= ms(registro.generadoEn) &&
    t <= ms(registro.expiraEn);
  if (!valido) throw new ErrorNegocio("AUTH_CODE_INVALID");
}

export interface DatosAnulacion {
  ticket: Ticket;
  motivo: string;
  /** Correlativo del ticket compensatorio. */
  numero: number;
  /** Turno abierto de quien anula: el compensatorio y su devolución quedan en ese turno. */
  turno: Turno;
  usuario: { id: Id; permisos: readonly Permiso[] };
  /** Obligatorio si el usuario no tiene `tickets.void` (Cajero). */
  autorizacion: { codigo: CodigoAutorizacion; valorIngresado: string } | null;
}

export interface ResultadoAnulacion {
  original: Ticket;
  compensatorio: Ticket;
  codigoConsumido: CodigoAutorizacion | null;
}

/**
 * Anula un cobro sin borrarlo (RN-36, RN-46, RF-29, CU-21): el original pasa a ANULADO y se emite un
 * ticket COMPENSATORIO por el importe inverso, con la devolución en los mismos métodos de pago.
 * Quien tiene `tickets.void` anula directo; los demás necesitan un código de autorización válido,
 * que queda consumido.
 * Los efectos sobre el alquiler, la habitación o el stock se aplican aparte
 * (`aplicarAnulacionIngreso`, `aplicarAnulacionHoraAdicional`, `revertirVentaEnInventario`).
 */
export function anularTicket(datos: DatosAnulacion, ctx: Contexto): ResultadoAnulacion {
  const { ticket, usuario } = datos;
  if (ticket.tipo === "COMPENSATORIO") throw new ErrorNegocio("INVALID_STATE_TRANSITION");
  if (ticket.estado === "ANULADO") throw new ErrorNegocio("TICKET_ALREADY_VOIDED");
  const motivo = motivoRequerido(datos.motivo);
  asegurarTurnoAbierto(datos.turno);

  let codigoConsumido: CodigoAutorizacion | null = null;
  if (!usuario.permisos.includes("tickets.void")) {
    if (datos.autorizacion === null) throw new ErrorNegocio("AUTH_CODE_INVALID");
    const { codigo, valorIngresado } = datos.autorizacion;
    validarCodigoAutorizacion(codigo, valorIngresado, "ANULAR_TICKET", ctx.ahora);
    codigoConsumido = CodigoAutorizacionSchema.parse({
      ...codigo,
      usadoEn: ctx.ahora,
      usadoPorId: usuario.id,
      ticketId: ticket.id,
    });
  }

  const compensatorio = TicketSchema.parse({
    id: ctx.generarId(),
    numero: datos.numero,
    tipo: "COMPENSATORIO",
    origen: ticket.origen,
    estado: "EMITIDO",
    turnoId: datos.turno.id,
    alquilerId: ticket.alquilerId,
    habitacionReferenciaId: ticket.habitacionReferenciaId,
    ticketOriginalId: ticket.id,
    total: 0 - ticket.total,
    ajustePuntual: null,
    anulacion: { motivo, codigoAutorizacionId: codigoConsumido?.id ?? null },
    lineas: ticket.lineas.map((l) => ({
      ...l,
      id: ctx.generarId(),
      precioUnitario: 0 - l.precioUnitario,
      importe: 0 - l.importe,
    })),
    pagos: ticket.pagos.map((p) => ({
      id: ctx.generarId(),
      metodoPagoId: p.metodoPagoId,
      monto: 0 - p.monto,
      referencia: p.referencia,
      montoRecibido: null,
      vuelto: null,
    })),
    creadoPorId: usuario.id,
    creadoEn: ctx.ahora,
  });

  return { original: { ...ticket, estado: "ANULADO" }, compensatorio, codigoConsumido };
}
