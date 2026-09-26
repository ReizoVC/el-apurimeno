import { ErrorClave, generarClaves, publicaDePrivada } from "../respaldo/cifrado.js";
import { preguntar } from "./entrada.js";

// Claves de la copia externa (decisión 23). Nada se escribe en disco: la privada se muestra una sola vez.
//   pnpm clave-respaldo           genera un par nuevo
//   pnpm clave-respaldo publica   pide la privada y muestra su pública (para configurar otro equipo)

if (process.argv[2] === "publica") {
  const privada = process.env["RESPALDO_CLAVE_PRIVADA"] || (await preguntar("Clave privada de respaldo (no se muestra): ", true));
  try {
    console.log(`\nRESPALDO_CLAVE_PUBLICA="${publicaDePrivada(privada)}"`);
  } catch (error) {
    if (!(error instanceof ErrorClave)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
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
