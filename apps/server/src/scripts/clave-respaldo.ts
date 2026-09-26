import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ErrorClave, generarClaves, publicaDePrivada } from "../respaldo/cifrado.js";
import { preguntar } from "./entrada.js";

// Claves de la copia externa (decisión 23). La privada nunca queda en el repositorio ni junto a las copias.
//   pnpm clave-respaldo                          genera un par y muestra la privada una sola vez
//   pnpm clave-respaldo --privada-en <archivo>   genera un par, escribe la privada en ese archivo (nuevo) y muestra
//                                                solo la pública: la privada no pasa por la pantalla
//   pnpm clave-respaldo publica                  pide la privada y muestra su pública (para configurar otro equipo)

const argumentos = process.argv.slice(2);
const indicePrivada = argumentos.indexOf("--privada-en");

if (argumentos[0] === "publica") {
  const privada = process.env["RESPALDO_CLAVE_PRIVADA"] || (await preguntar("Clave privada de respaldo (no se muestra): ", true));
  try {
    console.log(`\nRESPALDO_CLAVE_PUBLICA="${publicaDePrivada(privada)}"`);
  } catch (error) {
    if (!(error instanceof ErrorClave)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (indicePrivada !== -1) {
  const destino = argumentos[indicePrivada + 1];
  if (destino === undefined || destino.startsWith("--")) {
    console.error("Falta el archivo: pnpm clave-respaldo --privada-en <archivo>");
    process.exit(1);
  }
  const ruta = resolve(destino);
  const { privada, publica } = generarClaves();
  try {
    // "wx": nunca reemplaza una clave anterior (perderla deja sin poder abrir las copias hechas con ella).
    writeFileSync(ruta, `${privada}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    const codigo = error instanceof Error && "code" in error ? String(error.code) : "";
    console.error(codigo === "EEXIST" ? `Ya existe ${ruta}: no se reemplaza. Elija otro archivo.` : `No se pudo escribir ${ruta}: ${codigo}`);
    process.exit(1);
  }
  console.log(`Clave privada escrita en ${ruta} (no se muestra). Pásela al gestor de contraseñas y borre el archivo.

Línea para apps/server/.env:

RESPALDO_CLAVE_PUBLICA="${publica}"`);
} else {
  const { privada, publica } = generarClaves();
  console.log(`
CLAVE PRIVADA (guárdela ahora en el gestor de contraseñas; no se vuelve a mostrar ni queda en ningún archivo):

  ${privada}

Sin ella no se puede restaurar ninguna copia externa. No la guarde en este equipo ni en la carpeta de las copias.

Línea para apps/server/.env (la pública solo cifra; no sirve para abrir las copias):

RESPALDO_CLAVE_PUBLICA="${publica}"
`);
}
