// Cantidades de producto en pantalla. Viajan siempre en milésimas enteras de su unidad (decisión 31 de contracts):
// aquí solo se muestran y se leen. Usa el punto decimal, como los montos ("S/ 25.00").

const ABREVIATURA: Readonly<Record<string, string>> = { UNIDAD: "", METRO: "m", KILOGRAMO: "kg", LITRO: "L" };

/** Abreviatura de una unidad para mostrarla junto a una cantidad: "" para UNIDAD, "m", "kg", "L". */
export function abreviaturaUnidad(unidad: string): string {
  return ABREVIATURA[unidad] ?? "";
}

/** 2500 → "2.5"; 3000 → "3"; 250 → "0.25"; -1500 → "-1.5". Sin ceros sobrantes. */
export function cantidad(milesimas: number): string {
  const signo = milesimas < 0 ? "-" : "";
  const absoluto = Math.abs(milesimas);
  const enteros = Math.floor(absoluto / 1000);
  const decimales = String(absoluto % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${signo}${enteros}${decimales === "" ? "" : `.${decimales}`}`;
}

/** 2500 con METRO → "2.5 m"; 3000 con UNIDAD → "3". */
export function cantidadConUnidad(milesimas: number, unidad: string): string {
  const abreviatura = abreviaturaUnidad(unidad);
  return abreviatura === "" ? cantidad(milesimas) : `${cantidad(milesimas)} ${abreviatura}`;
}

/**
 * Lee una cantidad escrita a mano ("2", "2.5", "2,50") y la devuelve en milésimas, o null si no es válida. Con
 * `decimales` en false (productos por unidad), solo acepta enteros. Admite el 0: quien llama decide si sirve.
 */
export function leerCantidad(texto: string, decimales: boolean): number | null {
  const limpio = texto.trim().replace(",", ".");
  if (!(decimales ? /^\d{1,7}(\.\d{1,3})?$/ : /^\d{1,7}$/).test(limpio)) return null;
  const [enteros = "0", fraccion = ""] = limpio.split(".");
  return Number(enteros) * 1000 + Number(fraccion.padEnd(3, "0"));
}

/** Milésimas → texto editable ("2.5", "3"). */
export function aTextoCantidad(milesimas: number): string {
  return cantidad(milesimas);
}
