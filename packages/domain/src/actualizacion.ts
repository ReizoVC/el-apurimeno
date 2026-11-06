import type { ManifiestoVersion, VersionDisponible } from "@apurimeno/contracts";

function partes(version: string): [number, number, number] {
  const [mayor, menor, parche] = version.split(".").map(Number);
  if (mayor === undefined || menor === undefined || parche === undefined || [mayor, menor, parche].some((n) => !Number.isSafeInteger(n))) {
    throw new RangeError(`Versión inválida: ${version}`);
  }
  return [mayor, menor, parche];
}

/** Negativo si `a` es anterior a `b`, 0 si son iguales, positivo si es posterior. Compara números: 0.10.0 > 0.9.0. */
export function compararVersiones(a: string, b: string): number {
  const pa = partes(a);
  const pb = partes(b);
  for (let i = 0; i < 3; i++) {
    const d = pa[i]! - pb[i]!;
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Lo que se le ofrece al local según el manifiesto ya verificado (decisión 30): null si no es posterior a la instalada.
 * Es completa si la instalada es anterior a la última versión que exigió detener los servicios.
 */
export function versionDisponible(instalada: string, manifiesto: ManifiestoVersion): VersionDisponible | null {
  if (compararVersiones(manifiesto.version, instalada) <= 0) return null;
  return {
    version: manifiesto.version,
    notas: manifiesto.notas,
    completa: compararVersiones(instalada, manifiesto.ultimaCompleta) < 0,
    publicadaEn: manifiesto.publicadaEn,
  };
}
