// Genera los íconos de las apps a partir del ícono maestro (ver README.md de esta carpeta): `pnpm iconos`.
//
// - El dibujo va sobre una placa blanca para que se vea en fondos oscuros (pestañas en modo oscuro, la barra de
//   tareas de Windows). Placa redondeada para el favicon y el POS; cuadrada para el ícono de iOS, que redondea las
//   esquinas por su cuenta y pinta de negro lo transparente.
// - Los tamaños los hace `tauri icon` (el CLI que ya usa el POS), para no sumar dependencias al monorepo.
// - El favicon.ico lleva 16, 32 y 48 px, en PNG dentro del ICO.
//
// Escribe en apps/native/src-tauri/icons/ (el juego completo de Tauri) y, en la carpeta app/ de web, cleaning y owner,
// los archivos de íconos del App Router de Next: favicon.ico, icon1.png (16), icon2.png (32) y apple-icon.png (180).
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAESTRO = join(RAIZ, "recursos", "icono_maestro_apurimeno_1024.png");
const TRABAJO = join(RAIZ, "node_modules", ".cache", "iconos");
const TAURI = join(RAIZ, "apps", "native", "node_modules", "@tauri-apps", "cli", "tauri.js");
const APPS_NEXT = ["web", "cleaning", "owner"];

/** Radio de las esquinas de la placa, en fracción del lado. */
const RADIO_PLACA = 0.2;

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG RGBA de 8 bits sin entrelazar (como el maestro) a píxeles RGBA. */
function leerPngRgba(archivo) {
  if (!archivo.subarray(0, 8).equals(FIRMA_PNG)) throw new Error("No es un PNG.");
  let ancho = 0, alto = 0;
  const idat = [];
  for (let i = 8; i < archivo.length; ) {
    const largo = archivo.readUInt32BE(i);
    const tipo = archivo.toString("latin1", i + 4, i + 8);
    const datos = archivo.subarray(i + 8, i + 8 + largo);
    if (tipo === "IHDR") {
      ancho = datos.readUInt32BE(0);
      alto = datos.readUInt32BE(4);
      if (datos[8] !== 8 || datos[9] !== 6 || datos[12] !== 0)
        throw new Error("El ícono maestro tiene que ser PNG RGBA de 8 bits, sin entrelazar.");
    }
    if (tipo === "IDAT") idat.push(datos);
    i += 12 + largo;
  }
  const crudo = inflateSync(Buffer.concat(idat));
  const fila = ancho * 4;
  const px = Buffer.alloc(alto * fila);
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[y * (fila + 1)];
    for (let x = 0; x < fila; x++) {
      const v = crudo[y * (fila + 1) + 1 + x];
      const a = x >= 4 ? px[y * fila + x - 4] : 0;
      const b = y > 0 ? px[(y - 1) * fila + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * fila + x - 4] : 0;
      let p;
      if (filtro === 0) p = 0;
      else if (filtro === 1) p = a;
      else if (filtro === 2) p = b;
      else if (filtro === 3) p = (a + b) >> 1;
      else {
        const e = a + b - c, da = Math.abs(e - a), db = Math.abs(e - b), dc = Math.abs(e - c);
        p = da <= db && da <= dc ? a : db <= dc ? b : c;
      }
      px[y * fila + x] = (v + p) & 0xff;
    }
  }
  return { ancho, alto, px };
}

