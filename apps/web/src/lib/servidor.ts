import {
  AuditoriaRespuestaSchema,
  ClienteSchema,
  ConfiguracionRespuestaSchema,
  EstadoEspejoSchema,
  GenerarCodigoAutorizacionRespuestaSchema,
  HabitacionSchema,
  LoginRespuestaSchema,
  MetodoPagoRespuestaSchema,
  PrecioEspecialRespuestaSchema,
  RUTAS,
  RangoRespuestaSchema,
  ReimpresionRespuestaSchema,
  ReporteArqueosSchema,
  ReporteOcupacionSchema,
  ReporteVentasSchema,
  RespuestaErrorSchema,
  SincronizacionEspejoRespuestaSchema,
  TableroSchema,
  TicketSchema,
  TurnoRespuestaSchema,
  UsuarioRespuestaSchema,
  type AuditoriaConsulta,
  type ClienteEntrada,
  type ConfiguracionGlobal,
  type CrearUsuarioEntrada,
  type EditarUsuarioEntrada,
  type ForzarCierreTurnoEntrada,
  type HabitacionEntrada,
  type MetodoPagoEntrada,
  type PeriodoConsulta,
  type RangoEntrada,
} from "@apurimeno/contracts";
import type { Sesion } from "./sesion";

// Cliente de la API para el Dashboard. Rutas, cuerpos y respuestas vienen de @apurimeno/contracts
// (Planos §16.1); toda respuesta se valida con su esquema.

/**
 * URL del servidor: `NEXT_PUBLIC_SERVIDOR_URL` (p. ej. http://192.168.1.50:3001). Sin ella, la misma máquina
 * que sirve el Dashboard, en el puerto 3001, como en la app de limpieza.
 */
export function urlServidor(): string {
  const configurada = process.env.NEXT_PUBLIC_SERVIDOR_URL;
  if (configurada !== undefined && configurada !== "")
    return configurada.replace(/\/+$/, "");
  return `${window.location.protocol}//${window.location.hostname}:3001`;
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
}

export function mensajeDe(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "No se pudo completar la operación.";
}

let alSesionInvalida: () => void = () => undefined;
export function registrarSesionInvalida(accion: () => void): void {
  alSesionInvalida = accion;
}

let sesionActual: Sesion | null = null;
export function usarSesion(sesion: Sesion | null): void {
  sesionActual = sesion;
}

type Metodo = "GET" | "POST" | "PUT" | "DELETE";
const SIN_CUERPO = { parse: (): void => undefined };

