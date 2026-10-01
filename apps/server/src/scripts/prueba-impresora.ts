import { writeFileSync } from "node:fs";
import { COMANDO, NUMERO_PAGINA_CODIGOS, codificarTexto, comandosLogo, type PaginaCodigos } from "../impresion/escpos.js";
import { cargarLogo } from "../impresion/logo.js";

// Página de prueba para la impresora real (parte 2 de ADR-05): la cabecera del comprobante (logotipo centrado y el
// nombre debajo, en fuente A) y la misma línea con tildes y "ñ" en cada página de códigos, para ver cuál sale bien
// en la REDPOS RED-E803. No habla con la impresora: escribe los bytes en un archivo (o en la salida estándar).
//   pnpm prueba-impresora prueba.bin
//   pnpm vista-impresion prueba.bin          vista previa en prueba.bin.html, sin impresora
//   pnpm enviar-impresora prueba.bin         a la impresora de IMPRESORA_DISPOSITIVO (con la impresora conectada)
// En Linux también sirve `cat prueba.bin > /dev/usb/lp0`. IMPRESORA_LOGO elige otro logotipo, o "no" para probar sin él.

const MUESTRA = "áéíóú ÁÉÍÓÚ ñÑ üÜ ¿¡ °";
const LF = 0x0a;

function linea(texto: string, pagina: PaginaCodigos): number[] {
  return [...codificarTexto(texto, pagina), LF];
}

const centrada = (texto: string) => texto.padStart(Math.floor((48 + texto.length) / 2));

const bytes: number[] = [...COMANDO.inicializar, ...COMANDO.paginaCodigos(NUMERO_PAGINA_CODIGOS.PC850), ...COMANDO.fuenteA];
const logo = cargarLogo(process.env["IMPRESORA_LOGO"]);
if (logo !== null) bytes.push(...comandosLogo(logo));
bytes.push(...COMANDO.negrita(true), ...linea(centrada("El Apurimeño"), "PC850"), ...COMANDO.negrita(false));
bytes.push(...linea(centrada(logo === null ? "(sin logotipo)" : `^ logotipo de ${logo.ancho} x ${logo.alto} puntos`), "PC850"), LF);

for (const pagina of Object.keys(NUMERO_PAGINA_CODIGOS) as PaginaCodigos[]) {
  const n = NUMERO_PAGINA_CODIGOS[pagina];
  bytes.push(...COMANDO.paginaCodigos(n));
  bytes.push(...COMANDO.negrita(true), ...linea(`${pagina} (ESC t ${n})`, pagina), ...COMANDO.negrita(false));
  bytes.push(...linea(MUESTRA, pagina), ...linea("Hospedaje El Apurimeño - Habitación 205", pagina), LF);
}
bytes.push(...COMANDO.paginaCodigos(NUMERO_PAGINA_CODIGOS.PC850));
bytes.push(...linea("Tamaño normal", "PC850"));
bytes.push(...COMANDO.negrita(true), ...linea("Negrita", "PC850"), ...COMANDO.negrita(false));
bytes.push(...COMANDO.negrita(true), ...COMANDO.tamano(true), ...linea("*** COPIA ***", "PC850"), ...COMANDO.tamano(false));
bytes.push(...COMANDO.negrita(false));
bytes.push(...linea("123456789012345678901234567890123456789012345678", "PC850"));
bytes.push(...linea("^ 48 columnas: debe caber en una sola línea", "PC850"));
bytes.push(...COMANDO.avanzarLineas(4), ...COMANDO.cortarParcial);

const salida = process.argv[2];
if (salida === undefined) process.stdout.write(Uint8Array.from(bytes));
else {
  writeFileSync(salida, Uint8Array.from(bytes));
  console.error(`Escritos ${bytes.length} bytes en ${salida}`);
}
