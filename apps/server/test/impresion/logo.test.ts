import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { comandosComprobante, OPCIONES_ESCPOS_POR_DEFECTO } from "../../src/impresion/escpos.js";
import { escribirPng, esNegro, imagenVacia, leerPngMonocromo, pintarNegro } from "../../src/impresion/imagen.js";
import { cargarLogo, LOGO_POR_DEFECTO } from "../../src/impresion/logo.js";
import { interpretarEscPos, vistaHtml } from "../../src/impresion/vista.js";

/** PNG armado a mano: cabecera, filas ya filtradas (cada una con su byte de filtro) y bloques extra antes de IDAT. */
function png(ancho: number, alto: number, bits: number, tipoColor: number, filas: number[][], extra: [string, number[]][] = [], entrelazado = 0) {
  const bloque = (tipo: string, datos: Buffer) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, "latin1"), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo));
    return Buffer.concat([largo, cuerpo, crc]);
  };
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(ancho, 0);
  cabecera.writeUInt32BE(alto, 4);
  cabecera[8] = bits;
  cabecera[9] = tipoColor;
  cabecera[12] = entrelazado;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque("IHDR", cabecera),
    ...extra.map(([tipo, datos]) => bloque(tipo, Buffer.from(datos))),
    bloque("IDAT", deflateSync(Buffer.from(filas.flat()))),
    bloque("IEND", Buffer.alloc(0)),
  ]);
}

const puntos = (img: ReturnType<typeof leerPngMonocromo>) =>
  Array.from({ length: img.alto }, (_, y) => Array.from({ length: img.ancho }, (_, x) => (esNegro(img, x, y) ? "#" : ".")).join(""));

describe("El logotipo del negocio (apps/server/recursos)", () => {
  const logo = leerPngMonocromo(readFileSync(LOGO_POR_DEFECTO));

  it("mide 224 × 195 puntos (28 × 24 mm a 203 ppp): 28 bytes por fila", () => {
    expect([logo.ancho, logo.alto, logo.bytesPorFila, logo.datos.length]).toEqual([224, 195, 28, 5460]);
  });

  it("es blanco y negro puro: los 16 962 puntos negros del archivo, ni uno más", () => {
    let negros = 0;
    for (let y = 0; y < logo.alto; y++) for (let x = 0; x < logo.ancho; x++) if (esNegro(logo, x, y)) negros++;
    expect(negros).toBe(16_962);
    // La punta de la montaña, arriba al centro, y las esquinas de arriba en blanco.
    expect([esNegro(logo, 104, 0), esNegro(logo, 105, 0), esNegro(logo, 109, 0), esNegro(logo, 110, 0)]).toEqual([false, true, true, false]);
    expect([esNegro(logo, 0, 0), esNegro(logo, 223, 0)]).toEqual([false, false]);
  });

  it("cabe en el papel de 80 mm (576 puntos) y en el de 58 mm (384)", () => {
    expect(logo.ancho).toBeLessThanOrEqual(384);
  });

  it("IMPRESORA_LOGO: vacío, el del negocio; 'no', ninguno; una ruta, ese PNG; más ancho que el papel, se rechaza", () => {
    expect(cargarLogo(undefined)?.ancho).toBe(224);
    expect(cargarLogo(" NO ")).toBeNull();
    const dir = mkdtempSync(join(tmpdir(), "logo-"));
    const angosto = imagenVacia(16, 2);
    pintarNegro(angosto, 3, 1);
    writeFileSync(join(dir, "otro.png"), escribirPng(angosto));
    expect(puntos(cargarLogo(join(dir, "otro.png")) ?? angosto)).toEqual(["................", "...#............"]);
    writeFileSync(join(dir, "ancho.png"), escribirPng(imagenVacia(600, 1)));
    expect(() => cargarLogo(join(dir, "ancho.png"))).toThrow(/caben 576/);
    expect(() => cargarLogo(join(dir, "no-existe.png"))).toThrow();
  });
});

