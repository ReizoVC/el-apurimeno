import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

// Cifrado de la copia externa (Planos §14.3; decisión 23). La copia sale del local hacia una carpeta sincronizada
// con la nube y lleva clientes, tickets y usuarios: va comprimida y cifrada.
//
// Cifrado de clave pública (X25519 + HKDF-SHA256 + AES-256-GCM, el esquema de "age" o ECIES): el servidor solo
// tiene la clave PÚBLICA, que sirve para cifrar pero no para descifrar. La privada se genera una vez, se guarda en
// el gestor de contraseñas de la propietaria y solo hace falta para restaurar. Así, ni el equipo del local ni la
// carpeta de las copias tienen con qué abrirlas.
//
// Formato del archivo:
//   "APURESP1" (8 bytes) · clave pública efímera X25519 (32) · IV (12) · base SQLite comprimida con gzip, cifrada
//   con AES-256-GCM · etiqueta GCM (16)
// La cabecera completa (52 bytes) va autenticada como AAD: cualquier cambio en el archivo hace fallar el descifrado.

const MAGICO = Buffer.from("APURESP1", "ascii");
const LARGO_CLAVE = 32;
const LARGO_IV = 12;
const LARGO_ETIQUETA = 16;
export const LARGO_CABECERA = MAGICO.length + LARGO_CLAVE + LARGO_IV;
const INFO_HKDF = Buffer.from("apurimeno-respaldo-v1", "ascii");

// Envolturas DER de X25519: con ellas, 32 bytes crudos se vuelven un KeyObject de Node.
const PREFIJO_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const PREFIJO_SPKI = Buffer.from("302a300506032b656e032100", "hex");

const PREFIJO_TEXTO_PRIVADA = "apr-privada-";
const PREFIJO_TEXTO_PUBLICA = "apr-publica-";

export class ErrorClave extends Error {
  override name = "ErrorClave";
}

const control = (prefijo: string, bytes: Buffer) => createHash("sha256").update(prefijo).update(bytes).digest().subarray(0, 4);

/** Clave en texto: prefijo + base64url(32 bytes + 4 de control). El control detecta una clave mal copiada. */
function aTexto(prefijo: string, bytes: Buffer): string {
  return prefijo + Buffer.concat([bytes, control(prefijo, bytes)]).toString("base64url");
}

function desdeTexto(prefijo: string, texto: string, nombre: string): Buffer {
  const limpio = texto.trim();
  if (!limpio.startsWith(prefijo)) {
    throw new ErrorClave(`La ${nombre} debe empezar con "${prefijo}".`);
  }
  const datos = Buffer.from(limpio.slice(prefijo.length), "base64url");
  const bytes = datos.subarray(0, LARGO_CLAVE);
  if (datos.length !== LARGO_CLAVE + 4 || !datos.subarray(LARGO_CLAVE).equals(control(prefijo, bytes))) {
    throw new ErrorClave(`La ${nombre} está incompleta o mal copiada: revise cada carácter.`);
  }
  return bytes;
}

const crudaPublica = (clave: KeyObject) => Buffer.from(clave.export({ format: "der", type: "spki" })).subarray(PREFIJO_SPKI.length);
const crudaPrivada = (clave: KeyObject) => Buffer.from(clave.export({ format: "der", type: "pkcs8" })).subarray(PREFIJO_PKCS8.length);
const publicaDesdeCruda = (bytes: Buffer) => createPublicKey({ key: Buffer.concat([PREFIJO_SPKI, bytes]), format: "der", type: "spki" });
const privadaDesdeCruda = (bytes: Buffer) => createPrivateKey({ key: Buffer.concat([PREFIJO_PKCS8, bytes]), format: "der", type: "pkcs8" });

export interface ParClaves {
  /** Para el gestor de contraseñas de la propietaria. Nunca se guarda en el equipo. */
  privada: string;
  /** Para `RESPALDO_CLAVE_PUBLICA` en apps/server/.env. */
  publica: string;
}

export function generarClaves(): ParClaves {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  return {
    privada: aTexto(PREFIJO_TEXTO_PRIVADA, crudaPrivada(privateKey)),
    publica: aTexto(PREFIJO_TEXTO_PUBLICA, crudaPublica(publicKey)),
  };
}

/** Valida una clave pública en texto; lanza ErrorClave si está mal. */
export function leerClavePublica(texto: string): KeyObject {
  return publicaDesdeCruda(desdeTexto(PREFIJO_TEXTO_PUBLICA, texto, "clave pública"));
}

