import { z } from "zod";
import { CentimosConSignoSchema, CentimosSchema, FechaISOSchema, IdSchema, TextoRequeridoSchema } from "./comun.js";
import { OrigenTicketSchema } from "./estados.js";

// Espejo en la nube (ADR-06, RN-45, RF-60, RF-61): un resumen agregado, de solo lectura y con demora, para que la
// propietaria vea el negocio desde fuera del local. Nunca lleva el detalle operativo (RIE-08): ni clientes, ni
// tickets, ni productos, ni auditoría, ni el estado de las habitaciones en vivo.

/** Versión del formato del resumen; sube si cambian sus campos, para que la vista remota sepa leerlo. */
export const VERSION_RESUMEN_ESPEJO = 1;

/** Largo máximo del comentario de cierre que viaja al espejo; el resto se recorta. */
export const LARGO_MAXIMO_COMENTARIO_ESPEJO = 200;

/** Día calendario en la hora de Lima, "AAAA-MM-DD". */
export const DiaCalendarioSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type DiaCalendario = z.infer<typeof DiaCalendarioSchema>;

const EnteroNoNegativo = z.number().int().nonnegative();

/**
 * Resumen de un día de Lima. Las ventas son los cobros vigentes emitidos ese día (mismo criterio que el reporte
 * de ventas, RF-47). La ocupación son los alquileres que ingresaron ese día, no anulados, con todas sus horas e
 * ingresos aunque se cobren al día siguiente (mismo criterio que el reporte de ocupación, RF-48). Anulados son
 * los cobros emitidos ese día que hoy están anulados, sea cuando sea que se anularon.
 */
export const ResumenDiaSchema = z
  .object({
    dia: DiaCalendarioSchema,
    totalVentas: CentimosSchema,
    cantidadCobros: EnteroNoNegativo,
    anuladosCantidad: EnteroNoNegativo,
    anuladosTotal: CentimosSchema,
    alquileres: EnteroNoNegativo,
    horasVendidas: EnteroNoNegativo,
    detalle: z
      .object({
        porOrigen: z.array(z.object({ origen: OrigenTicketSchema, total: CentimosSchema }).strict()),
        /** Con el nombre del método, para que el espejo no necesite la tabla de métodos de pago. */
        porMetodoPago: z.array(
          z.object({ metodoPagoId: IdSchema, nombre: TextoRequeridoSchema, total: CentimosSchema }).strict(),
        ),
        /** Todas las habitaciones, en orden de número, aunque ese día no tuvieran alquileres. */
        ocupacion: z.array(
          z
            .object({
              habitacionId: IdSchema,
              numero: z.string(),
              alquileres: EnteroNoNegativo,
              horasVendidas: EnteroNoNegativo,
              ingresos: CentimosSchema,
            })
            .strict(),
        ),
      })
      .strict(),
    version: z.number().int().positive(),
  })
  .strict();
export type ResumenDia = z.infer<typeof ResumenDiaSchema>;

/**
 * Arqueo de un turno cerrado. Los turnos abiertos no viajan: su esperado no se revela hasta el cierre (RN-34).
 * `ventasTurno` son los cobros vigentes del turno, que puede cruzar la medianoche.
 */
export const ResumenTurnoSchema = z
  .object({
    turnoId: IdSchema,
    /** Día de Lima en que se cerró: agrupa los arqueos por día en la vista remota. */
    diaCierre: DiaCalendarioSchema,
    cajero: TextoRequeridoSchema,
    abiertoEn: FechaISOSchema,
    cerradoEn: FechaISOSchema,
    cierreForzado: z.boolean(),
    efectivoInicial: CentimosSchema,
    efectivoEsperado: CentimosConSignoSchema,
    /** null en un cierre forzado sin conteo. */
    efectivoContado: CentimosSchema.nullable(),
    diferencia: CentimosConSignoSchema.nullable(),
    ventasTurno: CentimosSchema,
    comentario: z.string().max(LARGO_MAXIMO_COMENTARIO_ESPEJO).nullable(),
    version: z.number().int().positive(),
  })
  .strict();
export type ResumenTurno = z.infer<typeof ResumenTurnoSchema>;

// --- Filas del espejo (tablas de supabase/migrations) ---
// Mismos datos con los nombres de columna de Postgres. El servidor escribe con estas funciones y la vista remota
// lee con ellas: nadie escribe los nombres de columna a mano.

export interface FilaResumenDia {
  dia: string;
  total_ventas: number;
  cantidad_cobros: number;
  anulados_cantidad: number;
  anulados_total: number;
  alquileres: number;
  horas_vendidas: number;
  detalle: ResumenDia["detalle"];
  version: number;
  actualizado_en: string;
}

export interface FilaResumenTurno {
  turno_id: string;
  dia_cierre: string;
  cajero: string;
  abierto_en: string;
  cerrado_en: string;
  cierre_forzado: boolean;
  efectivo_inicial: number;
  efectivo_esperado: number;
  efectivo_contado: number | null;
  diferencia: number | null;
  ventas_turno: number;
  comentario: string | null;
  version: number;
  actualizado_en: string;
}

/** Una sola fila: cuándo terminó la última sincronización correcta (CU-28 paso 3). */
export interface FilaEstadoEspejo {
  id: true;
  ultima_sincronizacion: string;
  intervalo_minutos: number;
  version_servidor: string;
}

