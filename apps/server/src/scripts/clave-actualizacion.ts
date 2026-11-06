import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { estaFueraDelRepositorio, generarClavesVersion } from "../actualizacion/firma.js";

// Claves para firmar las versiones publicadas (decisión 30). Se corre una sola vez, en el equipo de quien publica.
//   pnpm clave-actualizacion --privada-en <archivo>
// La privada se escribe en ese archivo, que debe estar fuera del repositorio, y no pasa por la pantalla.

const argumentos = process.argv.slice(2);
const destino = argumentos[argumentos.indexOf("--privada-en") + 1];
if (!argumentos.includes("--privada-en") || destino === undefined || destino.startsWith("--")) {
  console.error("Falta el archivo: pnpm clave-actualizacion --privada-en <archivo fuera del repositorio>");
  process.exit(1);
}
const ruta = resolve(process.env["INIT_CWD"] ?? process.cwd(), destino);
if (!estaFueraDelRepositorio(ruta)) {
  console.error(`${ruta} está dentro del repositorio: elija un archivo fuera de él.`);
  process.exit(1);
}

const { privada, publica } = generarClavesVersion();
try {
  // "wx": nunca reemplaza una clave anterior, que dejaría a la mini PC rechazando las versiones nuevas.
  writeFileSync(ruta, `${privada}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
} catch (error) {
  const codigo = error instanceof Error && "code" in error ? String(error.code) : "";
  console.error(codigo === "EEXIST" ? `Ya existe ${ruta}: no se reemplaza. Elija otro archivo.` : `No se pudo escribir ${ruta}: ${codigo}`);
  process.exit(1);
}

console.log(`Clave privada escrita en ${ruta} (no se muestra). Guarde una copia en el gestor de contraseñas.

Para publicar, en este equipo:

ACTUALIZACION_CLAVE_PRIVADA_ARCHIVO=${ruta}

Línea para apps/server/.env del PC del local (la pública solo comprueba; no sirve para firmar):

ACTUALIZACION_CLAVE_PUBLICA="${publica}"`);
