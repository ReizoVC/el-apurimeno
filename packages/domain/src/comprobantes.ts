import type {
  ConfiguracionImpresora,
  DatosComprobante,
  MetodoPago,
  Ticket,
} from "@apurimeno/contracts";
import { ms } from "./interno.js";
import { fechaHora, soles } from "@apurimeno/formato";

// Contenido del comprobante impreso (§13, RN-38, RN-39, RF-44, RF-55): texto plano en líneas del ancho del
// papel. Convertirlo a comandos ESC/POS y enviarlo a la impresora es trabajo del servidor (ADR-05).

/** Columnas de texto por ancho de papel: 48 en 80 mm (la REDPOS RED-E803), 32 en 58 mm. */
export function columnasPorAncho(
  anchoPapelMm: ConfiguracionImpresora["anchoPapelMm"],
): number {
  return anchoPapelMm === 80 ? 48 : 32;
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
    else if (actual.length + 1 + resto.length <= ancho)
      actual = `${actual} ${resto}`;
    else {
      lineas.push(actual);
      actual = resto;
    }
  }
  if (actual.trim() !== "") lineas.push(actual);
  return lineas;
}

function centrar(texto: string, ancho: number): string[] {
  return envolver(texto, ancho).map(
    (l) => " ".repeat(Math.floor((ancho - l.length) / 2)) + l,
  );
}

/** Texto a la izquierda y monto a la derecha; si no caben juntos, el monto va en la línea siguiente. */
function fila(izquierda: string, derecha: string, ancho: number): string[] {
  const partes = envolver(izquierda, ancho);
  const ultima = partes.pop() ?? "";
  if (ultima.length + 1 + derecha.length <= ancho) {
    return [
      ...partes,
      ultima + " ".repeat(ancho - ultima.length - derecha.length) + derecha,
    ];
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
 * Cómo se destaca una línea al imprimirla: `negrita`, o `grande` (negrita a doble alto, que no cambia el
 * ancho y conserva el centrado). El comprobante en texto plano la ignora.
 */
export type EstiloLineaComprobante = "normal" | "negrita" | "grande";

export interface LineaComprobante {
  texto: string;
  estilo: EstiloLineaComprobante;
}

/**
 * Compone el comprobante de un ticket, línea por línea y con el estilo de cada una. Solo usa datos del ticket y
 * de la configuración: nunca el nombre ni el documento del cliente (RN-38). Siempre termina con la leyenda
 * configurada, que declara que no es un documento tributario, y no usa series ni términos de comprobantes
 * fiscales (RN-39): el número es el correlativo interno, sin serie.
 */
export function componerLineasComprobante(
  ticket: Ticket,
  opciones: OpcionesComprobante,
): LineaComprobante[] {
  const ancho = columnasPorAncho(opciones.anchoPapelMm);
  const separador = "-".repeat(ancho);
  const nombreMetodo = new Map(
    opciones.metodosPago.map((m) => [m.id, m.nombre]),
  );
  const lineas: LineaComprobante[] = [];
  const agregar = (
    textos: string[],
    estilo: EstiloLineaComprobante = "normal",
  ) => {
    for (const texto of textos) lineas.push({ texto, estilo });
  };

  agregar(centrar(opciones.datos.nombreNegocio, ancho), "negrita");
  if (opciones.datos.datosAdicionales !== null)
    agregar(centrar(opciones.datos.datosAdicionales, ancho));
  agregar([separador]);
  if (opciones.esCopia) agregar(centrar("*** COPIA ***", ancho), "grande");
  if (ticket.tipo === "COMPENSATORIO")
    agregar(centrar("ANULACIÓN DE UN COBRO ANTERIOR", ancho), "negrita");
  if (ticket.estado === "ANULADO")
    agregar(centrar("*** ANULADO ***", ancho), "grande");
  agregar(
    fila(
      `Ticket ${ticket.numero}`,
      fechaHora(new Date(ms(ticket.creadoEn))),
      ancho,
    ),
  );
  agregar([separador]);

  for (const linea of ticket.lineas) {
    agregar(fila(linea.descripcion, soles(linea.importe), ancho));
    if (linea.cantidad > 1)
      agregar([`  ${linea.cantidad} x ${soles(linea.precioUnitario)}`]);
  }
  agregar([separador]);
  agregar(fila("TOTAL", soles(ticket.total), ancho), "negrita");
  for (const pago of ticket.pagos) {
    agregar(
      fila(
        nombreMetodo.get(pago.metodoPagoId) ?? "Otro medio",
        soles(pago.monto),
        ancho,
      ),
    );
    if (pago.montoRecibido !== null)
      agregar(fila("  Recibido", soles(pago.montoRecibido), ancho));
    if (pago.vuelto !== null && pago.vuelto !== 0)
      agregar(fila("  Vuelto", soles(pago.vuelto), ancho));
    if (pago.referencia !== null)
      agregar(envolver(`  Op. ${pago.referencia}`, ancho));
  }
  agregar([separador]);
  // Siempre al pie, sea cual sea la configuración: el texto es editable, pero no se puede omitir (RN-39).
  agregar(centrar(opciones.datos.leyenda, ancho));
  return lineas;
}

/** El comprobante como texto plano: lo que devuelve la API para mostrarlo en pantalla. */
export function componerComprobante(
  ticket: Ticket,
  opciones: OpcionesComprobante,
): string[] {
  return componerLineasComprobante(ticket, opciones).map((l) => l.texto);
}