export function aFilaResumenDia(r: ResumenDia, actualizadoEn: string): FilaResumenDia {
  return {
    dia: r.dia,
    total_ventas: r.totalVentas,
    cantidad_cobros: r.cantidadCobros,
    anulados_cantidad: r.anuladosCantidad,
    anulados_total: r.anuladosTotal,
    alquileres: r.alquileres,
    horas_vendidas: r.horasVendidas,
    detalle: r.detalle,
    version: r.version,
    actualizado_en: actualizadoEn,
  };
}

export function desdeFilaResumenDia(f: FilaResumenDia): ResumenDia {
  return ResumenDiaSchema.parse({
    dia: f.dia,
    totalVentas: f.total_ventas,
    cantidadCobros: f.cantidad_cobros,
    anuladosCantidad: f.anulados_cantidad,
    anuladosTotal: f.anulados_total,
    alquileres: f.alquileres,
    horasVendidas: f.horas_vendidas,
    detalle: f.detalle,
    version: f.version,
  });
}

export function aFilaResumenTurno(r: ResumenTurno, actualizadoEn: string): FilaResumenTurno {
  return {
    turno_id: r.turnoId,
    dia_cierre: r.diaCierre,
    cajero: r.cajero,
    abierto_en: r.abiertoEn,
    cerrado_en: r.cerradoEn,
    cierre_forzado: r.cierreForzado,
    efectivo_inicial: r.efectivoInicial,
    efectivo_esperado: r.efectivoEsperado,
    efectivo_contado: r.efectivoContado,
    diferencia: r.diferencia,
    ventas_turno: r.ventasTurno,
    comentario: r.comentario,
    version: r.version,
    actualizado_en: actualizadoEn,
  };
}

/** Postgres devuelve `timestamptz` con desfase ("+00:00"); el contrato usa ISO con "Z". */
const aIsoZ = (fecha: string) => new Date(fecha).toISOString();

export function desdeFilaResumenTurno(f: FilaResumenTurno): ResumenTurno {
  return ResumenTurnoSchema.parse({
    turnoId: f.turno_id,
    diaCierre: f.dia_cierre,
    cajero: f.cajero,
    abiertoEn: aIsoZ(f.abierto_en),
    cerradoEn: aIsoZ(f.cerrado_en),
    cierreForzado: f.cierre_forzado,
    efectivoInicial: f.efectivo_inicial,
    efectivoEsperado: f.efectivo_esperado,
    efectivoContado: f.efectivo_contado,
    diferencia: f.diferencia,
    ventasTurno: f.ventas_turno,
    comentario: f.comentario,
    version: f.version,
  });
}

// --- Estado de la sincronización, visto desde el Dashboard local ---

/** Por qué falló la última sincronización. */
export const CodigoErrorEspejoSchema = z.enum([
  /** Sin internet, DNS o tiempo de espera agotado: se reintenta solo en la siguiente vuelta. */
  "SIN_CONEXION",
  /** Correo o contraseña de la cuenta de sincronización rechazados por Supabase Auth. */
  "CREDENCIALES_RECHAZADAS",
  /** Supabase respondió con error: faltan las tablas, la cuenta no está en acceso_espejo, etc. */
  "RECHAZADO_POR_EL_ESPEJO",
  "ERROR_INTERNO",
]);
export type CodigoErrorEspejo = z.infer<typeof CodigoErrorEspejoSchema>;

export const EstadoEspejoSchema = z
  .object({
    /** false si faltan las variables de entorno: el servidor funciona igual, sin espejo. */
    configurado: z.boolean(),
    /** Qué falta configurar, si `configurado` es false y alguna variable sí está puesta. */
    problemaConfiguracion: z.string().nullable(),
    intervaloMinutos: z.number().int().positive(),
    sincronizando: z.boolean(),
    ultimoIntentoEn: FechaISOSchema.nullable(),
    /** Fin de la última sincronización correcta: es la hora que ve la propietaria. */
    ultimoExitoEn: FechaISOSchema.nullable(),
    /** Error de la última sincronización; null si la última salió bien. */
    ultimoError: z
      .object({ codigo: CodigoErrorEspejoSchema, mensaje: z.string(), ocurridoEn: FechaISOSchema })
      .strict()
      .nullable(),
    /** Próxima sincronización automática; null si no hay espejo configurado. */
    proximaEn: FechaISOSchema.nullable(),
  })
  .strict();
export type EstadoEspejo = z.infer<typeof EstadoEspejoSchema>;

/**
 * "Sincronizar ahora" desde el Dashboard. `completo` vuelve a publicar todo el historial, no solo lo que cambió:
 * sirve tras restaurar el espejo o si algo quedó desfasado.
 */
export const SincronizarEspejoEntradaSchema = z.object({ completo: z.boolean() }).strict();
export type SincronizarEspejoEntrada = z.infer<typeof SincronizarEspejoEntradaSchema>;

/** Resultado de una sincronización manual: si falló, `estado.ultimoError` dice por qué. */
export const SincronizacionEspejoRespuestaSchema = z
  .object({
    exito: z.boolean(),
    diasPublicados: EnteroNoNegativo,
    turnosPublicados: EnteroNoNegativo,
    estado: EstadoEspejoSchema,
  })
  .strict();
export type SincronizacionEspejoRespuesta = z.infer<typeof SincronizacionEspejoRespuestaSchema>;
