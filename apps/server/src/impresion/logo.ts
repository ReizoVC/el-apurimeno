import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PUNTOS_POR_LINEA } from "./escpos.js";
import { leerPngMonocromo, type ImagenMonocromo } from "./imagen.js";

/**
 * Logotipo del comprobante: blanco y negro puro, 224 × 195 puntos (28 × 24 mm a 203 ppp). Los archivos que usa el
 * servidor en tiempo de ejecución, sin ser código, van en `apps/server/recursos/` (ver README, "Recursos").
 */
export const LOGO_POR_DEFECTO = fileURLToPath(new URL("../../recursos/logo_apurimeno_bw_224x195.png", import.meta.url));

/**
 * Logotipo según `IMPRESORA_LOGO`: vacío, el del negocio; "no", sin logotipo; otra cosa, la ruta de otro PNG.
 * Rechaza un archivo que falta, no se puede leer o no cabe en el papel; index.ts arranca igual, sin logotipo.
 */
export function cargarLogo(valor: string | undefined): ImagenMonocromo | null {
  const v = (valor ?? "").trim();
  if (v.toLowerCase() === "no") return null;
  const ruta = v === "" ? LOGO_POR_DEFECTO : v;
  const logo = leerPngMonocromo(readFileSync(ruta));
  if (logo.ancho > PUNTOS_POR_LINEA[80]) {
    throw new Error(`IMPRESORA_LOGO: ${ruta} mide ${logo.ancho} puntos de ancho; en papel de 80 mm caben ${PUNTOS_POR_LINEA[80]}.`);
  }
  return logo;
}
