import type { LineaComprobante } from "@apurimeno/domain";

// Comandos ESC/POS del comprobante para la REDPOS RED-E803 (80 mm, ESC/POS; Planos ADR-05). Funciones puras:
// reciben las líneas que compone el dominio y devuelven los bytes exactos a enviar. El envío (USB o
// Bluetooth), la cola y los reintentos van en otra capa, que se prueba con la impresora real.

/**
 * Página de códigos para tildes y "ñ" (Planos §13: no asumir UTF-8). PC850 es la opción por defecto: cubre
 * todo el español, incluidas las mayúsculas con tilde, que PC437 no tiene. WPC1252 queda como alternativa si
 * la impresora no responde bien a PC850. Cuál usar se confirma con la hoja de autoprueba de la impresora.
 */
export type PaginaCodigos = "PC850" | "WPC1252";

/** Número de `ESC t n` para cada página, según la tabla estándar de ESC/POS (Epson). */
export const NUMERO_PAGINA_CODIGOS: Readonly<Record<PaginaCodigos, number>> = { PC850: 2, WPC1252: 16 };

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const COMANDO = {
  /** ESC @: reinicia la impresora (estilos y página de códigos por defecto). */
  inicializar: [ESC, 0x40],
  /** ESC t n: selecciona la página de códigos. */
  paginaCodigos: (n: number) => [ESC, 0x74, n],
  /** ESC E n: negrita encendida o apagada. */
  negrita: (encendida: boolean) => [ESC, 0x45, encendida ? 1 : 0],
  /** GS ! n: tamaño de carácter. 0x01 = doble alto con ancho normal; 0x00 = normal. */
  tamano: (dobleAlto: boolean) => [GS, 0x21, dobleAlto ? 0x01 : 0x00],
  /** ESC d n: avanza n líneas. Antes del corte, para que el texto pase la cuchilla. */
  avanzarLineas: (n: number) => [ESC, 0x64, n],
  /** GS V 1: corte parcial (deja una pestaña, el papel no cae). */
  cortarParcial: [GS, 0x56, 0x01],
} as const;

/** Letras del español y signos habituales, fuera de ASCII, en cada página de códigos. */
// prettier-ignore
const TABLAS: Readonly<Record<PaginaCodigos, ReadonlyMap<string, number>>> = {
  PC850: new Map([
    ["á", 0xa0], ["é", 0x82], ["í", 0xa1], ["ó", 0xa2], ["ú", 0xa3],
    ["Á", 0xb5], ["É", 0x90], ["Í", 0xd6], ["Ó", 0xe0], ["Ú", 0xe9],
    ["ñ", 0xa4], ["Ñ", 0xa5], ["ü", 0x81], ["Ü", 0x9a],
    ["¿", 0xa8], ["¡", 0xad], ["°", 0xf8], ["º", 0xa7], ["ª", 0xa6],
  ]),
  WPC1252: new Map([
    ["á", 0xe1], ["é", 0xe9], ["í", 0xed], ["ó", 0xf3], ["ú", 0xfa],
    ["Á", 0xc1], ["É", 0xc9], ["Í", 0xcd], ["Ó", 0xd3], ["Ú", 0xda],
    ["ñ", 0xf1], ["Ñ", 0xd1], ["ü", 0xfc], ["Ü", 0xdc],
    ["¿", 0xbf], ["¡", 0xa1], ["°", 0xb0], ["º", 0xba], ["ª", 0xaa], ["€", 0x80],
  ]),
};

/**
 * Signos tipográficos sin equivalente en la página: se imprimen como su versión ASCII. "…" y "€" (en PC850)
 * ocupan más columnas que el original, así que una línea que ya llenaba el ancho puede pasar a la siguiente.
 */
// prettier-ignore
const SUSTITUTOS: ReadonlyMap<string, string> = new Map([
  ["—", "-"], ["–", "-"], ["‐", "-"],
  ["“", '"'], ["”", '"'], ["«", '"'], ["»", '"'],
  ["‘", "'"], ["’", "'"],
  ["…", "..."],
  ["€", "EUR"],
  [" ", " "],
]);

/**
 * Convierte texto a bytes de la página de códigos. ASCII imprimible pasa tal cual; las letras del español
 * usan su código en la página; los signos tipográficos se sustituyen; una letra con otro acento (p. ej. "ç")
 * pierde el acento; y cualquier otro carácter sale como "?". Los caracteres de control se descartan: un
 * nombre de producto nunca puede colar un comando a la impresora.
 */
export function codificarTexto(texto: string, pagina: PaginaCodigos): number[] {
  const tabla = TABLAS[pagina];
  const bytes: number[] = [];
  for (const caracter of texto) {
    const codigo = caracter.codePointAt(0) ?? 0;
    if (codigo >= 0x20 && codigo <= 0x7e) {
      bytes.push(codigo);
      continue;
    }
    const enTabla = tabla.get(caracter);
    if (enTabla !== undefined) {
      bytes.push(enTabla);
      continue;
    }
    const sustituto = SUSTITUTOS.get(caracter);
    if (sustituto !== undefined) {
      bytes.push(...codificarTexto(sustituto, pagina));
      continue;
    }
    if (codigo < 0x20 || (codigo >= 0x7f && codigo <= 0x9f)) continue;
    const sinAcento = caracter.normalize("NFD").replace(/[̀-ͯ]/g, "");
    bytes.push(/^[\x20-\x7e]$/.test(sinAcento) ? sinAcento.charCodeAt(0) : 0x3f);
  }
  return bytes;
}

export interface OpcionesEscPos {
  paginaCodigos: PaginaCodigos;
  /** Líneas en blanco antes del corte, para que el final del comprobante pase la cuchilla. */
  lineasAntesDelCorte: number;
}

export const OPCIONES_ESCPOS_POR_DEFECTO: OpcionesEscPos = { paginaCodigos: "PC850", lineasAntesDelCorte: 4 };

/**
 * Bytes completos de un comprobante: inicializa, elige la página de códigos, imprime cada línea con su estilo
 * (y vuelve al normal después), avanza y corta. Cada línea ya viene al ancho del papel desde el dominio.
 */
export function comandosComprobante(
  lineas: readonly LineaComprobante[],
  opciones: OpcionesEscPos = OPCIONES_ESCPOS_POR_DEFECTO,
): Uint8Array {
  const bytes: number[] = [...COMANDO.inicializar, ...COMANDO.paginaCodigos(NUMERO_PAGINA_CODIGOS[opciones.paginaCodigos])];
  for (const { texto, estilo } of lineas) {
    if (estilo !== "normal") bytes.push(...COMANDO.negrita(true));
    if (estilo === "grande") bytes.push(...COMANDO.tamano(true));
    bytes.push(...codificarTexto(texto, opciones.paginaCodigos));
    if (estilo === "grande") bytes.push(...COMANDO.tamano(false));
    if (estilo !== "normal") bytes.push(...COMANDO.negrita(false));
    bytes.push(LF);
  }
  bytes.push(...COMANDO.avanzarLineas(opciones.lineasAntesDelCorte), ...COMANDO.cortarParcial);
  return Uint8Array.from(bytes);
}
