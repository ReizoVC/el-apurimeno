import { PrecioEspecialClienteSchema, type Centimos, type Id, type PrecioEspecialCliente } from "@apurimeno/contracts";
import { ErrorNegocio } from "./errores.js";
import { asegurarCentimos } from "./interno.js";
import type { Contexto } from "./tickets.js";

export interface DatosPrecioEspecial {
  clienteId: Id;
  habitacionId: Id;
  precio: Centimos;
  creadoPorId: Id;
}

/**
 * Alta de un precio especial (RF-16, RN-14 a RN-16). Uno solo por cliente + habitación: si ya existe,
 * se edita el existente en lugar de crear otro. `existente` es el precio actual de esa combinación, si lo hay;
 * la base de datos lo garantiza además con un índice único, por si dos altas llegan a la vez.
 */
export function crearPrecioEspecial(
  existente: PrecioEspecialCliente | null,
  datos: DatosPrecioEspecial,
  ctx: Contexto,
): PrecioEspecialCliente {
  if (existente !== null) throw new ErrorNegocio("CLIENT_ROOM_PRICE_ALREADY_EXISTS");
  asegurarCentimos(datos.precio, "precio");
  return PrecioEspecialClienteSchema.parse({ id: ctx.generarId(), ...datos, creadoEn: ctx.ahora });
}

/** Edición del monto (RF-18). Autor y fecha de alta se conservan; quién lo editó queda en la auditoría. */
export function editarPrecioEspecial(precioEspecial: PrecioEspecialCliente, precio: Centimos): PrecioEspecialCliente {
  asegurarCentimos(precio, "precio");
  return { ...precioEspecial, precio };
}
