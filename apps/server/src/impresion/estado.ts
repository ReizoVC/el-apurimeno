import type { CausaFallaImpresora } from "@apurimeno/contracts";

// Estado que reporta la impresora y su traducción a una causa de falla (RF-56, decisión 26 de contracts). Funciones
// puras: los bytes llegan del transporte (transporte.ts), y el POS muestra el mensaje de la causa.

const DLE = 0x10;
const EOT = 0x04;

/**
 * DLE EOT n: estado en tiempo real (ESC/POS estándar). La impresora lo responde con un byte aunque esté fuera de
 * línea, con la tapa abierta o sin papel. 1: estado general; 2: causa de fuera de línea; 3: causa del error;
 * 4: sensor del rollo de papel.
 */
export const CONSULTAS_ESTADO = [1, 2, 3, 4] as const;
export type ConsultaEstado = (typeof CONSULTAS_ESTADO)[number];
export const comandoConsultaEstado = (n: ConsultaEstado) => [DLE, EOT, n];

/** Los cuatro bytes de respuesta, en el orden de `CONSULTAS_ESTADO`. */
export type RespuestaEstado = readonly [number, number, number, number];

/** Toda respuesta de DLE EOT tiene fijos los bits 0 (0), 1 (1), 4 (1) y 7 (0): 0xx1xx10. */
export const esRespuestaEstadoValida = (byte: number) => (byte & 0x93) === 0x12;

const bit = (byte: number, n: number) => (byte & (1 << n)) !== 0;

/**
 * Causa de falla según los cuatro bytes, o null si la impresora está lista. Solo cuenta lo que impide imprimir;
 * "papel por acabarse" no detiene la impresión. El orden importa: la tapa abierta también marca "fuera de línea",
 * y sin papel la impresora también se detiene.
 */
export function causaSegunEstado([general, fueraDeLinea, error, papel]: RespuestaEstado): CausaFallaImpresora | null {
  if (![general, fueraDeLinea, error, papel].every(esRespuestaEstadoValida)) return "PRINTER_ERROR";
  if (bit(fueraDeLinea, 2)) return "PRINTER_COVER_OPEN";
  // Fin de papel: sensor del rollo (DLE EOT 4, bits 5 y 6) o impresión detenida por falta de papel (DLE EOT 2, bit 5).
  if (bit(papel, 5) || bit(papel, 6) || bit(fueraDeLinea, 5)) return "PRINTER_OUT_OF_PAPER";
  // Error que se recupera solo: en las térmicas, la temperatura del cabezal.
  if (bit(error, 6)) return "PRINTER_OVERHEATED";
  // Cuchilla (bit 3), error irrecuperable (bit 5), cualquier error (DLE EOT 2 bit 6) o fuera de línea sin causa.
  if (bit(error, 3) || bit(error, 5) || bit(fueraDeLinea, 6) || bit(general, 3)) return "PRINTER_ERROR";
  return null;
}

/** Respuesta de una impresora lista, y de cada falla, tal como la mandaría una impresora ESC/POS (pruebas y simulación). */
export const RESPUESTAS_TIPICAS = {
  lista: [0x12, 0x12, 0x12, 0x12],
  sinPapel: [0x1a, 0x32, 0x12, 0x72],
  tapaAbierta: [0x1a, 0x16, 0x12, 0x12],
  sobrecalentada: [0x1a, 0x52, 0x52, 0x12],
  cuchillaTrabada: [0x1a, 0x52, 0x1a, 0x12],
} as const satisfies Record<string, RespuestaEstado>;

/**
 * Estado de una impresora instalada en Windows (cola de impresión), de Win32_Printer: lo que el controlador informe.
 * Menos preciso que DLE EOT: muchos controladores genéricos no informan nada, y entonces se imprime igual.
 */
export interface EstadoColaWindows {
  /** `WorkOffline`: la impresora está marcada "usar sin conexión". */
  sinConexion: boolean;
  /** `PrinterStatus` (7 = fuera de línea). */
  estadoImpresora: number | null;
  /** `DetectedErrorState` (4 sin papel, 7 puerta abierta, 8 atasco, 9 fuera de línea, 10 servicio técnico). */
  errorDetectado: number | null;
}

export function causaSegunColaWindows(estado: EstadoColaWindows): CausaFallaImpresora | null {
  if (estado.sinConexion || estado.estadoImpresora === 7 || estado.errorDetectado === 9) return "PRINTER_DISCONNECTED";
  if (estado.errorDetectado === 4) return "PRINTER_OUT_OF_PAPER";
  if (estado.errorDetectado === 7) return "PRINTER_COVER_OPEN";
  if (estado.errorDetectado === 8 || estado.errorDetectado === 10) return "PRINTER_ERROR";
  return null;
}

/** Falla con su causa: la cola la guarda para el aviso del POS. */
export class FallaImpresora extends Error {
  constructor(
    readonly causa: CausaFallaImpresora,
    detalle: string,
  ) {
    super(detalle);
    this.name = "FallaImpresora";
  }
}

/** Causa de cualquier error del envío: la de FallaImpresora o, si es otro (del sistema, del puerto), sin conexión. */
export const causaDeError = (error: unknown): CausaFallaImpresora =>
  error instanceof FallaImpresora ? error.causa : "PRINTER_DISCONNECTED";
