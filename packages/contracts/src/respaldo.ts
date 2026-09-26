import { z } from "zod";
import { FechaISOSchema } from "./comun.js";

// Respaldos de la base del local (Planos §14.3, RNF-BKP-01, RNF-REC-02). Dos copias completas y restaurables,
// distintas del espejo en la nube (que solo tiene totales):
// - local: cada 15 minutos, en el disco del propio equipo; se guardan las de las últimas 24 horas;
// - externa: una diaria a las 04:00 de Lima, comprimida y cifrada, en una carpeta que la propietaria sincroniza
//   con la nube (Google Drive, OneDrive); se guardan las de los últimos 30 días.
// Frecuencias, destino, retención, hora y cifrado los decidió la propietaria (decisión 23 del README).

export const INTERVALO_RESPALDO_LOCAL_MINUTOS = 15;
export const RETENCION_RESPALDO_LOCAL_HORAS = 24;
/** Hora de Lima de la copia externa diaria (04:00). */
export const HORA_RESPALDO_EXTERNO_LIMA = 4;
export const RETENCION_RESPALDO_EXTERNO_DIAS = 30;
/**
 * La copia externa se marca "Desactualizada" si pasó más de este margen desde las 04:00 sin una copia de ese
 * día: da tiempo a la vuelta de recuperación cuando el servidor se enciende después de esa hora.
 */
export const MARGEN_RESPALDO_EXTERNO_MINUTOS = 60;

export const DestinoRespaldoSchema = z.enum(["LOCAL", "EXTERNO"]);
export type DestinoRespaldo = z.infer<typeof DestinoRespaldoSchema>;

/** Por qué falló la última copia. */
export const CodigoErrorRespaldoSchema = z.enum([
  /** La carpeta no existe, no se puede escribir o el disco se desconectó. */
  "DESTINO_INACCESIBLE",
  /** No queda espacio en el disco de destino. */
  "SIN_ESPACIO",
  /** La copia recién hecha no pasó la verificación de integridad: no se guardó. */
  "COPIA_INVALIDA",
  "ERROR_INTERNO",
]);
export type CodigoErrorRespaldo = z.infer<typeof CodigoErrorRespaldoSchema>;

/** Estado de uno de los dos respaldos, visto desde el Dashboard. */
export const EstadoCopiaRespaldoSchema = z
  .object({
    /** false si falta configurarlo: la copia externa necesita carpeta y clave pública. */
    configurado: z.boolean(),
    /** Qué está mal configurado; null si todo está bien o si no se configuró nada. */
    problemaConfiguracion: z.string().nullable(),
    /** Carpeta de destino, tal como la ve el servidor. */
    carpeta: z.string().nullable(),
    copiando: z.boolean(),
    /** Hora de la copia más reciente que hay en la carpeta. */
    ultimoExitoEn: FechaISOSchema.nullable(),
    ultimoArchivo: z.string().nullable(),
    ultimoTamanoBytes: z.number().int().nonnegative().nullable(),
    /** Cuántas copias hay guardadas en la carpeta. */
    copiasGuardadas: z.number().int().nonnegative(),
    ultimoIntentoEn: FechaISOSchema.nullable(),
    /** Error del último intento; null si el último salió bien. */
    ultimoError: z
      .object({ codigo: CodigoErrorRespaldoSchema, mensaje: z.string(), ocurridoEn: FechaISOSchema })
      .strict()
      .nullable(),
    /** Próxima copia automática; null si no está configurado. */
    proximaEn: FechaISOSchema.nullable(),
  })
  .strict();
export type EstadoCopiaRespaldo = z.infer<typeof EstadoCopiaRespaldoSchema>;

export const EstadoRespaldosSchema = z
  .object({ local: EstadoCopiaRespaldoSchema, externo: EstadoCopiaRespaldoSchema })
  .strict();
export type EstadoRespaldos = z.infer<typeof EstadoRespaldosSchema>;

/** "Copiar ahora" desde el Dashboard, p. ej. antes de actualizar el sistema (RNF-DEPL-02). */
export const RespaldarEntradaSchema = z.object({ destino: DestinoRespaldoSchema }).strict();
export type RespaldarEntrada = z.infer<typeof RespaldarEntradaSchema>;

/** Resultado de una copia pedida a mano: si falló, el estado del destino dice por qué. */
export const RespaldoRespuestaSchema = z
  .object({ exito: z.boolean(), estado: EstadoRespaldosSchema })
  .strict();
export type RespaldoRespuesta = z.infer<typeof RespaldoRespuestaSchema>;
