import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { interpretarEscPos, vistaHtml } from "../impresion/vista.js";

// Vista previa, sin impresora, de un archivo de bytes ESC/POS: el de `pnpm prueba-impresora` o el que deja el
// servidor con IMPRESORA_DISPOSITIVO apuntando a un archivo. Escribe una página HTML para abrir en el navegador.
//   pnpm vista-impresion prueba.bin [salida.html] [--58]

const argumentos = process.argv.slice(2).filter((a) => a !== "--58");
const entrada = argumentos[0];
if (entrada === undefined) {
  console.error("Uso: pnpm vista-impresion <archivo.bin> [salida.html] [--58]");
  process.exit(1);
}
const salida = argumentos[1] ?? `${entrada}.html`;
const renglones = interpretarEscPos(readFileSync(entrada));
writeFileSync(salida, vistaHtml(renglones, basename(entrada), process.argv.includes("--58") ? 58 : 80));
const imagenes = renglones.filter((r) => r.tipo === "imagen");
const cortes = renglones.filter((r) => r.tipo === "corte").length;
console.error(`Vista previa en ${salida}: ${imagenes.length} imagen(es), ${cortes} corte(s).`);
