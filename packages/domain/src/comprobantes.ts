import type { ConfiguracionImpresora, DatosComprobante, MetodoPago, Ticket } from "@apurimeno/contracts";
import { ms } from "./interno.js";
import { ZONA_HORARIA_NEGOCIO } from "./reportes.js";

// Contenido del comprobante impreso (§13, RN-38, RN-39, RF-44, RF-55): texto plano en líneas del ancho del
// papel. Convertirlo a comandos ESC/POS y enviarlo a la impresora es trabajo del servidor (ADR-05).

/** Declaración obligatoria de todo comprobante, sea cual sea la configuración (RN-39). */
export const LEYENDA_NO_FISCAL = "Documento interno sin valor tributario.";

/** Columnas de texto por ancho de papel: 48 en 80 mm (la REDPOS RED-E803), 32 en 58 mm. */
export function columnasPorAncho(anchoPapelMm: ConfiguracionImpresora["anchoPapelMm"]): number {
  return anchoPapelMm === 80 ? 48 : 32;
}

const formatoFecha = new Intl.DateTimeFormat("es-PE", {
  timeZone: ZONA_HORARIA_NEGOCIO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function soles(centimos: number): string {
  const signo = centimos < 0 ? "-" : "";
  return `${signo}S/ ${(Math.abs(centimos) / 100).toFixed(2)}`;
}

/**
 * Parte un texto en líneas de `ancho` columnas, por palabras; corta una palabra que no quepa sola.
 * La sangría inicial del texto se conserva en la primera línea.
 */
function envolver(texto: string, ancho: number): string[] {
  const lineas: string[] = [];
  let actual = /^\s*/.exec(texto)?.[0] ?? "";
  for (const palabra of texto.split(/\s+/).filter((p) => p !== "")) {
    let resto = palabra;
    while (resto.length > ancho) {
      if (actual.trim() !== "") lineas.push(actual);
      lineas.push(resto.slice(0, ancho));
      resto = resto.slice(ancho);
      actual = "";
    }
    if (actual.trim() === "") actual += resto;
    else if (actual.length + 1 + resto.length <= ancho) actual = `${actual} ${resto}`;
    else {
      lineas.push(actual);
      actual = resto;
    }
  }
  if (actual.trim() !== "") lineas.push(actual);
  return lineas;
}

function centrar(texto: string, ancho: number): string[] {
  return envolver(texto, ancho).map((l) => " ".repeat(Math.floor((ancho - l.length) / 2)) + l);
}

/** Texto a la izquierda y monto a la derecha; si no caben juntos, el monto va en la línea siguiente. */
function fila(izquierda: string, derecha: string, ancho: number): string[] {
  const partes = envolver(izquierda, ancho);
  const ultima = partes.pop() ?? "";
  if (ultima.length + 1 + derecha.length <= ancho) {
    return [...partes, ultima + " ".repeat(ancho - ultima.length - derecha.length) + derecha];
  }
  return [...partes, ultima, derecha.padStart(ancho)];
}

export interface OpcionesComprobante {
  datos: DatosComprobante;
  anchoPapelMm: ConfiguracionImpresora["anchoPapelMm"];
  metodosPago: readonly MetodoPago[];
  /** Reimpresión: el comprobante lo dice de forma visible (RF-44). */
  esCopia: boolean;
}

/**
 * Compone el comprobante de un ticket. Solo usa datos del ticket y de la configuración: nunca el nombre ni
 * el documento del cliente (RN-38). Siempre declara que no es un documento tributario, y no usa series ni
 * términos de comprobantes fiscales (RN-39): el número es el correlativo interno, sin serie.
 */
export function componerComprobante(ticket: Ticket, opciones: OpcionesComprobante): string[] {
  const ancho = columnasPorAncho(opciones.anchoPapelMm);
  const separador = "-".repeat(ancho);
  const nombreMetodo = new Map(opciones.metodosPago.map((m) => [m.id, m.nombre]));

  const lineas: string[] = [...centrar(opciones.datos.nombreNegocio, ancho)];
  if (opciones.datos.datosAdicionales !== null) lineas.push(...centrar(opciones.datos.datosAdicionales, ancho));
  lineas.push(separador);
  if (opciones.esCopia) lineas.push(...centrar("*** COPIA ***", ancho));
  if (ticket.tipo === "COMPENSATORIO") lineas.push(...centrar("ANULACIÓN DE UN COBRO ANTERIOR", ancho));
  if (ticket.estado === "ANULADO") lineas.push(...centrar("*** ANULADO ***", ancho));
  lineas.push(...fila(`Ticket ${ticket.numero}`, formatoFecha.format(new Date(ms(ticket.creadoEn))), ancho));
  lineas.push(separador);

  for (const linea of ticket.lineas) {
    lineas.push(...fila(linea.descripcion, soles(linea.importe), ancho));
    if (linea.cantidad > 1) lineas.push(`  ${linea.cantidad} x ${soles(linea.precioUnitario)}`);
  }
  lineas.push(separador);
  lineas.push(...fila("TOTAL", soles(ticket.total), ancho));
  for (const pago of ticket.pagos) {
    lineas.push(...fila(nombreMetodo.get(pago.metodoPagoId) ?? "Otro medio", soles(pago.monto), ancho));
    if (pago.montoRecibido !== null) lineas.push(...fila("  Recibido", soles(pago.montoRecibido), ancho));
    if (pago.vuelto !== null && pago.vuelto !== 0) lineas.push(...fila("  Vuelto", soles(pago.vuelto), ancho));
    if (pago.referencia !== null) lineas.push(...envolver(`  Op. ${pago.referencia}`, ancho));
  }
  lineas.push(separador);
  lineas.push(...centrar(LEYENDA_NO_FISCAL, ancho));
  return lineas;
}
