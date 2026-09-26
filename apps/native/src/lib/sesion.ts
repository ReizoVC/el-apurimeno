import type { Permiso, Usuario } from "@apurimeno/contracts";

// Sesión del POS: el token JWT del servidor, la cuenta y sus permisos (para mostrar u ocultar acciones; el
// servidor vuelve a comprobarlos en cada solicitud). Se guarda en localStorage, como en apps/cleaning.

const CLAVE = "apurimeno.pos.sesion";

export interface Sesion {
  token: string;
  usuario: Usuario;
  permisos: Permiso[];
}

export function leerSesion(): Sesion | null {
  try {
    const valor = window.localStorage.getItem(CLAVE);
    if (valor === null) return null;
    const sesion = JSON.parse(valor) as Partial<Sesion>;
    return typeof sesion.token === "string" &&
      sesion.usuario !== undefined &&
      Array.isArray(sesion.permisos)
      ? (sesion as Sesion)
      : null;
  } catch {
    return null;
  }
}

export function guardarSesion(sesion: Sesion): void {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(sesion));
  } catch {
    // Sin almacenamiento, la sesión vive solo en memoria.
  }
}

export function borrarSesion(): void {
  try {
    window.localStorage.removeItem(CLAVE);
  } catch {
    // Nada que borrar.
  }
}

export function tienePermiso(sesion: Sesion, permiso: Permiso): boolean {
  return sesion.permisos.includes(permiso);
}
