import { createHmac, randomInt, randomUUID } from "node:crypto";
import type {
  AnularTicketEntrada,
  AnularTicketRespuesta,
  CodigoAutorizacion,
  GenerarCodigoAutorizacionRespuesta,
} from "@apurimeno/contracts";
import {
  ErrorNegocio,
  anularTicket,
  aplicarAnulacionHoraAdicional,
  aplicarAnulacionIngreso,
  crearCodigoAutorizacion,
  revertirVentaEnInventario,
} from "@apurimeno/domain";
import { auditar } from "../auditoria.js";
import type { Transaccion } from "../db.js";
import {
  INCLUIR_TICKET,
  aAlquiler,
  aCodigoAutorizacion,
  aHabitacion,
  aHoraAdicional,
  aProducto,
  aTicket,
  datosTicket,
  fecha,
} from "../mapeo.js";
import { siguienteNumeroTicket, unaSolaVez } from "./cobros.js";
import { contextoDominio, noEncontrado, parametrosVigentes, type ContextoServicio } from "./contexto.js";
import { turnoAbiertoDe } from "./turnos.js";

const DIGITOS_CODIGO = 6;
/** Contra la fuerza bruta: con 6 dígitos, 5 intentos cada 15 minutos dan 1 en 200 000 de acertar. */
const MAX_INTENTOS_FALLIDOS = 5;
const VENTANA_INTENTOS_MS = 15 * 60_000;

/** Secreto del servidor con el que se firman los códigos (HMAC-SHA256). */
export type SecretoCodigos = Buffer;

export function hashCodigo(secreto: SecretoCodigos, codigo: string): string {
  return createHmac("sha256", secreto).update(codigo.trim()).digest("hex");
}

/**
 * Genera un código de autorización temporal (CU-21, RN-46, RF-65): 6 dígitos de una fuente criptográfica,
 * de un solo uso, vigente los minutos configurados. Solo se guarda su HMAC; el código en claro se devuelve
 * esta única vez para que el Administrador se lo comunique al cajero.
 */
export async function generarCodigoServicio(
  ctx: ContextoServicio,
  secreto: SecretoCodigos,
): Promise<GenerarCodigoAutorizacionRespuesta> {
  return ctx.prisma.$transaction(async (tx) => {
    const { minutosVigenciaCodigoAutorizacion } = await parametrosVigentes(tx);
    // Dos códigos vigentes iguales serían ambiguos al validar: se regenera hasta que no choque.
    let codigo: string;
    let hash: string;
    do {
      codigo = randomInt(0, 10 ** DIGITOS_CODIGO).toString().padStart(DIGITOS_CODIGO, "0");
      hash = hashCodigo(secreto, codigo);
    } while ((await tx.codigoAutorizacion.findFirst({ where: { codigoHash: hash, usadoEn: null, expiraEn: { gt: ctx.ahora } } })) !== null);

    const registro = crearCodigoAutorizacion(
      { codigo: hash, operacion: "ANULAR_TICKET", generadoPorId: ctx.usuario.id, minutosVigencia: minutosVigenciaCodigoAutorizacion },
      contextoDominio(ctx.ahora),
    );
    await tx.codigoAutorizacion.create({
      data: {
        id: registro.id,
        codigoHash: hash,
        operacion: registro.operacion,
        generadoPorId: registro.generadoPorId,
        generadoEn: fecha(registro.generadoEn),
        expiraEn: fecha(registro.expiraEn),
      },
    });
    await auditar(
      tx,
      {
        usuarioId: ctx.usuario.id,
        accion: "CODIGO_AUTORIZACION_GENERADO",
        tipoEntidad: "CODIGO_AUTORIZACION",
        entidadId: registro.id,
        valorNuevo: { operacion: registro.operacion, expiraEn: registro.expiraEn },
      },
      ctx.ahora,
    );
    return { id: registro.id, codigo, expiraEn: registro.expiraEn };
  });
}

async function intentosFallidosRecientes(tx: Transaccion, usuarioId: string, ahora: Date): Promise<number> {
  return tx.registroAuditoria.count({
    where: {
      usuarioId,
      accion: "ACCESO_DENEGADO",
      tipoEntidad: "CODIGO_AUTORIZACION",
      ocurridoEn: { gt: new Date(ahora.getTime() - VENTANA_INTENTOS_MS) },
    },
  });
}

