import {
  HabitacionSchema,
  TRANSICIONES_HABITACION,
  esTransicionValida,
  type Centimos,
  type EstadoHabitacion,
  type Habitacion,
} from "@apurimeno/contracts";
import { ErrorNegocio } from "./errores.js";
import { asegurarCentimos, motivoRequerido } from "./interno.js";
import type { Contexto } from "./tickets.js";

function transicionar(
  habitacion: Habitacion,
  desde: EstadoHabitacion,
  hacia: EstadoHabitacion,
): Habitacion {
  if (habitacion.estado !== desde || !esTransicionValida(TRANSICIONES_HABITACION, desde, hacia)) {
    throw new ErrorNegocio("INVALID_STATE_TRANSITION");
  }
  return { ...habitacion, estado: hacia };
}

export interface DatosHabitacion {
  numero: string;
  descripcion: string | null;
  precioBase: Centimos;
}

/** Alta de habitación (RF-36): queda LIBRE, disponible en el tablero de inmediato. El número único lo garantiza la base. */
export function crearHabitacion(datos: DatosHabitacion, ctx: Contexto): Habitacion {
  asegurarCentimos(datos.precioBase, "precioBase");
  return HabitacionSchema.parse({ id: ctx.generarId(), ...datos, estado: "LIBRE" });
}

/**
 * Edición de número, descripción y precio de lista (RF-37). El estado no se edita aquí: solo cambia con sus
 * transiciones. Los alquileres ya iniciados conservan su propia copia del precio (RN-44).
 */
export function editarHabitacion(habitacion: Habitacion, datos: DatosHabitacion): Habitacion {
  asegurarCentimos(datos.precioBase, "precioBase");
  return HabitacionSchema.parse({ ...habitacion, ...datos });
}

/**
 * Ocupa una habitación al confirmar un ingreso (RN-27, RN-28, RF-05). Solo desde LIBRE.
 * Que no haya dos alquileres abiertos a la vez en la misma habitación lo garantiza además la base de datos,
 * porque dos cajeros pueden intentarlo al mismo tiempo (RF-58).
 */
export function ocuparHabitacion(habitacion: Habitacion): Habitacion {
  if (habitacion.estado !== "LIBRE") throw new ErrorNegocio("ROOM_NOT_AVAILABLE");
  return { ...habitacion, estado: "OCUPADA" };
}

/** Al registrar la salida, la habitación pasa a limpieza (RN-29). */
export function liberarPorSalida(habitacion: Habitacion): Habitacion {
  return transicionar(habitacion, "OCUPADA", "PENDIENTE_LIMPIEZA");
}

/** Limpieza la marca como lista, sin confirmación del cajero (RN-30, CU-16). */
export function marcarHabitacionLista(habitacion: Habitacion): Habitacion {
  return transicionar(habitacion, "PENDIENTE_LIMPIEZA", "LIBRE");
}

/** Limpieza reporta un daño en vez de marcarla lista (RN-31, CU-17). */
export function reportarMantenimiento(habitacion: Habitacion): Habitacion {
  return transicionar(habitacion, "PENDIENTE_LIMPIEZA", "MANTENIMIENTO");
}

/** Bloqueo administrativo de una habitación libre, con motivo (RN-31, RF-38). */
export function bloquearPorMantenimiento(habitacion: Habitacion, motivo: string): Habitacion {
  motivoRequerido(motivo);
  return transicionar(habitacion, "LIBRE", "MANTENIMIENTO");
}

/** Reactivación explícita por un usuario autorizado (RN-31, RF-39). */
export function reactivarHabitacion(habitacion: Habitacion): Habitacion {
  return transicionar(habitacion, "MANTENIMIENTO", "LIBRE");
}

/** Al anular el ingreso de un alquiler abierto, la habitación vuelve a estar libre (RF-30, escenario 31.5). */
export function liberarPorAnulacion(habitacion: Habitacion): Habitacion {
  return transicionar(habitacion, "OCUPADA", "LIBRE");
}
