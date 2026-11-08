import { ErrorClave } from "../respaldo/cifrado.js";
import { leerClavePublicaVersion, manifiestoVerificado } from "../actualizacion/firma.js";
import { publicacionDeEtiqueta } from "../actualizacion/github.js";

// Comprueba la firma de una versión antes de instalarla: lo corre actualizar-produccion.ps1 (decisión 30).
//   pnpm verificar-version vX.Y.Z
// Corre con el código ya instalado, nunca con el de la versión que se va a instalar. Muestra una línea JSON, solo con lo
// que necesita el actualizador. Cualquier duda, sale con error: el actualizador no sigue.

function fallar(mensaje: string): never {
  console.error(mensaje);
  process.exit(1);
}

const [etiqueta] = process.argv.slice(2);
if (etiqueta === undefined || !/^v\d+\.\d+\.\d+$/.test(etiqueta)) fallar("Falta la versión: pnpm verificar-version vX.Y.Z");
const texto = process.env["ACTUALIZACION_CLAVE_PUBLICA"]?.trim();
if (!texto) fallar("Falta ACTUALIZACION_CLAVE_PUBLICA en apps/server/.env.");

let publica;
try {
  publica = leerClavePublicaVersion(texto);
} catch (error) {
  if (!(error instanceof ErrorClave)) throw error;
  fallar(`ACTUALIZACION_CLAVE_PUBLICA: ${error.message}`);
}

let publicacion;
try {
  publicacion = await publicacionDeEtiqueta(etiqueta);
} catch (error) {
  fallar(`No se pudo descargar el manifiesto de ${etiqueta}: ${error instanceof Error ? error.message : String(error)}`);
}

const manifiesto = manifiestoVerificado(publicacion, publica);
if (manifiesto === null) fallar(`El manifiesto de ${etiqueta} no existe o su firma no es válida.`);
console.log(JSON.stringify({ commit: manifiesto.commit, sha256: manifiesto.instaladorPos.sha256, nombre: manifiesto.instaladorPos.nombre }));
