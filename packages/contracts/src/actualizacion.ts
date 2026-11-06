import { z } from "zod";
import { FechaISOSchema, TextoRequeridoSchema } from "./comun.js";
import { problema } from "./interno.js";

// Aviso de versiones nuevas (decisión 30). Cada versión publicada lleva un manifiesto firmado con una clave que solo
// tiene quien publica; el servidor del local tiene la pública y no ofrece lo que no venga firmado.

export const VersionSistemaSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "Debe ser como 1.2.3.");

/** Largo máximo de la nota: es lo que lee el personal en el aviso. */
export const LARGO_MAXIMO_NOTAS_VERSION = 500;

/** Archivos de cada publicación de GitHub. */
export const ARCHIVO_MANIFIESTO_VERSION = "manifiesto-version.json";
export const ARCHIVO_FIRMA_VERSION = "manifiesto-version.json.firma";

/**
 * Lo que se firma al publicar. Sin `.strict()` a propósito: un servidor todavía sin actualizar tiene que poder leer el
 * manifiesto de una versión que agregue campos, o no se podría actualizar nunca.
 */
export const ManifiestoVersionSchema = z.object({
  version: VersionSistemaSchema,
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  instaladorPos: z.object({
    nombre: TextoRequeridoSchema,
    sha256: z.string().regex(/^[0-9A-F]{64}$/),
  }),
  notas: TextoRequeridoSchema.max(LARGO_MAXIMO_NOTAS_VERSION),
  /** Última versión que exigió detener los servicios: acierta aunque el local se salte versiones. */
  ultimaCompleta: VersionSistemaSchema,
  publicadaEn: FechaISOSchema,
});
export type ManifiestoVersion = z.infer<typeof ManifiestoVersionSchema>;

export const VersionDisponibleSchema = z
  .object({
    version: VersionSistemaSchema,
    notas: TextoRequeridoSchema,
    /** true: varios minutos sin cobros, toda la actualización. false: cerca de 1 minuto, al final. */
    completa: z.boolean(),
    publicadaEn: FechaISOSchema,
  })
  .strict();
export type VersionDisponible = z.infer<typeof VersionDisponibleSchema>;

export const EstadoRevisionVersionSchema = z.enum([
  /** Sin clave pública, o instancia de capacitación: no se revisa nada. */
  "SIN_CONFIGURAR",
  "AL_DIA",
  "DISPONIBLE",
  /** Lo último publicado no pasó la verificación: no se ofrece. */
  "FIRMA_INVALIDA",
]);
export type EstadoRevisionVersion = z.infer<typeof EstadoRevisionVersionSchema>;

/** `GET /actualizacion`. Sin internet, conserva el resultado de la última revisión. */
export const EstadoActualizacionSchema = z
  .object({
    estado: EstadoRevisionVersionSchema,
    instalada: VersionSistemaSchema.nullable(),
    disponible: VersionDisponibleSchema.nullable(),
    ultimaRevisionEn: FechaISOSchema.nullable(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if ((e.estado === "DISPONIBLE") !== (e.disponible !== null)) {
      problema(ctx, ["disponible"], "Solo el estado DISPONIBLE trae una versión.");
    }
  });
export type EstadoActualizacion = z.infer<typeof EstadoActualizacionSchema>;
