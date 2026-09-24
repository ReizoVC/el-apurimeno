import { z } from "zod";

export const MS_POR_MINUTO = 60_000;
export const MS_POR_HORA = 60 * MS_POR_MINUTO;

export function problema(
  ctx: z.RefinementCtx,
  path: (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

// Las refinaciones también corren cuando un campo tiene errores de formato;
// devolver null evita comparar fechas inválidas y reportar errores falsos.
export function milisegundos(fecha: string): number | null {
  const ms = Date.parse(fecha);
  return Number.isFinite(ms) ? ms : null;
}

export function sonUnicos(valores: readonly string[]): boolean {
  return new Set(valores).size === valores.length;
}
