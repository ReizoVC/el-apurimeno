import type { EstadoHabitacion, Habitacion, HabitacionEntrada } from "@apurimeno/contracts";
import {
  ErrorNegocio,
  bloquearPorMantenimiento,
  crearHabitacion,
  editarHabitacion,
  marcarHabitacionLista,
  reactivarHabitacion,
  reportarMantenimiento,
} from "@apurimeno/domain";
import { auditar } from "../auditoria.js";
import { ErrorApi, esViolacionUnica } from "../errores.js";
import { aHabitacion } from "../mapeo.js";
import { contextoDominio, noEncontrado, type ContextoServicio } from "./contexto.js";

const numeroRepetido = () => new ErrorApi("VALIDACION", "numero: ya existe una habitación con ese número.");

/** Todas las habitaciones, por número: tablero del POS y administración. */
export async function listarHabitaciones(ctx: ContextoServicio): Promise<Habitacion[]> {
  return (await ctx.prisma.habitacion.findMany({ orderBy: { numero: "asc" } })).map(aHabitacion);
}

/**
 * Lista de limpieza (CU-15, RF-40): exactamente las habitaciones en PENDIENTE_LIMPIEZA. El filtro lo aplica
 * el servidor; limpieza no recibe el estado del resto del hotel.
 */
export async function listarPendientesLimpieza(ctx: ContextoServicio): Promise<Habitacion[]> {
  const filas = await ctx.prisma.habitacion.findMany({ where: { estado: "PENDIENTE_LIMPIEZA" }, orderBy: { numero: "asc" } });
  return filas.map(aHabitacion);
}

/** Alta de habitación (CU-13, RF-36). */
export async function crearHabitacionServicio(ctx: ContextoServicio, entrada: HabitacionEntrada): Promise<Habitacion> {
  const habitacion = crearHabitacion(entrada, contextoDominio(ctx.ahora));
  try {
    await ctx.prisma.$transaction(async (tx) => {
      await tx.habitacion.create({ data: habitacion });
      await auditar(
        tx,
        { usuarioId: ctx.usuario.id, accion: "HABITACION_CREADA", tipoEntidad: "HABITACION", entidadId: habitacion.id, valorNuevo: habitacion },
        ctx.ahora,
      );
    });
  } catch (error) {
    if (esViolacionUnica(error)) throw numeroRepetido();
    throw error;
  }
  return habitacion;
}

/** Edición de número, descripción y precio de lista (CU-13, RF-37). El cambio de precio queda auditado. */
export async function editarHabitacionServicio(ctx: ContextoServicio, id: string, entrada: HabitacionEntrada): Promise<Habitacion> {
  try {
    return await ctx.prisma.$transaction(async (tx) => {
      const fila = await tx.habitacion.findUnique({ where: { id } });
      if (fila === null) throw noEncontrado("La habitación");
      const previa = aHabitacion(fila);
      const habitacion = editarHabitacion(previa, entrada);
      // Solo los datos editables: si el estado cambió entretanto, se respeta.
      await tx.habitacion.update({ where: { id }, data: entrada });
      await auditar(
        tx,
        { usuarioId: ctx.usuario.id, accion: "HABITACION_EDITADA", tipoEntidad: "HABITACION", entidadId: id, valorPrevio: previa, valorNuevo: habitacion },
        ctx.ahora,
      );
      return aHabitacion(await tx.habitacion.findUniqueOrThrow({ where: { id } }));
    });
  } catch (error) {
    if (esViolacionUnica(error)) throw numeroRepetido();
    throw error;
  }
}

/**
 * Aplica una transición de estado del dominio. La actualización exige que el estado siga siendo el leído:
 * si otra solicitud lo cambió entretanto (por ejemplo, dos personas de limpieza marcan la misma habitación),
 * la segunda recibe INVALID_STATE_TRANSITION y no cambia nada.
 */
async function transicionar(
  ctx: ContextoServicio,
  id: string,
  transicion: (habitacion: Habitacion) => Habitacion,
  motivo: string | null,
): Promise<Habitacion> {
  return ctx.prisma.$transaction(async (tx) => {
    const fila = await tx.habitacion.findUnique({ where: { id } });
    if (fila === null) throw noEncontrado("La habitación");
    const previa = aHabitacion(fila);
    const habitacion = transicion(previa);
    const { count } = await tx.habitacion.updateMany({
      where: { id, estado: previa.estado },
      data: { estado: habitacion.estado },
    });
    if (count === 0) throw new ErrorNegocio("INVALID_STATE_TRANSITION");
    await auditar(
      tx,
      {
        usuarioId: ctx.usuario.id,
        accion: "HABITACION_ESTADO_CAMBIADO",
        tipoEntidad: "HABITACION",
        entidadId: id,
        valorPrevio: { estado: previa.estado },
        valorNuevo: { estado: habitacion.estado satisfies EstadoHabitacion },
        motivo,
      },
      ctx.ahora,
    );
    return habitacion;
  });
}

/** CU-16, RN-30: PENDIENTE_LIMPIEZA → LIBRE, sin confirmación del cajero. */
export function marcarListaServicio(ctx: ContextoServicio, id: string): Promise<Habitacion> {
  return transicionar(ctx, id, marcarHabitacionLista, null);
}

/** CU-17, RN-31: PENDIENTE_LIMPIEZA → MANTENIMIENTO. El motivo es recomendado (RF-41). */
export function reportarMantenimientoServicio(ctx: ContextoServicio, id: string, motivo: string | null): Promise<Habitacion> {
  return transicionar(ctx, id, reportarMantenimiento, motivo);
}

/** CU-14, RF-38: LIBRE → MANTENIMIENTO con motivo obligatorio. Sin alquiler abierto, porque debe estar LIBRE. */
export function bloquearHabitacionServicio(ctx: ContextoServicio, id: string, motivo: string): Promise<Habitacion> {
  return transicionar(ctx, id, (h) => bloquearPorMantenimiento(h, motivo), motivo.trim());
}

/** CU-14, RF-39: MANTENIMIENTO → LIBRE. */
export function reactivarHabitacionServicio(ctx: ContextoServicio, id: string): Promise<Habitacion> {
  return transicionar(ctx, id, reactivarHabitacion, null);
}
