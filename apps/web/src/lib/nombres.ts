import type { Sesion } from "./sesion";
import { servidor } from "./servidor";

/**
 * Nombre de cada usuario por id. Listar usuarios exige users.manage: sin ese permiso el mapa queda vacío y
 * las pantallas muestran el id, en vez de fallar enteras.
 */
export async function nombresDeUsuarios(
  sesion: Sesion,
): Promise<Map<string, string>> {
  if (!sesion.permisos.includes("users.manage")) return new Map();
  return new Map(
    (await servidor.usuarios()).map((u) => [u.id, u.nombreUsuario]),
  );
}
