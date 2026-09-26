// Dinero en pantalla. Viaja siempre en céntimos enteros (RN-37); aquí solo se muestra y se lee.

/** 2500 → "S/ 25.00"; -500 → "-S/ 5.00". */
export function soles(centimos: number): string {
  const signo = centimos < 0 ? "-" : "";
  return `${signo}S/ ${(Math.abs(centimos) / 100).toFixed(2)}`;
}

/**
 * Lee un monto en soles escrito a mano ("40", "40.5", "40,50") y lo devuelve en céntimos, o null si no es un
 * monto válido con a lo sumo dos decimales.
 */
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
