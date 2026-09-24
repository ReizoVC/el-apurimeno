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

/** Instante en UTC, ISO-8601 con sufijo "Z" (ej. "2026-09-23T19:00:00.000Z"). La hora de Lima se calcula al mostrar. */
export const FechaISOSchema = z.string().datetime();
export type FechaISO = z.infer<typeof FechaISOSchema>;

/** Texto obligatorio: se recortan espacios y no puede quedar vacío (motivos: RN-12, RN-17, RF-29, RF-42). */
export const TextoRequeridoSchema = z.string().trim().min(1);