export function leerClavePrivada(texto: string): KeyObject {
  return privadaDesdeCruda(desdeTexto(PREFIJO_TEXTO_PRIVADA, texto, "clave privada"));
}

/** La clave pública que corresponde a una privada: para configurar otro equipo sin generar claves nuevas. */
export function publicaDePrivada(privada: string): string {
  return aTexto(PREFIJO_TEXTO_PUBLICA, crudaPublica(createPublicKey(leerClavePrivada(privada))));
}

function claveSimetrica(compartido: Buffer, efimera: Buffer, destinatario: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", compartido, Buffer.concat([efimera, destinatario]), INFO_HKDF, 32));
}

/** Comprime y cifra `origen` (una base SQLite) en `destino` con la clave pública. */
export async function cifrarArchivo(origen: string, destino: string, clavePublica: KeyObject): Promise<void> {
  const efimera = generateKeyPairSync("x25519");
  const publicaEfimera = crudaPublica(efimera.publicKey);
  const compartido = diffieHellman({ privateKey: efimera.privateKey, publicKey: clavePublica });
  const clave = claveSimetrica(compartido, publicaEfimera, crudaPublica(clavePublica));
  const iv = randomBytes(LARGO_IV);
  const cabecera = Buffer.concat([MAGICO, publicaEfimera, iv]);
  const cifrador = createCipheriv("aes-256-gcm", clave, iv);
  cifrador.setAAD(cabecera);

  const salida = createWriteStream(destino, { flags: "wx" });
  salida.write(cabecera);
  // La etiqueta GCM se conoce al final: se agrega después del último bloque cifrado.
  const conEtiqueta = new Transform({
    transform(trozo: Buffer, _codificacion, listo) {
      listo(null, trozo);
    },
    flush(listo) {
      listo(null, cifrador.getAuthTag());
    },
  });
  await pipeline(createReadStream(origen), createGzip({ level: 6 }), cifrador, conEtiqueta, salida);
}

/**
 * Descifra y descomprime una copia externa en `destino`. Si la clave no es la correcta o el archivo cambió en
 * algo, falla sin dejar el destino a medias (la etiqueta GCM se verifica al final: quien llama borra el destino).
 */
export async function descifrarArchivo(origen: string, destino: string, clavePrivada: KeyObject): Promise<void> {
  const { size } = await stat(origen);
  if (size < LARGO_CABECERA + LARGO_ETIQUETA) throw new ErrorClave("El archivo no es una copia externa de El Apurimeño.");
  const archivo = await open(origen, "r");
  const cabecera = Buffer.alloc(LARGO_CABECERA);
  const etiqueta = Buffer.alloc(LARGO_ETIQUETA);
  try {
    await archivo.read(cabecera, 0, LARGO_CABECERA, 0);
    await archivo.read(etiqueta, 0, LARGO_ETIQUETA, size - LARGO_ETIQUETA);
  } finally {
    await archivo.close();
  }
  if (!cabecera.subarray(0, MAGICO.length).equals(MAGICO)) {
    throw new ErrorClave("El archivo no es una copia externa de El Apurimeño.");
  }
  const publicaEfimera = cabecera.subarray(MAGICO.length, MAGICO.length + LARGO_CLAVE);
  const iv = cabecera.subarray(MAGICO.length + LARGO_CLAVE);
  const destinatario = crudaPublica(createPublicKey(clavePrivada));
  const compartido = diffieHellman({ privateKey: clavePrivada, publicKey: publicaDesdeCruda(publicaEfimera) });
  const descifrador = createDecipheriv("aes-256-gcm", claveSimetrica(compartido, publicaEfimera, destinatario), iv);
  descifrador.setAAD(cabecera);
  descifrador.setAuthTag(etiqueta);
  try {
    await pipeline(
      createReadStream(origen, { start: LARGO_CABECERA, end: size - LARGO_ETIQUETA - 1 }),
      descifrador,
      createGunzip(),
      createWriteStream(destino, { flags: "wx" }),
    );
  } catch (error) {
    if (error instanceof Error && /unable to authenticate|auth/i.test(error.message)) {
      throw new ErrorClave("La clave privada no corresponde a esta copia, o el archivo está dañado o fue modificado.");
    }
    if (error instanceof Error && "code" in error && String(error.code).startsWith("Z_")) {
      throw new ErrorClave("La clave privada no corresponde a esta copia, o el archivo está dañado o fue modificado.");
    }
    throw error;
  }
}
