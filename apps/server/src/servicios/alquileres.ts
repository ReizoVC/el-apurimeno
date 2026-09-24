import { randomUUID } from "node:crypto";
import {
  HoraAdicionalSchema,
  type AjusteEntrada,
  type CotizacionHoraAdicionalRespuesta,
  type CotizacionIngresoRespuesta,
  type CotizarIngresoEntrada,
  type RegistrarHoraAdicionalEntrada,
  type RegistrarHoraAdicionalRespuesta,
  type RegistrarIngresoEntrada,
  type RegistrarIngresoRespuesta,
  type SalidaRespuesta,
} from "@apurimeno/contracts";
import {
  ErrorNegocio,
  aplicarAjustePuntual,
  armarTicketCobro,
  calcularEstadoTemporal,
  calcularHoraAdicional,
  calcularSalidaInicial,
  cotizarHoraAdicional,
  cotizarIngreso,
  iniciarAlquiler,
  registrarHoraAdicional,
  registrarSalida,
  registrarSalidaSinPago,
  type Cotizacion,
} from "@apurimeno/domain";
import { exigir, type UsuarioAutenticado } from "../auth.js";
import { auditar } from "../auditoria.js";
import type { Transaccion } from "../db.js";
import { esViolacionUnica } from "../errores.js";
import {
  INCLUIR_TICKET,
  aAlquiler,
  aHabitacion,
  aHoraAdicional,
  aTicket,
  datosAlquiler,
  datosTicket,
  fecha,
} from "../mapeo.js";
import { construirPagos, siguienteNumeroTicket, unaSolaVez } from "./cobros.js";
import { contextoDominio, noEncontrado, parametrosVigentes, type ContextoServicio } from "./contexto.js";
import { turnoAbiertoDe } from "./turnos.js";

// Orquesta @apurimeno/domain con la base de datos: lee, llama a la regla pura y persiste el resultado
// en una sola transacción. Ninguna regla de negocio se recalcula aquí.

async function leerHabitacion(tx: Transaccion, id: string) {
  const fila = await tx.habitacion.findUnique({ where: { id } });
  if (fila === null) throw noEncontrado("La habitación");
  return aHabitacion(fila);
}

async function leerAlquiler(tx: Transaccion, id: string) {
  const fila = await tx.alquiler.findUnique({ where: { id } });
  if (fila === null) throw noEncontrado("El alquiler");
  return aAlquiler(fila);
}

async function preciosEspecialesDe(tx: Transaccion, clienteId: string | null) {
  if (clienteId === null) return [];
  if ((await tx.cliente.findUnique({ where: { id: clienteId } })) === null) throw noEncontrado("El cliente");
  const filas = await tx.precioEspecialCliente.findMany({ where: { clienteId } });
  return filas.map((p) => ({ ...p, creadoEn: p.creadoEn.toISOString() }));
}

/** Ajuste puntual de habitación u hora adicional: exige `rentals.manual_adjustment` (decisión 9 de contracts). */
function conAjuste(cotizacion: Cotizacion, ajuste: AjusteEntrada | null, usuario: UsuarioAutenticado): Cotizacion {
  if (ajuste === null) return cotizacion;
  exigir(usuario, "AJUSTAR_PRECIO_HABITACION");
  return aplicarAjustePuntual(cotizacion, ajuste.montoAjustado, ajuste.motivo);
}

async function leerTicket(tx: Transaccion, id: string) {
  const fila = await tx.ticket.findUniqueOrThrow({ where: { id }, include: INCLUIR_TICKET });
  return aTicket(fila);
}

// --- Ingreso (CU-04) ---

