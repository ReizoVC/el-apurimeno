import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rutaDesdeUrl } from "../db.js";
import { tomarCopiaPrevia } from "../respaldo/copia.js";

// Copia de la base antes de una actualización: pnpm copia-previa <etiqueta>. La corre actualizar-produccion.ps1, con el
// servidor funcionando (la copia no lo detiene). Guarda en "antes-de-actualizar", junto a la base.

const DIR_SERVIDOR = fileURLToPath(new URL("../..", import.meta.url));
const url = process.env["DATABASE_URL"] ?? "file:./datos/apurimeno.db";
const rutaBase = resolve(DIR_SERVIDOR, rutaDesdeUrl(url));

console.log(await tomarCopiaPrevia(rutaBase, join(dirname(rutaBase), "antes-de-actualizar"), process.argv[2] ?? "manual", new Date()));
