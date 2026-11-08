import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ManifiestoVersionSchema, type ManifiestoVersion } from "@apurimeno/contracts";
import { aTexto, desdeTexto } from "../respaldo/cifrado.js";
import type { PublicacionEncontrada } from "./github.js";

// Firma de las versiones publicadas (decisión 30). Ed25519, que trae Node: quien publica firma con la privada, que solo
// está en su equipo, y el servidor del local comprueba con la pública. Se firman los bytes exactos del manifiesto.

// Envolturas DER de Ed25519: con ellas, 32 bytes crudos se vuelven un KeyObject de Node.
const PREFIJO_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const PREFIJO_SPKI = Buffer.from("302a300506032b6570032100", "hex");
const PREFIJO_TEXTO_PRIVADA = "apv-privada-";
const PREFIJO_TEXTO_PUBLICA = "apv-publica-";
const RAIZ_REPOSITORIO = fileURLToPath(new URL("../../../../", import.meta.url));

const publicaEnTexto = (clave: KeyObject) =>
  aTexto(PREFIJO_TEXTO_PUBLICA, Buffer.from(clave.export({ format: "der", type: "spki" })).subarray(PREFIJO_SPKI.length));

export function generarClavesVersion(): { privada: string; publica: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privada: aTexto(PREFIJO_TEXTO_PRIVADA, Buffer.from(privateKey.export({ format: "der", type: "pkcs8" })).subarray(PREFIJO_PKCS8.length)),
    publica: publicaEnTexto(publicKey),
  };
}

/** Lanzan ErrorClave si el texto está mal copiado. */
export function leerClavePublicaVersion(texto: string): KeyObject {
  const bytes = desdeTexto(PREFIJO_TEXTO_PUBLICA, texto, "clave pública de versiones");
  return createPublicKey({ key: Buffer.concat([PREFIJO_SPKI, bytes]), format: "der", type: "spki" });
}
export function leerClavePrivadaVersion(texto: string): KeyObject {
  const bytes = desdeTexto(PREFIJO_TEXTO_PRIVADA, texto, "clave privada de versiones");
  return createPrivateKey({ key: Buffer.concat([PREFIJO_PKCS8, bytes]), format: "der", type: "pkcs8" });
}
export const publicaDePrivadaVersion = (privada: KeyObject): KeyObject => createPublicKey(privada);

export const firmarManifiesto = (bytes: Buffer, privada: KeyObject): string => sign(null, bytes, privada).toString("base64");

/** false, sin lanzar, con cualquier firma mala: también si no es base64 o tiene otro largo. */
export function firmaValida(bytes: Buffer, firma: string, publica: KeyObject): boolean {
  try {
    return verify(null, bytes, publica, Buffer.from(firma.trim(), "base64"));
  } catch {
    return false;
  }
}

/** El manifiesto, solo si la firma es buena y es de la versión que dice la etiqueta. Si no, null. */
export function manifiestoVerificado(publicacion: PublicacionEncontrada, publica: KeyObject): ManifiestoVersion | null {
  const { manifiesto, firma, etiqueta } = publicacion;
  if (manifiesto === null || firma === null || !firmaValida(manifiesto, firma, publica)) return null;
  try {
    const leido = ManifiestoVersionSchema.parse(JSON.parse(manifiesto.toString("utf8")));
    return etiqueta === `v${leido.version}` ? leido : null;
  } catch {
    return null;
  }
}

/** La clave privada nunca va dentro del repositorio: un `git add` de más la publicaría. */
export function estaFueraDelRepositorio(ruta: string): boolean {
  const relativa = relative(RAIZ_REPOSITORIO, resolve(ruta));
  return relativa.startsWith("..") || isAbsolute(relativa);
}
