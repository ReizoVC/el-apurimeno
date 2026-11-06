import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ARCHIVO_FIRMA_VERSION, ARCHIVO_MANIFIESTO_VERSION, ManifiestoVersionSchema } from "@apurimeno/contracts";
import { fileURLToPath } from "node:url";
import { estaFueraDelRepositorio, firmaValida, firmarManifiesto, leerClavePrivadaVersion, publicaDePrivadaVersion } from "../actualizacion/firma.js";
import { ultimaVersionCompleta } from "../actualizacion/ultima-completa.js";

// Firma el manifiesto de una versión: lo corre publicar-version.mjs (decisión 30).
//   pnpm firmar-version <borrador.json>
// El borrador trae todo menos la fecha y la última versión completa, que salen de aquí. Deja el manifiesto y su firma
// junto al borrador y muestra las dos rutas.

function fallar(mensaje: string): never {
  console.error(mensaje);
  process.exit(1);
}

const [rutaBorrador] = process.argv.slice(2);
if (rutaBorrador === undefined) fallar("Falta el borrador: pnpm firmar-version <borrador.json>");
const rutaClave = process.env["ACTUALIZACION_CLAVE_PRIVADA_ARCHIVO"]?.trim();
if (!rutaClave) fallar("Falta ACTUALIZACION_CLAVE_PRIVADA_ARCHIVO: el archivo de la clave privada de versiones.");
if (!estaFueraDelRepositorio(rutaClave)) fallar("La clave privada de versiones no puede estar dentro del repositorio.");

const privada = leerClavePrivadaVersion(readFileSync(rutaClave, "utf8"));
const borrador = JSON.parse(readFileSync(rutaBorrador, "utf8")) as { version: string };
const manifiesto = ManifiestoVersionSchema.parse({
  ...borrador,
  ultimaCompleta: ultimaVersionCompleta(fileURLToPath(new URL("../../../../", import.meta.url)), borrador.version),
  publicadaEn: new Date().toISOString(),
});
const bytes = Buffer.from(`${JSON.stringify(manifiesto, null, 2)}\n`, "utf8");
const firma = firmarManifiesto(bytes, privada);
if (!firmaValida(bytes, firma, publicaDePrivadaVersion(privada))) fallar("La firma recién hecha no se pudo comprobar.");

const carpeta = dirname(rutaBorrador);
const rutaManifiesto = join(carpeta, ARCHIVO_MANIFIESTO_VERSION);
const rutaFirma = join(carpeta, ARCHIVO_FIRMA_VERSION);
writeFileSync(rutaManifiesto, bytes);
writeFileSync(rutaFirma, `${firma}\n`, "utf8");
console.log(rutaManifiesto);
console.log(rutaFirma);