describe("Lectura de PNG a un bit por punto", () => {
  it("ida y vuelta: el PNG de la vista previa se lee igual que el original", () => {
    const logo = leerPngMonocromo(readFileSync(LOGO_POR_DEFECTO));
    expect(Buffer.from(leerPngMonocromo(escribirPng(logo)).datos).equals(Buffer.from(logo.datos))).toBe(true);
    // A escala 2, cada punto se vuelve un cuadro de 2 × 2.
    const doble = leerPngMonocromo(escribirPng(logo, 2));
    expect([doble.ancho, doble.alto]).toEqual([448, 390]);
    expect([esNegro(doble, 210, 0), esNegro(doble, 211, 1), esNegro(doble, 208, 0)]).toEqual([true, true, false]);
  });

  it("RGBA: lo oscuro es negro, lo claro y lo transparente es blanco; con los filtros Sub, Up, Average y Paeth", () => {
    // Fila 0 sin filtro: negro opaco, blanco opaco, negro transparente, gris oscuro opaco.
    const fila0 = [0, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 60, 60, 60, 255];
    const sub = [1, 0, 0, 0, 255, 255, 255, 255, 0, 0, 1, 1, 0, 61, 60, 60, 0]; // Sub: cada píxel suma el de la izquierda
    const up = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // Up: igual a la fila de arriba
    const img = leerPngMonocromo(png(4, 3, 8, 6, [fila0, sub, up]));
    expect(puntos(img)).toEqual(["#..#", "#.##", "#.##"]);
    const avg = leerPngMonocromo(png(1, 2, 8, 0, [[0, 200], [3, 100]])); // (0 + 200) / 2 + 100 = 200: blanco
    const paeth = leerPngMonocromo(png(1, 2, 8, 0, [[0, 20], [4, 0]])); // predice 20: negro
    expect([puntos(avg), puntos(paeth)]).toEqual([[".", "."], ["#", "#"]]);
  });

  it("paleta de 1 bit con transparencia, y gris de 1 bit", () => {
    const paleta = png(3, 1, 1, 3, [[0, 0b01000000]], [["PLTE", [255, 255, 255, 0, 0, 0]], ["tRNS", [255, 255]]]);
    expect(puntos(leerPngMonocromo(paleta))).toEqual([".#."]);
    const transparente = png(3, 1, 1, 3, [[0, 0b01000000]], [["PLTE", [255, 255, 255, 0, 0, 0]], ["tRNS", [255, 0]]]);
    expect(puntos(leerPngMonocromo(transparente))).toEqual(["..."]);
    expect(puntos(leerPngMonocromo(png(3, 1, 1, 0, [[0, 0b10100000]])))).toEqual([".#."]);
  });

  it("rechaza lo que no soporta en vez de imprimir otra cosa", () => {
    expect(() => leerPngMonocromo(Buffer.from("no es un png"))).toThrow(/No es un archivo PNG/);
    expect(() => leerPngMonocromo(png(1, 1, 8, 0, [[0, 0]], [], 1))).toThrow(/entrelazado/);
    expect(() => leerPngMonocromo(png(1, 1, 16, 0, [[0, 0, 0]]))).toThrow(/no soportado/);
  });
});

describe("Vista previa: lo que imprimiría la impresora, a partir de los bytes", () => {
  const logo = leerPngMonocromo(readFileSync(LOGO_POR_DEFECTO));
  const bytes = comandosComprobante(
    [
      { texto: "                  El Apurimeño", estilo: "negrita" },
      { texto: "*** COPIA ***", estilo: "grande" },
      { texto: "Habitación 205", estilo: "normal" },
    ],
    { ...OPCIONES_ESCPOS_POR_DEFECTO, logo },
  );

  it("el logotipo sale completo y centrado, y el nombre justo debajo, en negrita", () => {
    const [imagen, avance, nombre, copia, linea] = interpretarEscPos(bytes);
    expect(imagen?.tipo === "imagen" && imagen.centrada).toBe(true);
    if (imagen?.tipo !== "imagen") throw new Error("falta la imagen");
    expect([imagen.imagen.ancho, imagen.imagen.alto]).toEqual([224, 195]);
    expect(Buffer.from(imagen.imagen.datos).equals(Buffer.from(logo.datos))).toBe(true);
    expect(avance).toEqual({ tipo: "avance", puntos: 8 });
    expect(nombre).toEqual({ tipo: "texto", texto: "                  El Apurimeño", negrita: true, dobleAlto: false });
    expect(copia).toEqual({ tipo: "texto", texto: "*** COPIA ***", negrita: true, dobleAlto: true });
    expect(linea).toEqual({ tipo: "texto", texto: "Habitación 205", negrita: false, dobleAlto: false });
    expect(interpretarEscPos(bytes).at(-1)).toEqual({ tipo: "corte" });
  });

  it("la página HTML lleva la imagen a escala real (1 punto = 1 px) y el texto", () => {
    const html = vistaHtml(interpretarEscPos(bytes), "prueba");
    expect(html).toContain('width="224" height="195" src="data:image/png;base64,');
    expect(html).toContain("El Apurimeño");
    expect(html).toContain("width: 576px");
  });

  it("un comando que la vista no conoce la detiene, en vez de mostrar algo distinto a lo impreso", () => {
    expect(() => interpretarEscPos(Uint8Array.from([0x1b, 0x70, 0, 25, 250]))).toThrow(/ESC 0x70 desconocido/);
  });
});
