import { decodificarTexto, NUMERO_PAGINA_CODIGOS, PUNTOS_POR_LINEA, type PaginaCodigos } from "./escpos.js";
import { escribirPng, type ImagenMonocromo } from "./imagen.js";

// Vista previa de lo que imprimiría la impresora: interpreta los bytes ESC/POS que genera escpos.ts (los de la
// salida a archivo) y los dibuja en una página HTML. Sirve para revisar el comprobante y el logotipo sin la
// impresora; no reemplaza la prueba en papel (densidad, corte, página de códigos real).

export type Renglon =
  | { tipo: "texto"; texto: string; negrita: boolean; dobleAlto: boolean }
  | { tipo: "imagen"; imagen: ImagenMonocromo; centrada: boolean }
  | { tipo: "avance"; puntos: number }
  | { tipo: "corte" };

const PAGINA_POR_NUMERO = new Map(Object.entries(NUMERO_PAGINA_CODIGOS).map(([pagina, n]) => [n, pagina as PaginaCodigos]));

/** Interpreta los comandos que usa escpos.ts. Cualquier otro comando detiene la lectura: la vista no adivina. */
export function interpretarEscPos(bytes: Uint8Array): Renglon[] {
  const renglones: Renglon[] = [];
  let pagina: PaginaCodigos = "PC850";
  let negrita = false;
  let dobleAlto = false;
  let centrado = false;
  // El estilo de una línea es el que tenía su texto: escpos.ts apaga la negrita antes del salto de línea.
  let texto: number[] = [];
  let lineaNegrita = false;
  let lineaDoble = false;
  const b = (i: number) => {
    const v = bytes[i];
    if (v === undefined) throw new Error(`Comando incompleto al final de los datos (byte ${i}).`);
    return v;
  };
  for (let i = 0; i < bytes.length; ) {
    const c = b(i);
    if (c === 0x0a) {
      renglones.push({ tipo: "texto", texto: decodificarTexto(texto, pagina), negrita: lineaNegrita, dobleAlto: lineaDoble });
      [texto, lineaNegrita, lineaDoble] = [[], false, false];
      i += 1;
    } else if (c === 0x1b) {
      const comando = b(i + 1);
      if (comando === 0x40) {
        [pagina, negrita, dobleAlto, centrado] = ["PC850", false, false, false];
        i += 2;
      } else if (comando === 0x74) {
        pagina = PAGINA_POR_NUMERO.get(b(i + 2)) ?? pagina;
        i += 3;
      } else if (comando === 0x4d) i += 3; // fuente: la vista usa siempre la A
      else if (comando === 0x61) {
        centrado = b(i + 2) === 1;
        i += 3;
      } else if (comando === 0x45) {
        negrita = b(i + 2) === 1;
        i += 3;
      } else if (comando === 0x64) {
        for (let n = 0; n < b(i + 2); n++) renglones.push({ tipo: "texto", texto: "", negrita: false, dobleAlto: false });
        i += 3;
      } else if (comando === 0x4a) {
        renglones.push({ tipo: "avance", puntos: b(i + 2) });
        i += 3;
      } else throw new Error(`Comando ESC 0x${comando.toString(16)} desconocido en el byte ${i}.`);
    } else if (c === 0x1d) {
      const comando = b(i + 1);
      if (comando === 0x21) {
        dobleAlto = (b(i + 2) & 0x01) !== 0;
        i += 3;
      } else if (comando === 0x56) {
        renglones.push({ tipo: "corte" });
        i += 3;
      } else if (comando === 0x76 && b(i + 2) === 0x30) {
        const bytesPorFila = b(i + 4) + b(i + 5) * 256;
        const alto = b(i + 6) + b(i + 7) * 256;
        const inicio = i + 8;
        if (inicio + bytesPorFila * alto > bytes.length) throw new Error("Imagen GS v 0 incompleta.");
        const datos = bytes.slice(inicio, inicio + bytesPorFila * alto);
        renglones.push({ tipo: "imagen", imagen: { ancho: bytesPorFila * 8, alto, bytesPorFila, datos }, centrada: centrado });
        i = inicio + bytesPorFila * alto;
      } else throw new Error(`Comando GS 0x${comando.toString(16)} desconocido en el byte ${i}.`);
    } else {
      texto.push(c);
      lineaNegrita ||= negrita;
      lineaDoble ||= dobleAlto;
      i += 1;
    }
  }
  return renglones;
}

const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Página HTML con el papel a escala real en pantalla (1 punto de la impresora = 1 píxel CSS, 576 en 80 mm): la fuente A
 * mide 12 × 24 puntos, así que 48 columnas ocupan el ancho útil exacto.
 */
export function vistaHtml(renglones: readonly Renglon[], titulo: string, anchoPapelMm: 58 | 80 = 80): string {
  const ancho = PUNTOS_POR_LINEA[anchoPapelMm];
  const partes = renglones.map((r) => {
    switch (r.tipo) {
      case "texto": {
        const clases = [r.negrita ? "negrita" : "", r.dobleAlto ? "doble" : ""].filter(Boolean).join(" ");
        return `<div class="linea ${clases}">${escapar(r.texto) || "&nbsp;"}</div>`;
      }
      case "imagen": {
        const png = escribirPng(r.imagen).toString("base64");
        return `<div class="imagen" style="text-align:${r.centrada ? "center" : "left"}"><img alt="imagen de ${r.imagen.ancho}×${r.imagen.alto} puntos" width="${r.imagen.ancho}" height="${r.imagen.alto}" src="data:image/png;base64,${png}"></div>`;
      }
      case "avance":
        return `<div style="height:${r.puntos}px"></div>`;
      case "corte":
        return `<div class="corte">✂ corte</div>`;
    }
  });
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapar(titulo)}</title>
<style>
  body { background: #d9d6cf; margin: 0; padding: 24px 16px; font-family: system-ui, sans-serif; }
  .nota { max-width: ${ancho + 48}px; margin: 0 auto 12px; font-size: 13px; color: #333; }
  .papel { width: ${ancho}px; margin: 0 auto; padding: 24px; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
  .linea { font: 20px/24px "Consolas", "Courier New", monospace; white-space: pre; height: 24px; overflow: visible; }
  .linea { letter-spacing: calc(12px - 0.55em); }
  .negrita { font-weight: 700; }
  .doble { transform: scaleY(2); transform-origin: top; height: 48px; }
  .imagen img { image-rendering: pixelated; display: inline-block; vertical-align: top; }
  .imagen { line-height: 0; }
  .corte { border-top: 2px dashed #999; color: #999; font-size: 12px; margin: 8px -24px; padding: 2px 8px; }
</style>
</head>
<body>
<p class="nota">${escapar(titulo)} · vista previa a escala (1 punto = 1 px, ${ancho} puntos de ancho útil en ${anchoPapelMm} mm). La prueba en papel sigue pendiente.</p>
<div class="papel">
${partes.join("\n")}
</div>
</body>
</html>
`;
}
