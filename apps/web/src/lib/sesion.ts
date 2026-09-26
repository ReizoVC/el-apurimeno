import type { Permiso, Usuario } from "@apurimeno/contracts";

// Sesión del Dashboard: token JWT, la cuenta y sus permisos (para mostrar u ocultar secciones; el servidor
// los vuelve a comprobar en cada solicitud). Se guarda en localStorage, como en el POS y en limpieza.

const CLAVE = "apurimeno.dashboard.sesion";

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
