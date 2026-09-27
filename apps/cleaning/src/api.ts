import {
  HabitacionSchema,
  LoginRespuestaSchema,
  RUTAS,
  RespuestaErrorSchema,
  type Habitacion,
} from "@apurimeno/contracts";
import {
  entornoDeUsuario,
  urlCapacitacion,
  usuarioParaEnviar,
  type Entorno,
} from "@apurimeno/ui/lib/capacitacion";
import type { Sesion } from "./sesion";

// Cliente de la API del servidor para la app de limpieza. Las rutas y las formas de las respuestas
// vienen de @apurimeno/contracts: la app no define su propia versión (Planos §16.1).

const PUERTO_SERVIDOR = 3001;

/**
 * URL del servidor. `NEXT_PUBLIC_SERVIDOR_URL` la fija (p. ej. http://192.168.1.50:3001). Sin ella, se
 * asume que el servidor corre en la misma máquina de la red local que sirve esta app, en el puerto
 * 3001: el celular abre http://<ip-del-local>:3002 y la API queda en http://<ip-del-local>:3001.
 *
 * En capacitación, el servidor de capacitación: `NEXT_PUBLIC_SERVIDOR_CAPACITACION_URL`, o el mismo en el
 * puerto 3011.
 */
export function urlServidor(entorno: Entorno = "PRODUCCION"): string {
  const configurada = process.env.NEXT_PUBLIC_SERVIDOR_URL;
  const produccion =
    configurada !== undefined && configurada !== ""
      ? configurada.replace(/\/+$/, "")
      : `${window.location.protocol}//${window.location.hostname}:${PUERTO_SERVIDOR}`;
  if (entorno === "PRODUCCION") return produccion;
  return urlCapacitacion(
    produccion,
    process.env.NEXT_PUBLIC_SERVIDOR_CAPACITACION_URL,
  );
}

/** Servidor de la sesión abierta (la página lo fija al entrar y al leer la sesión guardada). */
let entornoActual: Entorno = "PRODUCCION";
export function usarEntorno(entorno: Entorno): void {
  entornoActual = entorno;
}

/** Error de una llamada: `estado` es el HTTP (0 si no hubo respuesta) y `codigo`, el del contrato. */
export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string | null,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorApi";
  }

  /** La sesión venció o la cuenta fue desactivada: hay que volver a iniciar sesión. */
  get sesionInvalida(): boolean {
    return this.estado === 401;
  }
}

async function llamar(
  metodo: "GET" | "POST",
  ruta: string,
  token: string | null,
  cuerpo?: unknown,
  /** Solo el login, que todavía no tiene sesión: a qué servidor va. Después, el de la sesión. */
  entorno: Entorno = entornoActual,
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (token !== null) headers["authorization"] = `Bearer ${token}`;
  if (cuerpo !== undefined) headers["content-type"] = "application/json";

  let respuesta: Response;
  try {
    respuesta = await fetch(`${urlServidor(entorno)}${ruta}`, {
      method: metodo,
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi(
      0,
      null,
      "No se pudo conectar con el servidor. Revise la conexión a la red del local.",
    );
  }

  const datos: unknown = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    const error = RespuestaErrorSchema.safeParse(datos);
    throw error.success
      ? new ErrorApi(respuesta.status, error.data.codigo, error.data.mensaje)
      : new ErrorApi(
          respuesta.status,
          null,
          `El servidor respondió con un error (${respuesta.status}).`,
        );
  }
  return datos;
}

const conId = (plantilla: string, id: string) =>
  plantilla.replace(":id", encodeURIComponent(id));

/**
 * Inicia sesión. Solo acepta cuentas con acceso a limpieza (`cleaning.access`). La cuenta decide el servidor,
 * antes de llamar a nada: las de capacitación ("capacitacion.…") van al de capacitación.
 */
export async function iniciarSesion(
  nombreUsuario: string,
  contrasena: string,
): Promise<Sesion> {
  const entorno = entornoDeUsuario(nombreUsuario);
  const respuesta = LoginRespuestaSchema.parse(
    await llamar(
      "POST",
      RUTAS.login,
      null,
      { nombreUsuario: usuarioParaEnviar(nombreUsuario), contrasena },
      entorno,
    ),
  );
  if (!respuesta.permisos.includes("cleaning.access")) {
    throw new ErrorApi(
      403,
      "PERMISO_DENEGADO",
      "Esta cuenta no tiene acceso al módulo de limpieza.",
    );
  }
  return {
    token: respuesta.token,
    nombreUsuario: respuesta.usuario.nombreUsuario,
    entorno,
  };
}

/** Habitaciones en PENDIENTE_LIMPIEZA; el servidor ya filtra (RF-40). */
export async function obtenerPendientes(token: string): Promise<Habitacion[]> {
  return HabitacionSchema.array().parse(
    await llamar("GET", RUTAS.habitacionesPendientesLimpieza, token),
  );
}

/** CU-16: la habitación pasa a LIBRE. Se envía solo el id (decisión 18 de contracts). */
export async function marcarHabitacionLista(
  token: string,
  id: string,
): Promise<void> {
  await llamar("POST", conId(RUTAS.marcarHabitacionLista, id), token);
}

/** CU-17: la habitación pasa a MANTENIMIENTO. */
export async function reportarMantenimiento(
  token: string,
  id: string,
): Promise<void> {
  await llamar("POST", conId(RUTAS.reportarMantenimiento, id), token);
}
