import { crc32, deflateSync, inflateSync } from "node:zlib";

// Imágenes de un bit para la impresora térmica (el logotipo del comprobante). Solo lo necesario, sin
// dependencias: leer un PNG sin entrelazado y reducirlo a negro o blanco, y escribir un PNG para la vista previa.

/**
 * Imagen de un bit por punto, en el orden de ESC/POS (`GS v 0`): filas de arriba abajo, cada fila en
 * `ceil(ancho / 8)` bytes, el bit más alto a la izquierda, 1 = negro (punto impreso).
 */
export interface ImagenMonocromo {
  ancho: number;
  alto: number;
  bytesPorFila: number;
  datos: Uint8Array;
}

export function imagenVacia(ancho: number, alto: number): ImagenMonocromo {
  const bytesPorFila = Math.ceil(ancho / 8);
  return { ancho, alto, bytesPorFila, datos: new Uint8Array(bytesPorFila * alto) };
}

export function esNegro(imagen: ImagenMonocromo, x: number, y: number): boolean {
  const byte = imagen.datos[y * imagen.bytesPorFila + (x >> 3)] ?? 0;
  return (byte & (0x80 >> (x & 7))) !== 0;
}

export function pintarNegro(imagen: ImagenMonocromo, x: number, y: number): void {
  const i = y * imagen.bytesPorFila + (x >> 3);
  imagen.datos[i] = (imagen.datos[i] ?? 0) | (0x80 >> (x & 7));
}

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Muestras por píxel de cada tipo de color del PNG: gris, RGB, paleta, gris + alfa, RGBA. */
const CANALES: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Lee un PNG y lo reduce a un bit por punto: negro si la luminancia es menor que la mitad y el punto no es
 * transparente. Un logotipo ya preparado en blanco y negro puro pasa sin cambios. Rechaza lo que no soporta
 * (entrelazado, 16 bits por muestra) en vez de imprimir algo distinto.
 */
export function leerPngMonocromo(png: Uint8Array): ImagenMonocromo {
  const b = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (b.length < 8 || FIRMA_PNG.some((v, i) => b[i] !== v)) throw new Error("No es un archivo PNG.");
  let ancho = 0;
  let alto = 0;
  let bits = 0;
  let tipoColor = -1;
  let paleta: Buffer | null = null;
  let transparenciaPaleta: Buffer | null = null;
  const comprimido: Buffer[] = [];
  for (let p = 8; p + 8 <= b.length; ) {
    const largo = b.readUInt32BE(p);
    const tipo = b.toString("latin1", p + 4, p + 8);
    const contenido = b.subarray(p + 8, p + 8 + largo);
    if (tipo === "IHDR") {
      ancho = contenido.readUInt32BE(0);
      alto = contenido.readUInt32BE(4);
      bits = contenido[8] ?? 0;
      tipoColor = contenido[9] ?? -1;
      if (contenido[12] !== 0) throw new Error("El PNG está entrelazado; guárdelo sin entrelazado.");
    } else if (tipo === "PLTE") paleta = contenido;
    else if (tipo === "tRNS") transparenciaPaleta = contenido;
    else if (tipo === "IDAT") comprimido.push(contenido);
    else if (tipo === "IEND") break;
    p += 12 + largo;
  }
  const canales = CANALES[tipoColor];
  if (ancho === 0 || alto === 0 || canales === undefined) throw new Error("PNG sin cabecera válida.");
  if (bits === 16 || (canales > 1 && bits !== 8) || (tipoColor === 3 && paleta === null)) {
    throw new Error(`PNG no soportado (tipo de color ${tipoColor}, ${bits} bits por muestra).`);
  }

  const bitsPorPixel = canales * bits;
  const bytesPorPixel = Math.max(1, bitsPorPixel >> 3);
  const bytesPorFilaPng = Math.ceil((ancho * bitsPorPixel) / 8);
  const crudo = inflateSync(Buffer.concat(comprimido));
  if (crudo.length < alto * (bytesPorFilaPng + 1)) throw new Error("PNG incompleto.");
  const imagen = imagenVacia(ancho, alto);
  let anterior = new Uint8Array(bytesPorFilaPng);
  for (let y = 0; y < alto; y++) {
    const inicio = y * (bytesPorFilaPng + 1);
    const fila = desfiltrar(crudo[inicio] ?? 0, crudo.subarray(inicio + 1, inicio + 1 + bytesPorFilaPng), anterior, bytesPorPixel);
    for (let x = 0; x < ancho; x++) {
      if (esPixelNegro(fila, x, tipoColor, bits, paleta, transparenciaPaleta)) pintarNegro(imagen, x, y);
    }
    anterior = fila;
  }
  return imagen;
}

