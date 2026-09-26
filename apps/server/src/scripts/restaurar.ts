import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fechaHora, hace } from "@apurimeno/formato";
import { rutaDesdeUrl } from "../db.js";
import { ErrorClave } from "../respaldo/cifrado.js";
import { leerConfiguracionRespaldos } from "../respaldo/configuracion.js";
import { ErrorRespaldo } from "../respaldo/copia.js";
import { copiasDisponibles, restaurar, type CopiaDisponible } from "../respaldo/restauracion.js";
import { preguntar } from "./entrada.js";

// Restauración completa (RNF-BKP-02). Procedimiento en docs/RESPALDO_Y_RESTAURACION.md.
//   pnpm restaurar                  lista las copias disponibles, locales y externas
//   pnpm restaurar ultima           restaura la más reciente de todas
//   pnpm restaurar <archivo>        restaura ese archivo (.db o .db.gz.cifrado)
// Opciones: --si (no pide confirmación). La clave privada se pide por teclado, o RESPALDO_CLAVE_PRIVADA.

const inicio = Date.now();
const DIR_SERVIDOR = fileURLToPath(new URL("../..", import.meta.url));
const argumentos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const sinConfirmar = process.argv.includes("--si");
const url = process.env["DATABASE_URL"] ?? "file:./datos/apurimeno.db";
const rutaBase = resolve(DIR_SERVIDOR, rutaDesdeUrl(url));
const config = leerConfiguracionRespaldos(process.env, rutaBase);

const MB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const describir = (c: CopiaDisponible) =>
  `${c.destino === "LOCAL" ? "local  " : "externa"}  ${fechaHora(c.creadoEn)}  (${hace(c.creadoEn)})  ${MB(c.tamanoBytes).padStart(9)}  ${c.ruta}`;

function fallar(mensaje: string): never {
  console.error(`\nNo se restauró nada: ${mensaje}`);
  process.exit(1);
}

async function servidorEncendido(): Promise<boolean> {
  const puerto = Number(process.env["PORT"] ?? 3001);
  try {
    const r = await fetch(`http://127.0.0.1:${puerto}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

const copias = await copiasDisponibles(config);
if (argumentos.length === 0) {
  console.log(`Base: ${rutaBase}\nCopias locales: ${config.carpetaLocal ?? "—"}\nCopias externas: ${config.carpetaExternaConfigurada ?? "— (RESPALDO_CARPETA_EXTERNA)"}\n`);
  if (copias.length === 0) console.log("No hay copias en esas carpetas. Indique el archivo: pnpm restaurar <ruta de la copia>");
  for (const c of copias) console.log(describir(c));
  console.log("\nPara restaurar: pnpm restaurar ultima   o   pnpm restaurar <archivo>");
  process.exit(0);
}

const pedido = argumentos[0]!;
const archivo = pedido === "ultima" ? (copias[0]?.ruta ?? fallar("no hay copias en las carpetas configuradas.")) : resolve(pedido);

if (await servidorEncendido()) fallar("el servidor está encendido. Deténgalo (Ctrl+C en su ventana, o el servicio) y vuelva a intentarlo.");

console.log(`Se restaurará:\n  ${archivo}\nsobre la base:\n  ${rutaBase}\nLa base actual no se borra: queda apartada en una carpeta "reemplazada-…" junto a ella.`);
if (!sinConfirmar && (await preguntar('\nEscriba RESTAURAR para continuar: ')) !== "RESTAURAR") fallar("cancelado.");

let clave: string | null = process.env["RESPALDO_CLAVE_PRIVADA"] ?? null;
if (clave === null && archivo.endsWith(".cifrado")) clave = await preguntar("Clave privada de respaldo (no se muestra): ", true);

let resultado;
try {
  resultado = await restaurar(archivo, rutaBase, clave, new Date());
} catch (error) {
  if (error instanceof ErrorClave || error instanceof ErrorRespaldo) fallar(error.message);
  if (error instanceof Error && "code" in error && ["EBUSY", "EPERM"].includes(String(error.code))) {
    fallar("la base está en uso. ¿Quedó el servidor abierto? Deténgalo y vuelva a intentarlo.");
  }
  throw error;
}

// Si la copia es de una versión anterior del sistema, se le aplican las migraciones que le falten.
const migracion = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
  cwd: DIR_SERVIDOR,
  env: { ...process.env, DATABASE_URL: `file:${rutaBase}` },
  shell: process.platform === "win32",
  encoding: "utf8",
});
if (migracion.status !== 0) {
  console.error(migracion.stdout, migracion.stderr);
  fallar("la copia se restauró, pero no se pudieron aplicar las migraciones. Corra `pnpm migrate` y revise el error.");
}

const { resumen } = resultado;
console.log(`
Restauración completa en ${((Date.now() - inicio) / 1000).toFixed(1)} s.
  Copia tomada:          ${resultado.tomadaEn === null ? "desconocido (archivo renombrado)" : `${fechaHora(resultado.tomadaEn)} (${hace(resultado.tomadaEn)})`}
  Tickets:               ${resumen.tickets}${resumen.ultimoTicketEn === null ? "" : `, el último del ${fechaHora(resumen.ultimoTicketEn)}`}
  Alquileres abiertos:   ${resumen.alquileresAbiertos}
  Turnos abiertos:       ${resumen.turnosAbiertos}
  Base anterior:         ${resultado.baseAnteriorEn ?? "no había"}

Lo que se registró después de la hora de la copia no está: revíselo con el cuaderno o los comprobantes impresos.
Siguiente paso: encender el servidor (pnpm start) y, en el Dashboard, Espejo en la nube → "Re-sincronizar todo".`);
