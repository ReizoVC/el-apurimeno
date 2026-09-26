// Sesión de la app de limpieza: el token JWT del servidor y el nombre de quien inició sesión.
// Se guarda en localStorage para no pedir el login cada vez que se abre la app en el celular.
// Todo acceso va en try/catch: en modo privado o con el almacenamiento bloqueado, la sesión dura
// lo que dure la pestaña.

const CLAVE = "apurimeno.limpieza.sesion";

export interface Sesion {
  token: string;
  nombreUsuario: string;
}

export function leerSesion(): Sesion | null {
  try {
    const valor = window.localStorage.getItem(CLAVE);
    if (valor === null) return null;
    const sesion = JSON.parse(valor) as Partial<Sesion>;
    return typeof sesion.token === "string" &&
      typeof sesion.nombreUsuario === "string"
      ? { token: sesion.token, nombreUsuario: sesion.nombreUsuario }
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
