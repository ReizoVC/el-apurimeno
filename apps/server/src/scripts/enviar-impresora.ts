import { readFileSync } from "node:fs";
import { MENSAJE_FALLA_IMPRESORA } from "@apurimeno/contracts";
import { causaDeError } from "../impresion/estado.js";
import { conReintentos, leerDestinoImpresora, transporteDesdeDestino } from "../impresion/transporte.js";

// Envía un archivo de bytes ESC/POS a la impresora de IMPRESORA_DISPOSITIVO (apps/server/.env), con la misma
// revisión de estado y los mismos reintentos que los comprobantes. Para la prueba con la impresora conectada:
//   pnpm enviar-impresora prueba.bin
//   pnpm enviar-impresora --estado           solo lee el estado, no imprime nada

const soloEstado = process.argv.includes("--estado");
const archivo = process.argv.slice(2).find((a) => a !== "--estado");
if (!soloEstado && archivo === undefined) {
  console.error("Uso: pnpm enviar-impresora <archivo.bin> | --estado");
  process.exit(1);
}
const destino = leerDestinoImpresora(process.env["IMPRESORA_DISPOSITIVO"]);
if (destino === null) {
  console.error("IMPRESORA_DISPOSITIVO está vacío en apps/server/.env (pnpm buscar-impresora sugiere el valor).");
  process.exit(1);
}
const transporte = transporteDesdeDestino(destino);
try {
  if (soloEstado) await transporte.comprobar();
  else {
    const bytes = readFileSync(archivo ?? "");
    await conReintentos(
      () => transporte.enviar(bytes),
      undefined,
      undefined,
      (err, espera) => console.error(`Sin conexión (${err instanceof Error ? err.message : String(err)}); nuevo intento en ${espera / 1000} s…`),
    );
  }
  console.log(soloEstado ? `${transporte.descripcion}: lista para imprimir.` : `Enviado a ${transporte.descripcion}.`);
} catch (err) {
  console.error(`${transporte.descripcion}: ${MENSAJE_FALLA_IMPRESORA[causaDeError(err)]}`);
  console.error(`Detalle: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