/** Deshace el filtro de una fila (PNG §9): ninguno, Sub, Up, Average o Paeth. */
function desfiltrar(filtro: number, fila: Uint8Array, anterior: Uint8Array, bpp: number): Uint8Array {
  const salida = new Uint8Array(fila.length);
  for (let i = 0; i < fila.length; i++) {
    const a = i >= bpp ? (salida[i - bpp] ?? 0) : 0;
    const arriba = anterior[i] ?? 0;
    const c = i >= bpp ? (anterior[i - bpp] ?? 0) : 0;
    let prediccion = 0;
    if (filtro === 1) prediccion = a;
    else if (filtro === 2) prediccion = arriba;
    else if (filtro === 3) prediccion = (a + arriba) >> 1;
    else if (filtro === 4) {
      const p = a + arriba - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - arriba);
      const pc = Math.abs(p - c);
      prediccion = pa <= pb && pa <= pc ? a : pb <= pc ? arriba : c;
    } else if (filtro !== 0) throw new Error(`Filtro PNG desconocido: ${filtro}.`);
    salida[i] = ((fila[i] ?? 0) + prediccion) & 0xff;
  }
  return salida;
}

function esPixelNegro(
  fila: Uint8Array,
  x: number,
  tipoColor: number,
  bits: number,
  paleta: Buffer | null,
  transparencia: Buffer | null,
): boolean {
  const muestra = (indice: number) => fila[indice] ?? 0;
  let gris: number;
  let alfa = 255;
  if (tipoColor === 0 || tipoColor === 3) {
    // Gris o paleta, con 1, 2, 4 u 8 bits por píxel.
    const valor = bits === 8 ? muestra(x) : (muestra((x * bits) >> 3) >> (8 - bits - ((x * bits) & 7))) & ((1 << bits) - 1);
    if (tipoColor === 0) gris = Math.round((valor * 255) / ((1 << bits) - 1));
    else {
      const p = paleta ?? Buffer.alloc(0);
      gris = luminancia(p[valor * 3] ?? 0, p[valor * 3 + 1] ?? 0, p[valor * 3 + 2] ?? 0);
      alfa = transparencia?.[valor] ?? 255;
    }
  } else if (tipoColor === 4) {
    gris = muestra(x * 2);
    alfa = muestra(x * 2 + 1);
  } else {
    const n = tipoColor === 6 ? 4 : 3;
    gris = luminancia(muestra(x * n), muestra(x * n + 1), muestra(x * n + 2));
    if (tipoColor === 6) alfa = muestra(x * n + 3);
  }
  return alfa >= 128 && gris < 128;
}

const luminancia = (r: number, g: number, b: number) => Math.round(0.299 * r + 0.587 * g + 0.114 * b);

/** PNG en escala de grises (8 bits) de una imagen de un bit: la vista previa de lo que imprimiría la impresora. */
export function escribirPng(imagen: ImagenMonocromo, escala = 1): Buffer {
  const ancho = imagen.ancho * escala;
  const alto = imagen.alto * escala;
  const crudo = Buffer.alloc(alto * (ancho + 1), 0xff);
  for (let y = 0; y < alto; y++) {
    crudo[y * (ancho + 1)] = 0;
    for (let x = 0; x < ancho; x++) {
      if (esNegro(imagen, Math.floor(x / escala), Math.floor(y / escala))) crudo[y * (ancho + 1) + 1 + x] = 0;
    }
  }
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(ancho, 0);
  cabecera.writeUInt32BE(alto, 4);
  cabecera[8] = 8; // bits por muestra; tipo de color 0 (gris), sin entrelazado
  return Buffer.concat([Buffer.from(FIRMA_PNG), bloque("IHDR", cabecera), bloque("IDAT", deflateSync(crudo)), bloque("IEND", Buffer.alloc(0))]);
}

function bloque(tipo: string, contenido: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(contenido.length);
  const tipoYContenido = Buffer.concat([Buffer.from(tipo, "latin1"), contenido]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tipoYContenido));
  return Buffer.concat([largo, tipoYContenido, crc]);
}
