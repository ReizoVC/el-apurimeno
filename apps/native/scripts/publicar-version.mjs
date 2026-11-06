// Publica una versión para el PC del local (docs/ACTUALIZACION_REMOTA.md): compila el instalador del POS, firma su
// manifiesto, crea la etiqueta vX.Y.Z y la publicación de GitHub con el instalador, su SHA-256 y el manifiesto firmado.
//
//   pnpm publicar-version --notas "Qué cambia"   desde un worktree o clon, en el commit de origin/main. La nota es lo
//                                                que lee el personal. Pide ACTUALIZACION_CLAVE_PRIVADA_ARCHIVO
//   pnpm publicar-version --solo-compilar        compila y deja los archivos, sin firma, etiqueta ni publicación
//
// El número sale de apps/native/src-tauri/tauri.conf.json: se sube en el PR de la versión. Windows Installer solo
// reemplaza el POS si el número es mayor.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const nativo = fileURLToPath(new URL("..", import.meta.url));
const soloCompilar = process.argv.includes("--solo-compilar");
const indiceNotas = process.argv.indexOf("--notas");
const notas = indiceNotas === -1 ? "" : (process.argv[indiceNotas + 1] ?? "").trim();

function fallar(mensaje) {
  console.error(`\nNo se publicó nada: ${mensaje}`);
  process.exit(1);
}
function correr(comando, argumentos, opciones = {}) {
  const r = spawnSync(comando, argumentos, { encoding: "utf8", cwd: nativo, ...opciones });
  if (r.status !== 0) fallar(`${comando} ${argumentos.join(" ")}\n${r.stderr ?? ""}`);
  return (r.stdout ?? "").trim();
}

const { version } = JSON.parse(readFileSync(join(nativo, "src-tauri", "tauri.conf.json"), "utf8"));
const etiqueta = `v${version}`;

// Una URL fijada al compilar dejaría el POS del local apuntando a otro equipo (o al servidor de otra prueba).
for (const v of ["VITE_SERVIDOR_URL", "VITE_SERVIDOR_CAPACITACION_URL"]) {
  if (process.env[v]) fallar(`${v} está definida; el instalador del local usa el servidor del mismo equipo.`);
}

if (!soloCompilar) {
  if (notas === "") fallar('falta --notas "Qué cambia": es lo que lee el personal en el aviso.');
  if (notas.length > 500) fallar(`la nota tiene ${notas.length} caracteres; el máximo es 500.`);
  if (!process.env["ACTUALIZACION_CLAVE_PRIVADA_ARCHIVO"]) {
    fallar("falta ACTUALIZACION_CLAVE_PRIVADA_ARCHIVO: el archivo de la clave privada de versiones (pnpm clave-actualizacion).");
  }
  correr("git", ["fetch", "origin", "main", "--tags"]);
  if (correr("git", ["status", "--porcelain"]) !== "") fallar("hay cambios sin commit.");
  if (correr("git", ["rev-parse", "HEAD"]) !== correr("git", ["rev-parse", "origin/main"])) {
    fallar("este checkout no está en el último commit de origin/main.");
  }
  if (spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${etiqueta}`], { cwd: nativo }).status === 0) {
    fallar(`la versión ${etiqueta} ya existe: suba el número en tauri.conf.json con un PR.`);
  }
}

console.log(`Compilando el instalador del POS ${version}...`);
const compilacion = spawnSync("pnpm", ["tauri", "build", "--bundles", "msi"], { cwd: nativo, stdio: "inherit", shell: process.platform === "win32" });
if (compilacion.status !== 0) fallar("falló la compilación del POS.");

const carpetaMsi = join(nativo, "src-tauri", "target", "release", "bundle", "msi");
const original = readdirSync(carpetaMsi).find((n) => n.endsWith(".msi") && n.includes(`_${version}_`));
if (original === undefined) fallar(`no se encontró el MSI de la versión ${version} en ${carpetaMsi}.`);

// Nombre sin espacios ni ñ: GitHub los cambiaría al subirlo y el PC del local no lo encontraría.
const salida = join(nativo, "src-tauri", "target", "publicacion");
mkdirSync(salida, { recursive: true });
const nombre = `ElApurimeno-POS-${version}.msi`;
const msi = join(salida, nombre);
copyFileSync(join(carpetaMsi, original), msi);
const hash = createHash("sha256").update(readFileSync(msi)).digest("hex").toUpperCase();
writeFileSync(`${msi}.sha256`, `${hash}  ${nombre}\n`);
console.log(`${msi}\nSHA-256: ${hash}`);

if (soloCompilar) process.exit(0);

// Antes de la etiqueta: si la firma falla, no queda nada publicado a medias.
const borrador = join(salida, "borrador-manifiesto.json");
writeFileSync(
  borrador,
  JSON.stringify({ version, commit: correr("git", ["rev-parse", "HEAD"]), instaladorPos: { nombre, sha256: hash }, notas }),
);
const firmado = spawnSync("pnpm", ["--silent", "--filter", "server", "firmar-version", `"${borrador}"`], {
  encoding: "utf8",
  cwd: nativo,
  shell: process.platform === "win32",
});
if (firmado.status !== 0) fallar(`no se pudo firmar el manifiesto.\n${firmado.stderr ?? ""}`);
const [manifiesto, firma] = firmado.stdout.trim().split(/\r?\n/);
if (manifiesto === undefined || firma === undefined) fallar("firmar-version no devolvió sus archivos.");

correr("git", ["tag", "-a", etiqueta, "-m", `El Apurimeño ${version}`]);
correr("git", ["push", "origin", etiqueta]);
correr("gh", ["release", "create", etiqueta, msi, `${msi}.sha256`, manifiesto, firma, "--verify-tag", "--title", `El Apurimeño ${version}`, "--notes", notas]);
console.log(`\nPublicada ${etiqueta}. Para instalarla, ver docs/ACTUALIZACION_REMOTA.md.`);
