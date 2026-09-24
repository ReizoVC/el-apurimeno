import { z } from "zod";
import {
  CentimosConSignoSchema,
  CentimosSchema,
  FechaISOSchema,
  IdSchema,
  TextoRequeridoSchema,
} from "./comun.js";
import { EstadoTurnoSchema, TipoMovimientoCajaSchema } from "./estados.js";
import { milisegundos, problema } from "./interno.js";

/**
 * Periodo de caja de un cajero (§18.1). Ningún cobro sin turno abierto (RN-32).
 * Arqueo ciego (RN-34): `efectivoEsperado` es null mientras el turno está abierto.
 */
export const TurnoSchema = z
  .object({
    id: IdSchema,
    usuarioId: IdSchema,
    estado: EstadoTurnoSchema,
    abiertoEn: FechaISOSchema,
    efectivoInicial: CentimosSchema,
    cerradoEn: FechaISOSchema.nullable(),
    /** El propio cajero, o un Administrador si fue cierre forzado (RF-43). */
    cerradoPorId: IdSchema.nullable(),
    cierreForzado: z.boolean(),
    efectivoContado: CentimosSchema.nullable(),
    /** Inicial + cobros en métodos que afectan caja + ingresos manuales − retiros manuales (RN-33, RN-35). */
    efectivoEsperado: CentimosConSignoSchema.nullable(),
    /** efectivoContado − efectivoEsperado. Negativo = faltante. */
    diferencia: CentimosConSignoSchema.nullable(),
    /** Obligatorio si el cajero cierra con diferencia distinta de cero (PEND-05, README decisión 15). */
    comentarioCierre: TextoRequeridoSchema.nullable(),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.estado === "ABIERTO") {
      const campos = ["cerradoEn", "cerradoPorId", "efectivoContado", "efectivoEsperado", "diferencia", "comentarioCierre"] as const;
      for (const campo of campos) {
        if (t[campo] !== null) problema(ctx, [campo], `Un turno abierto no tiene ${campo}.`);
      }
      if (t.cierreForzado) problema(ctx, ["cierreForzado"], "Un turno abierto no puede estar forzado.");
      return;
    }

    if (t.cerradoEn === null) problema(ctx, ["cerradoEn"], "Un turno cerrado requiere cerradoEn.");
    if (t.cerradoPorId === null) problema(ctx, ["cerradoPorId"], "Un turno cerrado requiere cerradoPorId.");
    if (t.efectivoEsperado === null) {
      problema(ctx, ["efectivoEsperado"], "Un turno cerrado requiere efectivoEsperado.");
    }
    const apertura = milisegundos(t.abiertoEn);
    const cierre = t.cerradoEn === null ? null : milisegundos(t.cerradoEn);
    if (apertura !== null && cierre !== null && cierre < apertura) {
      problema(ctx, ["cerradoEn"], "El cierre no puede ser anterior a la apertura.");
    }

    if (t.cierreForzado) {
      if (t.cerradoPorId !== null && t.cerradoPorId === t.usuarioId) {
        problema(ctx, ["cerradoPorId"], "Un cierre forzado lo hace otro usuario (CU-20).");
      }
    } else {
      if (t.cerradoPorId !== null && t.cerradoPorId !== t.usuarioId) {
        problema(ctx, ["cerradoPorId"], "Un cierre normal lo hace el propio cajero.");
      }
      if (t.efectivoContado === null) {
        problema(ctx, ["efectivoContado"], "El arqueo requiere el efectivo contado (RF-28).");
      }
      if (t.diferencia !== null && t.diferencia !== 0 && t.comentarioCierre === null) {
        problema(ctx, ["comentarioCierre"], "Un cierre con diferencia exige comentario (REASON_REQUIRED).");
      }
    }

    if (t.efectivoContado === null) {
      if (t.diferencia !== null) problema(ctx, ["diferencia"], "Sin efectivo contado no hay diferencia.");
    } else if (t.efectivoEsperado !== null && t.diferencia !== t.efectivoContado - t.efectivoEsperado) {
      problema(ctx, ["diferencia"], "diferencia debe ser efectivoContado - efectivoEsperado.");
    }
  });
export type Turno = z.infer<typeof TurnoSchema>;

/** Ingreso o retiro manual de efectivo, fuera de las ventas (§18.1, RF-42). */
export const MovimientoCajaSchema = z
  .object({
    id: IdSchema,
    turnoId: IdSchema,
    tipo: TipoMovimientoCajaSchema,
    monto: CentimosSchema.positive(),
    motivo: TextoRequeridoSchema,
    creadoPorId: IdSchema,
    creadoEn: FechaISOSchema,
  })
  .strict();
export type MovimientoCaja = z.infer<typeof MovimientoCajaSchema>;
