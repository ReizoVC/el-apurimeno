// Entorno de capacitación (docs/INSTALACION_LOCAL.md): una segunda instancia del servidor, con su propia base, en
// el puerto 3011. Las apps deciden a cuál conectarse mirando el usuario que se escribe en el login, antes de
// cualquier llamada de red: las cuentas de capacitación empiezan con "capacitacion.". Mismo prefijo y puerto que
// apps/server/src/capacitacion.ts e instancia.ts.

export type Entorno = "PRODUCCION" | "CAPACITACION";

export const PREFIJO_CAPACITACION = "capacitacion.";
export const PUERTO_CAPACITACION = 3011;

/**
 * Forma de un usuario de capacitación tal como está en su base: sin espacios alrededor, en minúsculas y sin tildes
 * (en el celular el teclado suele poner la primera en mayúscula, y alguien puede escribir "capacitación.").
 */
export function normalizarUsuario(nombreUsuario: string): string {
  return nombreUsuario
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function entornoDeUsuario(nombreUsuario: string): Entorno {
  return normalizarUsuario(nombreUsuario).startsWith(PREFIJO_CAPACITACION)
    ? "CAPACITACION"
    : "PRODUCCION";
}

/** Usuario que se envía al servidor: el de capacitación, normalizado; el de producción, sin tocar (salvo espacios). */
export function usuarioParaEnviar(nombreUsuario: string): string {
  return entornoDeUsuario(nombreUsuario) === "CAPACITACION"
    ? normalizarUsuario(nombreUsuario)
    : nombreUsuario.trim();
}

/** La URL del servidor de capacitación: la de producción con el puerto 3011, salvo que se configure otra. */
export function urlCapacitacion(
  urlProduccion: string,
  configurada: string | undefined,
): string {
  if (configurada !== undefined && configurada !== "")
    return configurada.replace(/\/+$/, "");
  const url = new URL(urlProduccion);
  url.port = String(PUERTO_CAPACITACION);
  return url.origin;
}

/** Entorno de una sesión guardada antes de que existiera la capacitación: producción. */
export function entornoGuardado(valor: unknown): Entorno {
  return valor === "CAPACITACION" ? "CAPACITACION" : "PRODUCCION";
}
