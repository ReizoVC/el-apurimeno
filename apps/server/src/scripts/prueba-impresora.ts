import { writeFileSync } from "node:fs";
import { COMANDO, NUMERO_PAGINA_CODIGOS, codificarTexto, type PaginaCodigos } from "../impresion/escpos.js";

// Página de prueba para la impresora real (parte 2 de ADR-05): imprime la misma línea con tildes y "ñ" en
// cada página de códigos, para ver cuál sale bien en la REDPOS RED-E803. No habla con la impresora:
// escribe los bytes en un archivo (o en la salida estándar) para enviarlos a mano, p. ej.
//   pnpm exec tsx src/scripts/prueba-impresora.ts prueba.bin
//   Linux:   cat prueba.bin > /dev/usb/lp0
//   Windows: copy /b prueba.bin \\localhost\<nombre-compartido-de-la-impresora>

const MUESTRA = "áéíóú ÁÉÍÓÚ ñÑ üÜ ¿¡ °";
const LF = 0x0a;

function linea(texto: string, pagina: PaginaCodigos): number[] {
  return [...codificarTexto(texto, pagina), LF];
}

const bytes: number[] = [...COMANDO.inicializar];
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
