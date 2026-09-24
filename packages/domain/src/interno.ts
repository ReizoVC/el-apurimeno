import type { FechaISO } from "@apurimeno/contracts";
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

export function motivoRequerido(motivo: string | null | undefined): string {
  const limpio = motivo?.trim() ?? "";
  if (limpio === "") throw new ErrorNegocio("REASON_REQUIRED");
  return limpio;
}