/** Busca el código ingresado por el cajero; null si no corresponde a ningún código sin usar. */
async function buscarCodigo(
  tx: Transaccion,
  secreto: SecretoCodigos,
  valorIngresado: string | null,
): Promise<{ codigo: CodigoAutorizacion; valorIngresado: string } | null> {
  if (valorIngresado === null || valorIngresado.trim() === "") return null;
  const hash = hashCodigo(secreto, valorIngresado);
  const fila = await tx.codigoAutorizacion.findFirst({
    where: { codigoHash: hash, usadoEn: null },
    orderBy: { generadoEn: "desc" },
  });
  return fila === null ? null : { codigo: aCodigoAutorizacion(fila), valorIngresado: hash };
}

async function aplicarEfectos(tx: Transaccion, ctx: ContextoServicio, r: AnularTicketRespuesta): Promise<void> {
  const { original, compensatorio } = r;
  if (original.origen === "INGRESO_ALQUILER" || original.origen === "HORA_ADICIONAL") {
    const alquilerId = original.alquilerId ?? "";
    const alquiler = aAlquiler(await tx.alquiler.findUniqueOrThrow({ where: { id: alquilerId } }));
    // El ticket anulado ya está marcado ANULADO en esta transacción: no cuenta como vigente.
    const horasVigentes = (
      await tx.horaAdicional.findMany({ where: { alquilerId, ticket: { is: { estado: "EMITIDO" } } } })
    ).map(aHoraAdicional);

    if (original.origen === "INGRESO_ALQUILER") {
      const habitacion = aHabitacion(await tx.habitacion.findUniqueOrThrow({ where: { id: alquiler.habitacionId } }));
      const efecto = aplicarAnulacionIngreso(alquiler, habitacion, horasVigentes.length);
      const { count } = await tx.alquiler.updateMany({ where: { id: alquilerId, estado: "ABIERTO" }, data: { estado: efecto.alquiler.estado } });
      if (count === 0) throw new ErrorNegocio("RENTAL_NOT_OPEN");
      await tx.habitacion.updateMany({ where: { id: habitacion.id, estado: habitacion.estado }, data: { estado: efecto.habitacion.estado } });
      return;
    }

    const recalculado = aplicarAnulacionHoraAdicional(alquiler, horasVigentes);
    if (recalculado.salidaProgramadaEn !== alquiler.salidaProgramadaEn) {
      const { count } = await tx.alquiler.updateMany({
        where: { id: alquilerId, estado: "ABIERTO", salidaProgramadaEn: fecha(alquiler.salidaProgramadaEn) },
        data: { salidaProgramadaEn: fecha(recalculado.salidaProgramadaEn) },
      });
      if (count === 0) throw new ErrorNegocio("INVALID_STATE_TRANSITION", "El alquiler cambió; vuelva a intentar.");
    }
    return;
  }

  const ids = [...new Set(original.lineas.flatMap((l) => (l.productoId === null ? [] : [l.productoId])))];
  const productos = (await tx.producto.findMany({ where: { id: { in: ids } } })).map(aProducto);
  const efecto = revertirVentaEnInventario(original, productos);
  for (const producto of efecto.productos) {
    const anterior = productos.find((p) => p.id === producto.id);
    const { count } = await tx.producto.updateMany({ where: { id: producto.id, stock: anterior?.stock }, data: { stock: producto.stock } });
    if (count === 0) throw new ErrorNegocio("INVALID_STATE_TRANSITION", "El stock cambió; vuelva a intentar.");
  }
  for (const movimiento of efecto.movimientos) {
    await tx.movimientoInventario.create({
      data: { id: randomUUID(), ...movimiento, ticketId: compensatorio.id, creadoPorId: ctx.usuario.id, creadoEn: ctx.ahora },
    });
  }
}

/**
 * Anula un cobro (CU-21; RN-36, RN-46, RF-29, RF-30). Emite el ticket compensatorio en el turno abierto de
 * quien anula, marca el original ANULADO y resuelve sus efectos: el ingreso libera la habitación, la hora
 * adicional recalcula la salida y la venta restituye el stock. Quien no tiene `tickets.void` necesita un
 * código de autorización, que queda consumido. Los códigos fallidos cuentan para el límite de intentos.
 * Es idempotente por clave (RF-59).
 */
