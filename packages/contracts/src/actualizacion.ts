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

export const ResultadoInstalacionSchema = z.enum([
  "EN_CURSO",
  "OK",
  "ERROR",
  /** Seguía en curso después del tiempo máximo de la tarea: se apagó el equipo o se cortó. */
  "CORTADA",
]);
export type ResultadoInstalacion = z.infer<typeof ResultadoInstalacionSchema>;

/** Cómo terminó la última instalación, o cómo va. `mensaje` es para el personal: dice qué falló. */
export const UltimaInstalacionSchema = z
  .object({
    resultado: ResultadoInstalacionSchema,
    version: z.string(),
    mensaje: z.string().nullable(),
    actualizadaEn: FechaISOSchema,
  })
  .strict();
export type UltimaInstalacion = z.infer<typeof UltimaInstalacionSchema>;

/** `POST /actualizacion/instalacion`. La versión es la que vio quien pulsó: si ya no es la disponible, se rechaza. */
export const InstalarActualizacionEntradaSchema = z.object({ version: VersionSistemaSchema }).strict();
export type InstalarActualizacionEntrada = z.infer<typeof InstalarActualizacionEntradaSchema>;

/**
 * `GET /actualizacion`. Sin internet, conserva el resultado de la última revisión. Durante una instalación el servidor
 * se reinicia: quien espera tiene que tolerar que no responda.
 */
export const EstadoActualizacionSchema = z
  .object({
    estado: EstadoRevisionVersionSchema,
    instalada: VersionSistemaSchema.nullable(),
    disponible: VersionDisponibleSchema.nullable(),
    ultimaRevisionEn: FechaISOSchema.nullable(),
    ultimaInstalacion: UltimaInstalacionSchema.nullable(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if ((e.estado === "DISPONIBLE") !== (e.disponible !== null)) {
      problema(ctx, ["disponible"], "Solo el estado DISPONIBLE trae una versión.");
    }
  });
export type EstadoActualizacion = z.infer<typeof EstadoActualizacionSchema>;

/**
 * `GET /health`, sin sesión. El POS y Limpieza lo usan para saber si hay una versión nueva, aunque quien esté adentro
 * no tenga `system.update`, y si la página que tienen abierta quedó vieja. Solo lleva números de versión.
 */
export const SaludRespuestaSchema = z
  .object({
    estado: z.literal("ok"),
    versionSistema: VersionSistemaSchema.nullable(),
    versionDisponible: VersionSistemaSchema.nullable(),
  })
  .strict();
export type SaludRespuesta = z.infer<typeof SaludRespuestaSchema>;
