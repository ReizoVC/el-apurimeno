import { randomUUID } from "node:crypto";
import {
  TurnoSchema,
  type AbrirTurnoEntrada,
  type CerrarTurnoEntrada,
  type MovimientoCaja,
  type MovimientoCajaEntrada,
  type Turno,
} from "@apurimeno/contracts";
import { ErrorNegocio, calcularEfectivoEsperado, cerrarTurno, prepararMovimientoCaja } from "@apurimeno/domain";
import { auditar } from "../auditoria.js";
import type { Transaccion } from "../db.js";
import { ErrorApi, esViolacionUnica } from "../errores.js";
import { INCLUIR_TICKET, aMetodoPago, aMovimientoCaja, aTicket, aTurno, datosTurno } from "../mapeo.js";
import type { ContextoServicio } from "./contexto.js";

/** Turno abierto del usuario, o SHIFT_NOT_OPEN: ningún cobro sin turno (RN-32). */
export async function turnoAbiertoDe(tx: Transaccion, usuarioId: string): Promise<Turno> {
  const fila = await tx.turno.findFirst({ where: { usuarioId, estado: "ABIERTO" } });
  if (fila === null) throw new ErrorNegocio("SHIFT_NOT_OPEN");
  return aTurno(fila);
}

/** Abre el turno del cajero (CU-02, RF-32). Un solo turno abierto por usuario: índice único parcial. */
export async function abrirTurno(ctx: ContextoServicio, entrada: AbrirTurnoEntrada): Promise<Turno> {
  const turno = TurnoSchema.parse({
    id: randomUUID(),
    usuarioId: ctx.usuario.id,
    estado: "ABIERTO",
    abiertoEn: ctx.ahora.toISOString(),
    efectivoInicial: entrada.efectivoInicial,
    cerradoEn: null,
    cerradoPorId: null,
    cierreForzado: false,
    efectivoContado: null,
    efectivoEsperado: null,
    diferencia: null,
    comentarioCierre: null,
  });
  try {
    await ctx.prisma.$transaction(async (tx) => {
      await tx.turno.create({ data: datosTurno(turno) });
      await auditar(
        tx,
        { usuarioId: ctx.usuario.id, accion: "TURNO_ABIERTO", tipoEntidad: "TURNO", entidadId: turno.id, valorNuevo: turno },
        ctx.ahora,
      );
    });
  } catch (error) {
    if (esViolacionUnica(error)) {
      throw new ErrorNegocio("INVALID_STATE_TRANSITION", "Ya tiene un turno abierto.");
    }
    throw error;
  }
  return turno;
}

/**
 * Cierra el turno propio con arqueo ciego (CU-19; RN-33 a RN-35, PEND-05). El cajero envía lo contado;
 * el esperado se calcula aquí y solo se revela en la respuesta, ya cerrado.
 */
export async function cerrarTurnoPropio(ctx: ContextoServicio, entrada: CerrarTurnoEntrada): Promise<Turno> {
  return ctx.prisma.$transaction(async (tx) => {
    const turno = await turnoAbiertoDe(tx, ctx.usuario.id);
    const tickets = await tx.ticket.findMany({ where: { turnoId: turno.id }, include: INCLUIR_TICKET });
    const movimientos = await tx.movimientoCaja.findMany({ where: { turnoId: turno.id } });
    const metodos = await tx.metodoPago.findMany();
    const efectivoEsperado = calcularEfectivoEsperado(
      turno,
      tickets.map(aTicket),
      movimientos.map(aMovimientoCaja),
      metodos.map(aMetodoPago),
    );
    const cerrado = cerrarTurno(turno, {
      efectivoContado: entrada.efectivoContado,
      efectivoEsperado,
      comentario: entrada.comentario,
      ahora: ctx.ahora.toISOString(),
    });

    const { count } = await tx.turno.updateMany({
      where: { id: turno.id, estado: "ABIERTO" },
      data: datosTurno(cerrado),
    });
    if (count === 0) throw new ErrorNegocio("SHIFT_NOT_OPEN");
    await auditar(
      tx,
      {
        usuarioId: ctx.usuario.id,
        accion: "TURNO_CERRADO",
        tipoEntidad: "TURNO",
        entidadId: turno.id,
        valorPrevio: turno,
        valorNuevo: cerrado,
        motivo: cerrado.comentarioCierre,
      },
      ctx.ahora,
    );
    return cerrado;
  });
}

/**
 * Ingreso o retiro manual de efectivo en el turno propio (CU-18, RF-42): motivo obligatorio, monto positivo y
 * turno abierto (RN-32). Entra en el efectivo esperado del arqueo (RN-33). Es idempotente por clave, como un
 * cobro: si la clave ya registró un movimiento de este usuario, se devuelve ese mismo sin crear otro.
 */
export async function registrarMovimientoCajaServicio(
  ctx: ContextoServicio,
  entrada: MovimientoCajaEntrada,
  clave: string,
): Promise<{ resultado: MovimientoCaja; repetido: boolean }> {
  const buscar = async () => {
    const previo = await ctx.prisma.movimientoCaja.findUnique({ where: { claveIdempotencia: clave } });
    if (previo !== null && previo.creadoPorId !== ctx.usuario.id) {
      throw new ErrorApi("CLAVE_IDEMPOTENCIA_REUTILIZADA", "La clave de idempotencia ya se usó en otra operación.");
    }
    return previo;
  };
  const previo = await buscar();
  if (previo !== null) return { resultado: aMovimientoCaja(previo), repetido: true };

  try {
    const resultado = await ctx.prisma.$transaction(async (tx) => {
      const turno = await turnoAbiertoDe(tx, ctx.usuario.id);
      const borrador = prepararMovimientoCaja(turno, entrada.tipo, entrada.monto, entrada.motivo);
      const movimiento = aMovimientoCaja(
        await tx.movimientoCaja.create({
          data: { id: randomUUID(), ...borrador, creadoPorId: ctx.usuario.id, creadoEn: ctx.ahora, claveIdempotencia: clave },
        }),
      );
      await auditar(
        tx,
        {
          usuarioId: ctx.usuario.id,
          accion: "MOVIMIENTO_CAJA_REGISTRADO",
          tipoEntidad: "MOVIMIENTO_CAJA",
          entidadId: movimiento.id,
          valorNuevo: movimiento,
          motivo: movimiento.motivo,
        },
        ctx.ahora,
      );
      return movimiento;
    });
    return { resultado, repetido: false };
  } catch (error) {
    // Dos envíos simultáneos con la misma clave: el índice único rechaza el segundo.
    if (!esViolacionUnica(error)) throw error;
    const ganador = await buscar();
    if (ganador === null) throw error;
    return { resultado: aMovimientoCaja(ganador), repetido: true };
  }
}
