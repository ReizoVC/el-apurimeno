import { ARCHIVO_FIRMA_VERSION, ARCHIVO_MANIFIESTO_VERSION } from "@apurimeno/contracts";

// Lo último publicado en GitHub. El repositorio es público: no hace falta ninguna credencial. Lo descargado no se cree
// hasta comprobar su firma (control.ts).

const REPOSITORIO = "ReizoVC/el-apurimeno";
const TIEMPO_MAXIMO_MS = 20_000;
/** Un manifiesto ocupa menos de 1 KB: esto solo evita leer en memoria algo que no lo es. */
const TAMANO_MAXIMO_BYTES = 64 * 1024;
const CABECERAS = { "user-agent": "el-apurimeno-servidor" };

export interface PublicacionEncontrada {
  etiqueta: string;
  /** null si la publicación no trae el archivo. */
  manifiesto: Buffer | null;
  firma: string | null;
}

/** Devuelve null si todavía no hay ninguna publicación. Lanza si no se pudo consultar (sin internet, GitHub caído). */
export type ObtenerPublicacion = () => Promise<PublicacionEncontrada | null>;

async function descargar(url: string): Promise<Buffer | null> {
  const r = await fetch(url, { headers: CABECERAS, signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub respondió ${r.status} al descargar ${url}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > TAMANO_MAXIMO_BYTES) return null;
  return bytes;
}

export const publicacionDeGitHub: ObtenerPublicacion = async () => {
  const r = await fetch(`https://api.github.com/repos/${REPOSITORIO}/releases/latest`, {
    headers: { ...CABECERAS, accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub respondió ${r.status} al consultar la última versión.`);
  const { tag_name: etiqueta } = (await r.json()) as { tag_name?: unknown };
  if (typeof etiqueta !== "string" || !/^v\d+\.\d+\.\d+$/.test(etiqueta)) {
    return { etiqueta: String(etiqueta), manifiesto: null, firma: null };
  }
  const base = `https://github.com/${REPOSITORIO}/releases/download/${etiqueta}`;
  const [manifiesto, firma] = await Promise.all([descargar(`${base}/${ARCHIVO_MANIFIESTO_VERSION}`), descargar(`${base}/${ARCHIVO_FIRMA_VERSION}`)]);
  return { etiqueta, manifiesto, firma: firma?.toString("utf8") ?? null };
};
