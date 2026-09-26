import { z } from "zod";
import { TextoRequeridoSchema } from "./comun.js";
import { ParametrosTiempoPrecioSchema } from "./alquileres.js";
import { problema } from "./interno.js";

/** Términos y formatos propios de comprobantes fiscales que el comprobante no puede usar (RN-39, RF-52). */
export const PATRONES_FISCALES_PROHIBIDOS: readonly RegExp[] = [
  /\bboletas?\b/i,
  /\bfacturas?\b/i,
  /\b[BFE][A-Z0-9]{3}-\d{1,8}\b/,
];

export const TipoConexionImpresoraSchema = z.enum(["USB", "BLUETOOTH"]);
export type TipoConexionImpresora = z.infer<typeof TipoConexionImpresoraSchema>;
export const TipoConexionImpresora = TipoConexionImpresoraSchema.enum;

/** Leyenda que el sistema pone al instalarse y que las bases anteriores reciben al migrar (RN-39). */
export const LEYENDA_COMPROBANTE_POR_DEFECTO = "Documento interno sin valor tributario.";

/** Datos visibles del comprobante (RF-52). */
export const DatosComprobanteSchema = z
  .object({
    nombreNegocio: TextoRequeridoSchema,
    /** Dirección del local, un mensaje breve, etc. */
    datosAdicionales: TextoRequeridoSchema.nullable(),
    /**
     * Leyenda al pie de todo comprobante, obligatoria por RN-39: declara que no es un documento tributario.
     * Es editable para reformularla si cambia la situación tributaria del negocio (decisión 21), pero no puede
     * quedar vacía ni usar términos o series de comprobantes fiscales.
     */
    leyenda: TextoRequeridoSchema,
  })
  .strict()
  .superRefine((d, ctx) => {
    for (const campo of ["nombreNegocio", "datosAdicionales", "leyenda"] as const) {
      const texto = d[campo];
      if (texto !== null && PATRONES_FISCALES_PROHIBIDOS.some((patron) => patron.test(texto))) {
        problema(ctx, [campo], "El comprobante no puede usar terminología ni series de comprobantes fiscales (RN-39).");
      }
    }
  });
export type DatosComprobante = z.infer<typeof DatosComprobanteSchema>;

/** Impresora térmica ESC/POS conectada por USB o Bluetooth, nunca por red (§28.2, PEND-07). */
export const ConfiguracionImpresoraSchema = z
  .object({
    anchoPapelMm: z.union([z.literal(58), z.literal(80)]),
    conexion: TipoConexionImpresoraSchema,
  })
  .strict();
export type ConfiguracionImpresora = z.infer<typeof ConfiguracionImpresoraSchema>;

/** Parámetros que el Administrador ajusta sin intervención técnica (§26, RN-43). */
export const ConfiguracionGlobalSchema = z
  .object({
    parametrosAlquiler: ParametrosTiempoPrecioSchema,
    comprobante: DatosComprobanteSchema,
    impresora: ConfiguracionImpresoraSchema,
    /** Autoriza vender por encima del stock (RN-26). */
    permitirStockNegativo: z.boolean(),
    /** Vigencia breve de un código de autorización (RF-65). */
    minutosVigenciaCodigoAutorizacion: z.number().int().positive(),
  })
  .strict();
export type ConfiguracionGlobal = z.infer<typeof ConfiguracionGlobalSchema>;
