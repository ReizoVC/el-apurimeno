import { z } from "zod";

/** Identificador opaco de una entidad; lo genera el backend. */
export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;

/** Dinero en céntimos de sol, entero y no negativo (RN-37). S/ 30.00 = 3000. */
export const CentimosSchema = z.number().int().nonnegative();
export type Centimos = z.infer<typeof CentimosSchema>;

/** Céntimos con signo: importes de tickets compensatorios (RF-29) y diferencias de arqueo (RF-28). */
export const CentimosConSignoSchema = z.number().int();
export type CentimosConSigno = z.infer<typeof CentimosConSignoSchema>;

/**
 * Cantidad de producto en milésimas de su unidad, entera (decisión 31): 3 unidades = 3000, 2,5 m = 2500,
 * 250 g = 250. Las líneas de ticket del hospedaje también la usan: una habitación o una hora = 1000.
 */
export const MilesimasSchema = z.number().int();
export type Milesimas = z.infer<typeof MilesimasSchema>;
export const MILESIMAS_POR_UNIDAD = 1000;

/**
 * Importe de una línea: cantidad en milésimas × precio por unidad, redondeado al céntimo más cercano, con las
 * mitades hacia afuera del cero. Así el importe de un compensatorio (precio con signo opuesto) es exactamente el
 * opuesto del original. Con cantidades enteras de unidades no redondea nada.
 */
export function importeDeLinea(cantidad: Milesimas, precioUnitario: number): number {
  const bruto = cantidad * precioUnitario;
  const absoluto = Math.abs(bruto);
  const redondeado = Math.floor(absoluto / MILESIMAS_POR_UNIDAD) + (absoluto % MILESIMAS_POR_UNIDAD >= MILESIMAS_POR_UNIDAD / 2 ? 1 : 0);
  return bruto < 0 ? -redondeado : redondeado;
}

/** Instante en UTC, ISO-8601 con sufijo "Z" (ej. "2026-09-23T19:00:00.000Z"). La hora de Lima se calcula al mostrar. */
export const FechaISOSchema = z.string().datetime();
export type FechaISO = z.infer<typeof FechaISOSchema>;

/** Texto obligatorio: se recortan espacios y no puede quedar vacío (motivos: RN-12, RN-17, RF-29, RF-42). */
export const TextoRequeridoSchema = z.string().trim().min(1);
