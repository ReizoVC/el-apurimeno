/**
 * Orígenes de navegador que pueden llamar a la API (CORS): una lista blanca exacta, nunca un comodín.
 * Se lee de `CORS_ORIGINS`, separada por comas, p. ej. `http://192.168.1.50:3002,http://192.168.1.50:3003`.
 * Sin la variable, en desarrollo se permiten las apps en localhost; en producción, solo el POS de escritorio.
 */

/**
 * Origen del POS de escritorio (apps/native, Tauri): `tauri://localhost` en Linux y macOS, y
 * `http://tauri.localhost` en Windows. Siempre se permiten: ninguna página web puede presentarse con ellos.
 */
export const ORIGENES_POS_TAURI: readonly string[] = [
  "tauri://localhost",
  "http://tauri.localhost",
];

export const ORIGENES_DESARROLLO: readonly string[] = [
  ...[1420, 3000, 3002, 3003].flatMap((puerto) => [
    `http://localhost:${puerto}`,
    `http://127.0.0.1:${puerto}`,
  ]),
  ...ORIGENES_POS_TAURI,
];

export function leerOrigenesPermitidos(
  valor: string | undefined,
  produccion: boolean,
): string[] {
  if (valor === undefined || valor.trim() === "")
    return produccion ? [...ORIGENES_POS_TAURI] : [...ORIGENES_DESARROLLO];
  return valor
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "")
    .map((origen) => {
      if (origen.includes("*"))
        throw new Error(`CORS_ORIGINS no admite comodines: ${origen}`);
      // `new URL("tauri://localhost").origin` es "null": los de Tauri se aceptan tal cual.
      if (ORIGENES_POS_TAURI.includes(origen)) return origen;
      let url: URL;
      try {
        url = new URL(origen);
      } catch {
        throw new Error(`CORS_ORIGINS tiene un origen inválido: ${origen}`);
      }
      // Un origen es esquema + host + puerto, sin ruta ni barra final: así lo envía el navegador.
      if (
        url.origin !== origen ||
        !["http:", "https:"].includes(url.protocol)
      ) {
        throw new Error(
          `CORS_ORIGINS tiene un origen inválido: ${origen} (se esperaba p. ej. ${url.origin})`,
        );
      }
      return origen;
    });
}