async function llamar<T>(
  metodo: Metodo,
  ruta: string,
  esquema: { parse: (datos: unknown) => T },
  cuerpo?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (sesionActual !== null)
    headers["authorization"] = `Bearer ${sesionActual.token}`;
  if (cuerpo !== undefined) headers["content-type"] = "application/json";
  let respuesta: Response;
  try {
    respuesta = await fetch(`${urlServidor()}${ruta}`, {
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
  const texto = await respuesta.text();
  const datos: unknown = texto === "" ? null : (JSON.parse(texto) as unknown);
  if (!respuesta.ok) {
    if (respuesta.status === 401 && sesionActual !== null) alSesionInvalida();
    const error = RespuestaErrorSchema.safeParse(datos);
    throw error.success
      ? new ErrorApi(respuesta.status, error.data.codigo, error.data.mensaje)
      : new ErrorApi(
          respuesta.status,
          null,
          `El servidor respondió con un error (${respuesta.status}).`,
        );
  }
  return esquema.parse(datos);
}

const conId = (plantilla: string, id: string) =>
  plantilla.replace(":id", encodeURIComponent(id));

/** Arma una query string con los valores definidos. */
function query(valores: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(valores))
    if (valor !== undefined && valor !== "") params.set(clave, String(valor));
  const q = params.toString();
  return q === "" ? "" : `?${q}`;
}

export const servidor = {
  login: (nombreUsuario: string, contrasena: string) =>
    llamar("POST", RUTAS.login, LoginRespuestaSchema, {
      nombreUsuario,
      contrasena,
    }),

  // Vista general
  tablero: () => llamar("GET", RUTAS.tablero, TableroSchema),
  turnosAbiertos: () =>
    llamar("GET", RUTAS.turnosAbiertos, TurnoRespuestaSchema.array()),
  forzarCierre: (turnoId: string, entrada: ForzarCierreTurnoEntrada) =>
    llamar(
      "POST",
      conId(RUTAS.forzarCierreTurno, turnoId),
      TurnoRespuestaSchema,
      entrada,
    ),

  // Reportes (§25)
  reporteVentas: (p: PeriodoConsulta) =>
    llamar("GET", `${RUTAS.reporteVentas}${query(p)}`, ReporteVentasSchema),
  reporteArqueos: (p: PeriodoConsulta) =>
    llamar("GET", `${RUTAS.reporteArqueos}${query(p)}`, ReporteArqueosSchema),
  reporteOcupacion: (p: PeriodoConsulta) =>
    llamar(
      "GET",
      `${RUTAS.reporteOcupacion}${query(p)}`,
      ReporteOcupacionSchema,
    ),

  // Habitaciones
  habitaciones: () =>
    llamar("GET", RUTAS.habitaciones, HabitacionSchema.array()),
  crearHabitacion: (e: HabitacionEntrada) =>
    llamar("POST", RUTAS.habitaciones, HabitacionSchema, e),
  editarHabitacion: (id: string, e: HabitacionEntrada) =>
    llamar("PUT", conId(RUTAS.habitacion, id), HabitacionSchema, e),
  bloquearHabitacion: (id: string, motivo: string) =>
    llamar("POST", conId(RUTAS.bloquearHabitacion, id), HabitacionSchema, {
      motivo,
    }),
  reactivarHabitacion: (id: string) =>
    llamar("POST", conId(RUTAS.reactivarHabitacion, id), HabitacionSchema),

  // Clientes y precios especiales
  buscarClientes: (q: string) =>
    llamar("GET", `${RUTAS.clientes}${query({ q })}`, ClienteSchema.array()),
  crearCliente: (e: ClienteEntrada) =>
    llamar("POST", RUTAS.clientes, ClienteSchema, e),
  editarCliente: (id: string, e: ClienteEntrada) =>
    llamar("PUT", conId(RUTAS.cliente, id), ClienteSchema, e),
  preciosEspeciales: (clienteId: string) =>
    llamar(
      "GET",
      conId(RUTAS.preciosEspecialesCliente, clienteId),
      PrecioEspecialRespuestaSchema.array(),
    ),
  crearPrecioEspecial: (
    clienteId: string,
    habitacionId: string,
    precio: number,
  ) =>
    llamar(
      "POST",
      conId(RUTAS.preciosEspecialesCliente, clienteId),
      PrecioEspecialRespuestaSchema,
      { habitacionId, precio },
    ),
  editarPrecioEspecial: (
    clienteId: string,
    habitacionId: string,
    precio: number,
  ) =>
    llamar(
      "PUT",
      conId(RUTAS.precioEspecialCliente, clienteId).replace(
        ":habitacionId",
        encodeURIComponent(habitacionId),
      ),
      PrecioEspecialRespuestaSchema,
      { precio },
    ),
  eliminarPrecioEspecial: (clienteId: string, habitacionId: string) =>
    llamar(
      "DELETE",
      conId(RUTAS.precioEspecialCliente, clienteId).replace(
        ":habitacionId",
        encodeURIComponent(habitacionId),
      ),
      SIN_CUERPO,
    ),

  // Usuarios y rangos
  usuarios: () => llamar("GET", RUTAS.usuarios, UsuarioRespuestaSchema.array()),
  crearUsuario: (e: CrearUsuarioEntrada) =>
    llamar("POST", RUTAS.usuarios, UsuarioRespuestaSchema, e),
  editarUsuario: (id: string, e: EditarUsuarioEntrada) =>
    llamar("PUT", conId(RUTAS.usuario, id), UsuarioRespuestaSchema, e),
  cambiarContrasena: (id: string, contrasena: string) =>
    llamar("PUT", conId(RUTAS.contrasenaUsuario, id), SIN_CUERPO, {
      contrasena,
    }),
  rangos: () => llamar("GET", RUTAS.rangos, RangoRespuestaSchema.array()),
  crearRango: (e: RangoEntrada) =>
    llamar("POST", RUTAS.rangos, RangoRespuestaSchema, e),
  editarRango: (id: string, e: RangoEntrada) =>
    llamar("PUT", conId(RUTAS.rango, id), RangoRespuestaSchema, e),

  // Configuración y métodos de pago
  configuracion: () =>
    llamar("GET", RUTAS.configuracion, ConfiguracionRespuestaSchema),
  cambiarConfiguracion: (c: ConfiguracionGlobal) =>
    llamar("PUT", RUTAS.configuracion, ConfiguracionRespuestaSchema, c),
  metodosPago: () =>
    llamar("GET", RUTAS.metodosPago, MetodoPagoRespuestaSchema.array()),
  crearMetodoPago: (e: MetodoPagoEntrada) =>
    llamar("POST", RUTAS.metodosPago, MetodoPagoRespuestaSchema, e),
  editarMetodoPago: (id: string, e: MetodoPagoEntrada) =>
    llamar("PUT", conId(RUTAS.metodoPago, id), MetodoPagoRespuestaSchema, e),

  // Auditoría y tickets
  auditoria: (c: Partial<AuditoriaConsulta>) =>
    llamar(
      "GET",
      `${RUTAS.auditoria}${query(c as Record<string, string | number | undefined>)}`,
      AuditoriaRespuestaSchema,
    ),
  tickets: (c: { numero?: number; desde?: string; hasta?: string }) =>
    llamar("GET", `${RUTAS.tickets}${query(c)}`, TicketSchema.array()),
  estadoEspejo: () => llamar("GET", RUTAS.estadoEspejo, EstadoEspejoSchema),
  /** Espera a que termine la vuelta: devuelve el resultado, o el error en `estado.ultimoError`. */
  sincronizarEspejo: (completo: boolean) =>
    llamar(
      "POST",
      RUTAS.sincronizarEspejo,
      SincronizacionEspejoRespuestaSchema,
      { completo },
    ),
  generarCodigoAutorizacion: () =>
    llamar(
      "POST",
      RUTAS.generarCodigoAutorizacion,
      GenerarCodigoAutorizacionRespuestaSchema,
    ),
  reimprimir: (ticketId: string) =>
    llamar(
      "POST",
      conId(RUTAS.reimprimirTicket, ticketId),
      ReimpresionRespuestaSchema,
    ),
};