export async function cotizarIngresoServicio(
  ctx: ContextoServicio,
  entrada: CotizarIngresoEntrada,
): Promise<CotizacionIngresoRespuesta> {
  const tx = ctx.prisma;
  const { parametros } = await parametrosVigentes(tx);
  const cotizacion = cotizarIngreso({
    habitacion: await leerHabitacion(tx, entrada.habitacionId),
    clienteId: entrada.clienteId,
    preciosEspeciales: await preciosEspecialesDe(tx, entrada.clienteId),
    parametros,
    horasAdicionalesAlIngreso: entrada.horasAdicionalesAlIngreso,
  });
  return {
    lineas: cotizacion.lineas,
    total: cotizacion.total,
    ajustePuntual: null,
    origenPrecio: cotizacion.origenPrecio,
    salidaProgramadaEn: calcularSalidaInicial(ctx.ahora.toISOString(), parametros, entrada.horasAdicionalesAlIngreso),
  };
}

async function reproducirIngreso(ctx: ContextoServicio, ticketId: string): Promise<RegistrarIngresoRespuesta> {
  const ticket = await leerTicket(ctx.prisma, ticketId);
  const alquiler = await leerAlquiler(ctx.prisma, ticket.alquilerId ?? "");
  return { alquiler, habitacion: await leerHabitacion(ctx.prisma, alquiler.habitacionId), ticket };
}

/**
 * Registra un ingreso cobrado (CU-04): alquiler, ticket, pagos, habitación ocupada y auditoría en una sola
 * transacción. Un reintento con la misma clave devuelve el mismo resultado (RF-59). Si otro cajero ocupó la
 * habitación al mismo tiempo, el índice único parcial lo rechaza y responde ROOM_NOT_AVAILABLE (T-15).
 */
export async function registrarIngresoServicio(
  ctx: ContextoServicio,
  entrada: RegistrarIngresoEntrada,
  clave: string,
) {
  return unaSolaVez(
    ctx.prisma,
    clave,
    "INGRESO_ALQUILER",
    (ticketId) => reproducirIngreso(ctx, ticketId),
    async () => {
      try {
        return await ctx.prisma.$transaction(async (tx) => {
          const dominio = contextoDominio(ctx.ahora);
          const turno = await turnoAbiertoDe(tx, ctx.usuario.id);
          const { parametros } = await parametrosVigentes(tx);
          const ingreso = iniciarAlquiler(
            {
              habitacion: await leerHabitacion(tx, entrada.habitacionId),
              clienteId: entrada.clienteId,
              preciosEspeciales: await preciosEspecialesDe(tx, entrada.clienteId),
              parametros,
              horasAdicionalesAlIngreso: entrada.horasAdicionalesAlIngreso,
              turno,
            },
            dominio,
          );
          const cotizacion = conAjuste(ingreso.cotizacion, entrada.ajuste, ctx.usuario);
          const ticket = armarTicketCobro(
            {
              numero: await siguienteNumeroTicket(tx),
              origen: "INGRESO_ALQUILER",
              turno,
              alquilerId: ingreso.alquiler.id,
              habitacionReferenciaId: null,
              cotizacion,
              pagos: await construirPagos(tx, entrada.pagos),
              creadoPorId: ctx.usuario.id,
            },
            dominio,
          );

          const ocupada = await tx.habitacion.updateMany({
            where: { id: ingreso.habitacion.id, estado: "LIBRE" },
            data: { estado: ingreso.habitacion.estado },
          });
          if (ocupada.count === 0) throw new ErrorNegocio("ROOM_NOT_AVAILABLE");
          await tx.alquiler.create({ data: datosAlquiler(ingreso.alquiler) });
          await tx.ticket.create({ data: datosTicket(ticket, clave) });

          await auditar(
            tx,
            {
              usuarioId: ctx.usuario.id,
              accion: "INGRESO_REGISTRADO",
              tipoEntidad: "ALQUILER",
              entidadId: ingreso.alquiler.id,
              valorNuevo: { alquiler: ingreso.alquiler, ticketId: ticket.id, total: ticket.total },
            },
            ctx.ahora,
          );
          if (ticket.ajustePuntual !== null) {
            await auditar(
              tx,
              {
                usuarioId: ctx.usuario.id,
                accion: "AJUSTE_PUNTUAL_APLICADO",
                tipoEntidad: "TICKET",
                entidadId: ticket.id,
                valorNuevo: ticket.ajustePuntual,
                motivo: ticket.ajustePuntual.motivo,
              },
              ctx.ahora,
            );
          }
          return { alquiler: ingreso.alquiler, habitacion: ingreso.habitacion, ticket };
        });
      } catch (error) {
        if (esViolacionUnica(error)) {
          const abierto = await ctx.prisma.alquiler.findFirst({
            where: { habitacionId: entrada.habitacionId, estado: "ABIERTO" },
          });
          if (abierto !== null) throw new ErrorNegocio("ROOM_NOT_AVAILABLE");
        }
        throw error;
      }
    },
  );
}

