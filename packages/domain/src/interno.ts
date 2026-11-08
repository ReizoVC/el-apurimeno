import { MILESIMAS_POR_UNIDAD, type FechaISO, type Producto } from "@apurimeno/contracts";
import { cantidadConUnidad } from "@apurimeno/formato";
import { ErrorNegocio } from "./errores.js";

export const MS_POR_MINUTO = 60_000;
export const MS_POR_HORA = 60 * MS_POR_MINUTO;

export function ms(fecha: FechaISO): number {
  const valor = Date.parse(fecha);
  if (!Number.isFinite(valor)) throw new RangeError(`Fecha inválida: ${fecha}`);
  return valor;
}

export function iso(milisegundos: number): FechaISO {
  return new Date(milisegundos).toISOString();
}

export function asegurarCentimos(monto: number, campo: string): void {
  if (!Number.isSafeInteger(monto) || monto < 0) {
    throw new RangeError(`${campo} debe ser un entero de céntimos no negativo (RN-37): ${monto}`);
  }
}

export function asegurarEnteroPositivo(valor: number, campo: string): void {
  if (!Number.isSafeInteger(valor) || valor <= 0) {
    throw new RangeError(`${campo} debe ser un entero positivo: ${valor}`);
  }
}

/**
 * Una cantidad de producto en milésimas (decisión 31 de contracts): entera, mayor que cero, y de unidades enteras si
 * el producto se vende por unidad. `permitirCero` para lo contado en un conteo.
 */
export function asegurarCantidadDeProducto(producto: Producto, cantidad: number, permitirCero = false): void {
  if (!Number.isSafeInteger(cantidad) || cantidad < 0 || (cantidad === 0 && !permitirCero)) {
    throw new ErrorNegocio("INVALID_QUANTITY", `Cantidad inválida para ${producto.nombre}.`);
  }
  if (producto.unidad === "UNIDAD" && cantidad % MILESIMAS_POR_UNIDAD !== 0) {
    throw new ErrorNegocio("INVALID_QUANTITY", `${producto.nombre} se vende por unidad: no admite ${cantidadConUnidad(cantidad, producto.unidad)}.`);
  }
}

export function motivoRequerido(motivo: string | null | undefined): string {
  const limpio = motivo?.trim() ?? "";
  if (limpio === "") throw new ErrorNegocio("REASON_REQUIRED");
  return limpio;
}
