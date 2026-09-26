// Formatos de pantalla. El dinero viaja en céntimos enteros (RN-37); aquí solo se muestra y se lee.

const ZONA = "America/Lima";

export function soles(centimos: number): string {
  const signo = centimos < 0 ? "-" : "";
  return `${signo}S/ ${(Math.abs(centimos) / 100).toFixed(2)}`;
}

/**
 * Lee un monto en soles escrito por el cajero ("40", "40.5", "40,50") y lo devuelve en céntimos, o null si no
 * es un monto válido con a lo sumo dos decimales.
 */
export function leerSoles(texto: string): number | null {
  const limpio = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const [enteros = "0", decimales = ""] = limpio.split(".");
  return Number(enteros) * 100 + Number(decimales.padEnd(2, "0"));
}

const formatoHora = new Intl.DateTimeFormat("es-PE", {
  timeZone: ZONA,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const formatoFechaHora = new Intl.DateTimeFormat("es-PE", {
  timeZone: ZONA,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function hora(iso: string): string {
  return formatoHora.format(new Date(iso));
}

export function fechaHora(iso: string): string {
  return formatoFechaHora.format(new Date(iso));
}

/** "1 h 05 min" o "12 min" a partir de milisegundos (siempre positivos). */
export function duracion(ms: number): string {
  const minutos = Math.floor(Math.abs(ms) / 60_000);
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

/** Piso de una habitación, tomado de su número: "205" → "2". Solo para agrupar en pantalla. */
export function pisoDe(numero: string): string {
  return numero.length > 2 ? numero.slice(0, -2) : numero;
}