// --- Hora adicional (CU-05) ---

export async function cotizarHoraAdicionalServicio(
  ctx: ContextoServicio,
  alquilerId: string,
): Promise<CotizacionHoraAdicionalRespuesta> {
  const alquiler = await leerAlquiler(ctx.prisma, alquilerId);
  const ahora = ctx.ahora.toISOString();
  const efecto = calcularHoraAdicional(alquiler, ahora);
  return {
    tipo: efecto.tipo,
    estadoTemporal: calcularEstadoTemporal(alquiler, ahora),
    salidaAnterior: efecto.salidaAnterior,
    salidaNueva: efecto.salidaNueva,
    cotizacion: cotizarHoraAdicional(alquiler),
  };
}

async function reproducirHoraAdicional(
  ctx: ContextoServicio,
  alquilerId: string,
  ticketId: string,
): Promise<RegistrarHoraAdicionalRespuesta> {
  const ticket = await leerTicket(ctx.prisma, ticketId);
  if (ticket.alquilerId !== alquilerId) {
    throw new ErrorNegocio("INVALID_STATE_TRANSITION", "La clave de idempotencia pertenece a otro alquiler.");
  }
  const hora = await ctx.prisma.horaAdicional.findUniqueOrThrow({ where: { ticketId } });
  return { alquiler: await leerAlquiler(ctx.prisma, alquilerId), horaAdicional: aHoraAdicional(hora), ticket };
}

/**
 * Cobra una hora adicional (CU-05). El tipo lo decide el dominio según la hora del servidor (RF-08).
 * La actualización del alquiler es condicional a la salida leída: si otro cobro la cambió en paralelo,
 * se rechaza en vez de pisarla.
 */
export async function registrarHoraAdicionalServicio(
  ctx: ContextoServicio,
  alquilerId: string,
  entrada: RegistrarHoraAdicionalEntrada,
  clave: string,
) {
  return unaSolaVez(
    ctx.prisma,
    clave,
    "HORA_ADICIONAL",
    (ticketId) => reproducirHoraAdicional(ctx, alquilerId, ticketId),
    () =>
      ctx.prisma.$transaction(async (tx) => {
        const dominio = contextoDominio(ctx.ahora);
        const turno = await turnoAbiertoDe(tx, ctx.usuario.id);
        const alquiler = await leerAlquiler(tx, alquilerId);
        const r = registrarHoraAdicional(alquiler, turno, dominio.ahora);
        const ticket = armarTicketCobro(
          {
            numero: await siguienteNumeroTicket(tx),
            origen: "HORA_ADICIONAL",
            turno,
            alquilerId,
            habitacionReferenciaId: null,
            cotizacion: conAjuste(r.cotizacion, entrada.ajuste, ctx.usuario),
            pagos: await construirPagos(tx, entrada.pagos),
            creadoPorId: ctx.usuario.id,
          },
          dominio,
        );
        const horaAdicional = HoraAdicionalSchema.parse({
          id: randomUUID(),
          alquilerId,
          ticketId: ticket.id,
          tipo: r.efecto.tipo,
          salidaAnterior: r.efecto.salidaAnterior,
          salidaNueva: r.efecto.salidaNueva,
          creadoPorId: ctx.usuario.id,
          creadoEn: dominio.ahora,
        });

        const actualizado = await tx.alquiler.updateMany({
          where: { id: alquilerId, estado: "ABIERTO", salidaProgramadaEn: fecha(alquiler.salidaProgramadaEn) },
          data: { salidaProgramadaEn: fecha(r.alquiler.salidaProgramadaEn), cortesiaConsumida: r.alquiler.cortesiaConsumida },
        });
        if (actualizado.count === 0) {
          throw new ErrorNegocio("INVALID_STATE_TRANSITION", "El alquiler cambió mientras se cobraba; vuelva a cotizar.");
        }
        await tx.ticket.create({ data: datosTicket(ticket, clave) });
        await tx.horaAdicional.create({
          data: {
            ...horaAdicional,
            salidaAnterior: fecha(horaAdicional.salidaAnterior),
            salidaNueva: fecha(horaAdicional.salidaNueva),
            creadoEn: fecha(horaAdicional.creadoEn),
          },
        });
        await auditar(
          tx,
          {
            usuarioId: ctx.usuario.id,
            accion: "HORA_ADICIONAL_COBRADA",
            tipoEntidad: "HORA_ADICIONAL",
            entidadId: horaAdicional.id,
            valorPrevio: { salidaProgramadaEn: alquiler.salidaProgramadaEn, cortesiaConsumida: alquiler.cortesiaConsumida },
            valorNuevo: { horaAdicional, ticketId: ticket.id, total: ticket.total },
          },
          ctx.ahora,
        );
        if (ticket.ajustePuntual !== null) {
          await auditar(
            tx,
            {
              usuarioId: ctx.usuario.id,
              accion: "AJUSTE_PUNTUAL_APLICADO",
              tipoEntidad: "TICKET",
              entidadId: ticket.id,
              valorNuevo: ticket.ajustePuntual,
              motivo: ticket.ajustePuntual.motivo,
            },
            ctx.ahora,
          );
        }
        return { alquiler: r.alquiler, horaAdicional, ticket };
      }),
  );
}