function escribirPngRgba({ ancho, alto, px }) {
  const fila = ancho * 4;
  const crudo = Buffer.alloc(alto * (fila + 1));
  for (let y = 0; y < alto; y++) px.copy(crudo, y * (fila + 1) + 1, y * fila, (y + 1) * fila);
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(ancho, 0);
  cabecera.writeUInt32BE(alto, 4);
  cabecera[8] = 8;
  cabecera[9] = 6;
  const bloque = (tipo, datos) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const td = Buffer.concat([Buffer.from(tipo, "latin1"), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([largo, td, crc]);
  };
  return Buffer.concat([FIRMA_PNG, bloque("IHDR", cabecera), bloque("IDAT", deflateSync(crudo, { level: 9 })), bloque("IEND", Buffer.alloc(0))]);
}

/** Cuánto de un píxel cubre la placa (0 a 1), con el borde de las esquinas suavizado. */
function coberturaPlaca(x, y, lado, radio) {
  if (radio === 0) return 1;
  const cx = x + 0.5, cy = y + 0.5;
  const dx = Math.max(radio - cx, cx - (lado - radio), 0);
  const dy = Math.max(radio - cy, cy - (lado - radio), 0);
  return Math.min(1, Math.max(0, radio - Math.hypot(dx, dy) + 0.5));
}

/** El dibujo del maestro sobre una placa blanca (radio 0: cuadrada). */
function sobrePlaca(maestro, radioFraccion) {
  const { ancho: lado, px } = maestro;
  const radio = lado * radioFraccion;
  const salida = Buffer.alloc(px.length);
  for (let y = 0; y < lado; y++)
    for (let x = 0; x < lado; x++) {
      const i = (y * lado + x) * 4;
      const a = px[i + 3] / 255;
      const p = coberturaPlaca(x, y, lado, radio);
      const total = a + p * (1 - a);
      // Lo transparente, blanco: al reducir, su color se mezcla con el borde de la placa y, si fuera negro, la
      // dejaría con un contorno gris.
      for (let k = 0; k < 3; k++)
        salida[i + k] = total === 0 ? 255 : Math.round((px[i + k] * a + 255 * p * (1 - a)) / total);
      salida[i + 3] = Math.round(total * 255);
    }
  return { ancho: lado, alto: lado, px: salida };
}

/** ICO con las imágenes en PNG (Windows Vista en adelante y todos los navegadores actuales). */
function escribirIco(pngs) {
  const cabecera = Buffer.alloc(6 + 16 * pngs.length);
  cabecera.writeUInt16LE(1, 2);
  cabecera.writeUInt16LE(pngs.length, 4);
  let desplazamiento = cabecera.length;
  pngs.forEach(({ lado, datos }, n) => {
    const e = 6 + 16 * n;
    cabecera[e] = lado >= 256 ? 0 : lado;
    cabecera[e + 1] = lado >= 256 ? 0 : lado;
    cabecera.writeUInt16LE(1, e + 4);
    cabecera.writeUInt16LE(32, e + 6);
    cabecera.writeUInt32LE(datos.length, e + 8);
    cabecera.writeUInt32LE(desplazamiento, e + 12);
    desplazamiento += datos.length;
  });
  return Buffer.concat([cabecera, ...pngs.map((p) => p.datos)]);
}

function tauriIcon(entrada, ...argumentos) {
  execFileSync(process.execPath, [TAURI, "icon", entrada, ...argumentos], { cwd: join(RAIZ, "apps", "native"), stdio: "inherit" });
}

const maestro = leerPngRgba(readFileSync(MAESTRO));
if (maestro.ancho !== maestro.alto || maestro.ancho < 512) throw new Error("El ícono maestro tiene que ser cuadrado, de 512 px o más.");

rmSync(TRABAJO, { recursive: true, force: true });
mkdirSync(TRABAJO, { recursive: true });
const redondeada = join(TRABAJO, "placa-redondeada.png");
const cuadrada = join(TRABAJO, "placa-cuadrada.png");
writeFileSync(redondeada, escribirPngRgba(sobrePlaca(maestro, RADIO_PLACA)));
writeFileSync(cuadrada, escribirPngRgba(sobrePlaca(maestro, 0)));

// POS (Tauri): el juego completo, en src-tauri/icons/.
tauriIcon(redondeada);

// Web: los tamaños chicos de la placa redondeada y el de iOS de la cuadrada.
const web = join(TRABAJO, "web");
const ios = join(TRABAJO, "ios");
tauriIcon(redondeada, "-o", web, "-p", "16,32,48");
tauriIcon(cuadrada, "-o", ios, "-p", "180");
const png = (carpeta, lado) => readFileSync(join(carpeta, `${lado}x${lado}.png`));
const favicon = escribirIco([16, 32, 48].map((lado) => ({ lado, datos: png(web, lado) })));
for (const app of APPS_NEXT) {
  const destino = join(RAIZ, "apps", app, "app");
  writeFileSync(join(destino, "favicon.ico"), favicon);
  copyFileSync(join(web, "16x16.png"), join(destino, "icon1.png"));
  copyFileSync(join(web, "32x32.png"), join(destino, "icon2.png"));
  copyFileSync(join(ios, "180x180.png"), join(destino, "apple-icon.png"));
}
console.log(`Íconos generados para el POS y para ${APPS_NEXT.join(", ")}.`);
