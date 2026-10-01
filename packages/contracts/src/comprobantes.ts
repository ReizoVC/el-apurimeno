import { z } from "zod";
import { FechaISOSchema, IdSchema } from "./comun.js";
import { EstadoTrabajoImpresionSchema } from "./estados.js";

/**
 * Salida impresa de un ticket (§18.1). Una falla de impresión nunca revierte el cobro (RF-56).
 * El contenido lo compone el servidor: sin datos del cliente (RN-38) y declarado como no fiscal (RN-39).
 */
export const TrabajoImpresionSchema = z
  .object({
    id: IdSchema,
    ticketId: IdSchema,
    estado: EstadoTrabajoImpresionSchema,
    /** Reimpresión: el comprobante muestra "COPIA" (RF-44). */
    esCopia: z.boolean(),
    creadoEn: FechaISOSchema,
  })
  .strict();
export type TrabajoImpresion = z.infer<typeof TrabajoImpresionSchema>;

/**
 * Por qué no se pudo imprimir un comprobante (RF-56, RNF-OBS-01). El servidor lo deduce del estado que reporta la
 * impresora (ESC/POS `DLE EOT`) o de la falta de conexión; el POS muestra el mensaje en vez de códigos o luces
 * (§24.1). Decisión 26.
 */
export const CausaFallaImpresoraSchema = z.enum([
  // No se pudo abrir el puerto, la impresora no respondió o el dispositivo no existe.
  "PRINTER_DISCONNECTED",
  // Sensor de fin de papel. En la RED-E803: solo la luz de papel encendida.
  "PRINTER_OUT_OF_PAPER",
  // Tapa abierta o mal cerrada. En la RED-E803: luz de papel y de error parpadeando juntas.
  "PRINTER_COVER_OPEN",
  // Error que se recupera solo (el cabezal se enfrió). En la RED-E803: la misma señal de luces que la tapa.
  "PRINTER_OVERHEATED",
  // Cualquier otro error que reporta la impresora: cuchilla trabada, error irrecuperable, fuera de línea sin causa.
  "PRINTER_ERROR",
]);
export type CausaFallaImpresora = z.infer<typeof CausaFallaImpresoraSchema>;
export const CausaFallaImpresora = CausaFallaImpresoraSchema.enum;

/** Qué le dice el POS al cajero, en su lenguaje (§24.1): qué pasa y qué hacer. */
export const MENSAJE_FALLA_IMPRESORA: Readonly<Record<CausaFallaImpresora, string>> = {
  PRINTER_DISCONNECTED:
    "No hay conexión con la impresora. Revise que esté encendida y con el cable USB conectado (si es por Bluetooth, que esté encendida y cerca del equipo).",
  PRINTER_OUT_OF_PAPER: "La impresora no tiene papel. Coloque un rollo nuevo y cierre bien la tapa.",
  PRINTER_COVER_OPEN: "La tapa de la impresora está abierta o mal cerrada. Ciérrela presionando hasta que haga clic.",
  PRINTER_OVERHEATED: "El cabezal de la impresora está muy caliente. Espere unos minutos: vuelve a imprimir sola al enfriarse.",
  PRINTER_ERROR:
    "La impresora reporta un error. Apáguela, revise que no haya papel atascado en la cuchilla y vuelva a encenderla.",
};

/**
 * Estado de la impresora para el POS (RF-56, RNF-OBS-01). `causa` es la del último intento de impresión: null si
 * salió bien o si todavía no se intentó nada. `comprobantesEnEspera` cuenta los que el servidor todavía reintenta
 * solo (PENDIENTE o ERROR recientes; decisión 26).
 */
export const EstadoImpresoraSchema = z
  .object({
    /** false: el servidor no tiene impresora configurada; los comprobantes quedan en cola sin imprimir. */
    configurada: z.boolean(),
    causa: CausaFallaImpresoraSchema.nullable(),
    comprobantesEnEspera: z.number().int().nonnegative(),
    /** Último intento de impresión, bueno o malo; null si no hubo ninguno desde que arrancó el servidor. */
    ultimoIntento: FechaISOSchema.nullable(),
    /**
     * Error en `IMPRESORA_DISPOSITIVO` al arrancar: el servidor arrancó igual, sin impresora (`configurada` es
     * false) y los comprobantes quedan en cola. null si no hubo error (también si la variable está vacía).
     */
    problemaConfiguracion: z.string().nullable(),
    /** Error en `IMPRESORA_LOGO` al arrancar: los comprobantes salen sin logotipo. null si no hubo error. */
    problemaLogo: z.string().nullable(),
  })
  .strict();
export type EstadoImpresora = z.infer<typeof EstadoImpresoraSchema>;