// --- Salida (CU-06, CU-07) ---

async function cerrarAlquiler(
  ctx: ContextoServicio,
  alquilerId: string,
  motivoSinPago: string | null,
): Promise<SalidaRespuesta> {
  return ctx.prisma.$transaction(async (tx) => {
    const alquiler = await leerAlquiler(tx, alquilerId);
    const habitacion = await leerHabitacion(tx, alquiler.habitacionId);
    const datos = { usuarioId: ctx.usuario.id, ahora: ctx.ahora.toISOString() };
    const r =
      motivoSinPago === null
        ? registrarSalida(alquiler, habitacion, datos)
        : registrarSalidaSinPago(alquiler, habitacion, { ...datos, motivo: motivoSinPago });

    const cerrado = await tx.alquiler.updateMany({
      where: { id: alquilerId, estado: "ABIERTO" },
      data: {
        estado: r.alquiler.estado,
        cerradoEn: ctx.ahora,
        cerradoPorId: r.alquiler.cerradoPorId,
        salidaSinPago: r.alquiler.salidaSinPago,
        motivoSalidaSinPago: r.alquiler.motivoSalidaSinPago,
      },
    });
    if (cerrado.count === 0) throw new ErrorNegocio("RENTAL_NOT_OPEN");
    await tx.habitacion.updateMany({
      where: { id: habitacion.id, estado: habitacion.estado },
      data: { estado: r.habitacion.estado },
    });
    await auditar(
      tx,
      {
        usuarioId: ctx.usuario.id,
        accion: r.alquiler.salidaSinPago ? "SALIDA_SIN_PAGO_REGISTRADA" : "SALIDA_REGISTRADA",
        tipoEntidad: "ALQUILER",
        entidadId: alquilerId,
        valorPrevio: alquiler,
        valorNuevo: r.alquiler,
        motivo: r.alquiler.motivoSalidaSinPago,
      },
      ctx.ahora,
    );
    return r;
  });
}

export function registrarSalidaServicio(ctx: ContextoServicio, alquilerId: string) {
  return cerrarAlquiler(ctx, alquilerId, null);
}

export function registrarSalidaSinPagoServicio(ctx: ContextoServicio, alquilerId: string, motivo: string) {
  return cerrarAlquiler(ctx, alquilerId, motivo);
}
