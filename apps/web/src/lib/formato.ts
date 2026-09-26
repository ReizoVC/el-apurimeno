// Formatos de pantalla. El dinero viaja en céntimos enteros (RN-37); aquí solo se muestra y se lee.

export const ZONA_NEGOCIO = "America/Lima";

export function soles(centimos: number): string {
  const signo = centimos < 0 ? "-" : "";
  return `${signo}S/ ${(Math.abs(centimos) / 100).toFixed(2)}`;
}

/** "40", "40.5" o "40,50" → céntimos; null si no es un monto con a lo sumo dos decimales. */
export function leerSoles(texto: string): number | null {
  const limpio = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const [enteros = "0", decimales = ""] = limpio.split(".");
  return Number(enteros) * 100 + Number(decimales.padEnd(2, "0"));
}

/** Céntimos → texto editable ("40.00"). */
export function aTextoSoles(centimos: number): string {
  return (centimos / 100).toFixed(2);
}

const formatoFechaHora = new Intl.DateTimeFormat("es-PE", {
  timeZone: ZONA_NEGOCIO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const formatoHora = new Intl.DateTimeFormat("es-PE", {
  timeZone: ZONA_NEGOCIO,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const fechaHora = (iso: string) =>
  formatoFechaHora.format(new Date(iso));
export const hora = (iso: string) => formatoHora.format(new Date(iso));