export async function anularTicketServicio(
  ctx: ContextoServicio,
  ticketId: string,
  entrada: AnularTicketEntrada,
  clave: string,
  secreto: SecretoCodigos,
) {
  const previo = await ctx.prisma.ticket.findUnique({ where: { id: ticketId }, select: { origen: true } });
  if (previo === null) throw noEncontrado("El ticket");
  const conCodigo = !ctx.usuario.permisos.includes("tickets.void");

  const reproducir = async (compensatorioId: string): Promise<AnularTicketRespuesta> => {
    const compensatorio = aTicket(await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: compensatorioId }, include: INCLUIR_TICKET }));
    if (compensatorio.ticketOriginalId !== ticketId) {
      throw new ErrorNegocio("INVALID_STATE_TRANSITION", "La clave de idempotencia pertenece a la anulación de otro ticket.");
    }
    const original = aTicket(await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: INCLUIR_TICKET }));
    return { original, compensatorio };
  };

  try {
    return await unaSolaVez(ctx.prisma, clave, { tipo: "COMPENSATORIO", origen: previo.origen }, reproducir, () =>
      ctx.prisma.$transaction(async (tx) => {
        const ticket = aTicket(await tx.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: INCLUIR_TICKET }));
        const turno = await turnoAbiertoDe(tx, ctx.usuario.id);
        let autorizacion = null;
        if (conCodigo) {
          if ((await intentosFallidosRecientes(tx, ctx.usuario.id, ctx.ahora)) >= MAX_INTENTOS_FALLIDOS) {
            throw new ErrorNegocio("AUTH_CODE_INVALID", "Demasiados códigos incorrectos: espere 15 minutos.");
          }
          autorizacion = await buscarCodigo(tx, secreto, entrada.codigoAutorizacion);
        }

        const r = anularTicket(
          {
            ticket,
            motivo: entrada.motivo,
            numero: await siguienteNumeroTicket(tx),
            turno,
            usuario: { id: ctx.usuario.id, permisos: ctx.usuario.permisos },
            autorizacion,
          },
          contextoDominio(ctx.ahora),
        );

        const marcado = await tx.ticket.updateMany({ where: { id: ticketId, estado: "EMITIDO" }, data: { estado: "ANULADO" } });
        if (marcado.count === 0) throw new ErrorNegocio("TICKET_ALREADY_VOIDED");
        await tx.ticket.create({ data: datosTicket(r.compensatorio, clave) });
        if (r.codigoConsumido !== null) {
          const consumido = await tx.codigoAutorizacion.updateMany({
            where: { id: r.codigoConsumido.id, usadoEn: null },
            data: { usadoEn: ctx.ahora, usadoPorId: ctx.usuario.id, ticketId },
          });
          if (consumido.count === 0) throw new ErrorNegocio("AUTH_CODE_INVALID");
        }
        await aplicarEfectos(tx, ctx, r);

        await auditar(
          tx,
          {
            usuarioId: ctx.usuario.id,
            accion: "TICKET_ANULADO",
            tipoEntidad: "TICKET",
            entidadId: ticketId,
            valorPrevio: { estado: ticket.estado },
            valorNuevo: {
              estado: r.original.estado,
              compensatorioId: r.compensatorio.id,
              codigoAutorizacionId: r.codigoConsumido?.id ?? null,
              codigoGeneradoPorId: r.codigoConsumido?.generadoPorId ?? null,
            },
            motivo: r.compensatorio.anulacion?.motivo ?? null,
          },
          ctx.ahora,
        );
        return { original: r.original, compensatorio: r.compensatorio };
      }),
    );
  } catch (error) {
    if (conCodigo && error instanceof ErrorNegocio && error.codigo === "AUTH_CODE_INVALID") {
      // Fuera de la transacción, que ya se revirtió: el intento fallido debe quedar registrado.
      await auditar(
        ctx.prisma,
        {
          usuarioId: ctx.usuario.id,
          accion: "ACCESO_DENEGADO",
          tipoEntidad: "CODIGO_AUTORIZACION",
          entidadId: null,
          valorNuevo: { operacion: "ANULAR_TICKET", ticketId },
        },
        ctx.ahora,
      );
    }
    throw error;
  }
}
