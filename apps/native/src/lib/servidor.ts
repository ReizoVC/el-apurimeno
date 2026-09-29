import {
  AnularTicketRespuestaSchema,
  CABECERA_IDEMPOTENCIA,
  CategoriaProductoSchema,
  ClienteSchema,
  CotizacionHoraAdicionalRespuestaSchema,
  CotizacionIngresoRespuestaSchema,
  EstadoImpresoraSchema,
  LoginRespuestaSchema,
  MetodoPagoSchema,
  MovimientoCajaRespuestaSchema,
  ProductoSchema,
  RUTAS,
  RegistrarHoraAdicionalRespuestaSchema,
  RegistrarIngresoRespuestaSchema,
  RegistrarVentaRespuestaSchema,
  ReimpresionRespuestaSchema,
  RespuestaErrorSchema,
  SalidaRespuestaSchema,
  TableroSchema,
  TurnoActualRespuestaSchema,
  TurnoRespuestaSchema,
  type AnularTicketEntrada,
  type CerrarTurnoEntrada,
  type ClienteEntrada,
  type CotizarIngresoEntrada,
  type MovimientoCajaEntrada,
  type RegistrarHoraAdicionalEntrada,
  type RegistrarIngresoEntrada,
  type RegistrarVentaEntrada,
} from "@apurimeno/contracts";
import {
  entornoDeUsuario,
  urlCapacitacion,
  usuarioParaEnviar,
  type Entorno,
} from "@apurimeno/ui/lib/capacitacion";
import type { Sesion } from "./sesion";

// Cliente de la API del servidor para el POS. Rutas, cuerpos y respuestas vienen de @apurimeno/contracts
// (Planos §16.1): el POS no define tipos propios. Toda respuesta se valida con su esquema.

/**
 * URL del servidor: `VITE_SERVIDOR_URL` (p. ej. http://192.168.1.50:3001). Sin ella, `http://localhost:3001`:
 * en el local, el POS y el servidor corren en la misma máquina (Planos §4.3).
 *
 * En capacitación, el servidor de capacitación: `VITE_SERVIDOR_CAPACITACION_URL`, o el mismo equipo en el
 * puerto 3011.
 */
export function urlServidor(entorno: Entorno = "PRODUCCION"): string {
  const configurada = import.meta.env.VITE_SERVIDOR_URL as string | undefined;
  const produccion =
    configurada !== undefined && configurada !== ""
      ? configurada.replace(/\/+$/, "")
      : "http://localhost:3001";
  if (entorno === "PRODUCCION") return produccion;
  return urlCapacitacion(
    produccion,
    import.meta.env.VITE_SERVIDOR_CAPACITACION_URL as string | undefined,
  );
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

/** El POS registra aquí qué hacer cuando el servidor responde 401 (sesión vencida o cuenta desactivada). */
let alSesionInvalida: () => void = () => undefined;
export function registrarSesionInvalida(accion: () => void): void {
  alSesionInvalida = accion;
}

let sesionActual: Sesion | null = null;
export function usarSesion(sesion: Sesion | null): void {
  sesionActual = sesion;
}

interface Opciones {
  cuerpo?: unknown;
  /** Operaciones que cobran (RF-59): el mismo valor en cada reintento de la misma operación. */
  claveIdempotencia?: string;
  /** Solo el login, que todavía no tiene sesión: a qué servidor va. Después, el de la sesión. */
  entorno?: Entorno;
}

async function llamar<T>(
  metodo: "GET" | "POST",
  ruta: string,
  esquema: { parse: (datos: unknown) => T },
  { cuerpo, claveIdempotencia, entorno }: Opciones = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (sesionActual !== null)
    headers["authorization"] = `Bearer ${sesionActual.token}`;
  if (cuerpo !== undefined) headers["content-type"] = "application/json";
  if (claveIdempotencia !== undefined)
    headers[CABECERA_IDEMPOTENCIA] = claveIdempotencia;

  let respuesta: Response;
  try {
    const destino = entorno ?? sesionActual?.entorno ?? "PRODUCCION";
    respuesta = await fetch(`${urlServidor(destino)}${ruta}`, {
      method: metodo,
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi(
      0,
      null,
      "No se pudo conectar con el servidor. Revise que esté encendido y en la red.",
    );
  }

  const datos: unknown = await respuesta.json().catch(() => null);
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

export const servidor = {
  /**
   * La cuenta decide el servidor, antes de llamar a nada: las de capacitación ("capacitacion.…") van al de
   * capacitación; todas las demás, al del local.
   */
  login: (nombreUsuario: string, contrasena: string) =>
    llamar("POST", RUTAS.login, LoginRespuestaSchema, {
      cuerpo: { nombreUsuario: usuarioParaEnviar(nombreUsuario), contrasena },
      entorno: entornoDeUsuario(nombreUsuario),
    }),

  tablero: () => llamar("GET", RUTAS.tablero, TableroSchema),
  metodosPago: () => llamar("GET", RUTAS.metodosPago, MetodoPagoSchema.array()),

  // Turno y caja
  turnoActual: () =>
    llamar("GET", RUTAS.turnoActual, TurnoActualRespuestaSchema),
  abrirTurno: (efectivoInicial: number) =>
    llamar("POST", RUTAS.abrirTurno, TurnoRespuestaSchema, {
      cuerpo: { efectivoInicial },
    }),
  cerrarTurno: (entrada: CerrarTurnoEntrada) =>
    llamar("POST", RUTAS.cerrarTurno, TurnoRespuestaSchema, {
      cuerpo: entrada,
    }),
  registrarMovimiento: (entrada: MovimientoCajaEntrada, clave: string) =>
    llamar("POST", RUTAS.movimientosCaja, MovimientoCajaRespuestaSchema, {
      cuerpo: entrada,
      claveIdempotencia: clave,
    }),

  // Clientes
  buscarClientes: (q: string) =>
    llamar(
      "GET",
      `${RUTAS.clientes}?q=${encodeURIComponent(q)}`,
      ClienteSchema.array(),
    ),
  crearCliente: (entrada: ClienteEntrada) =>
    llamar("POST", RUTAS.clientes, ClienteSchema, { cuerpo: entrada }),

  // Alquileres
  cotizarIngreso: (entrada: CotizarIngresoEntrada) =>
    llamar("POST", RUTAS.cotizarIngreso, CotizacionIngresoRespuestaSchema, {
      cuerpo: entrada,
    }),
  registrarIngreso: (entrada: RegistrarIngresoEntrada, clave: string) =>
    llamar("POST", RUTAS.registrarIngreso, RegistrarIngresoRespuestaSchema, {
      cuerpo: entrada,
      claveIdempotencia: clave,
    }),
  cotizarHoraAdicional: (alquilerId: string) =>
    llamar(
      "GET",
      conId(RUTAS.cotizarHoraAdicional, alquilerId),
      CotizacionHoraAdicionalRespuestaSchema,
    ),
  registrarHoraAdicional: (
    alquilerId: string,
    entrada: RegistrarHoraAdicionalEntrada,
    clave: string,
  ) =>
    llamar(
      "POST",
      conId(RUTAS.registrarHoraAdicional, alquilerId),
      RegistrarHoraAdicionalRespuestaSchema,
      {
        cuerpo: entrada,
        claveIdempotencia: clave,
      },
    ),
  registrarSalida: (alquilerId: string) =>
    llamar(
      "POST",
      conId(RUTAS.registrarSalida, alquilerId),
      SalidaRespuestaSchema,
      { cuerpo: {} },
    ),
  registrarSalidaSinPago: (alquilerId: string, motivo: string) =>
    llamar(
      "POST",
      conId(RUTAS.registrarSalidaSinPago, alquilerId),
      SalidaRespuestaSchema,
      { cuerpo: { motivo } },
    ),

  // Tienda
  categorias: () =>
    llamar("GET", RUTAS.categoriasProducto, CategoriaProductoSchema.array()),
  productos: (codigoBarras?: string) =>
    llamar(
      "GET",
      codigoBarras === undefined
        ? RUTAS.productos
        : `${RUTAS.productos}?codigoBarras=${encodeURIComponent(codigoBarras)}`,
      ProductoSchema.array(),
    ),
  registrarVenta: (entrada: RegistrarVentaEntrada, clave: string) =>
    llamar("POST", RUTAS.registrarVenta, RegistrarVentaRespuestaSchema, {
      cuerpo: entrada,
      claveIdempotencia: clave,
    }),

  // Tickets
  anularTicket: (
    ticketId: string,
    entrada: AnularTicketEntrada,
    clave: string,
  ) =>
    llamar(
      "POST",
      conId(RUTAS.anularTicket, ticketId),
      AnularTicketRespuestaSchema,
      { cuerpo: entrada, claveIdempotencia: clave },
    ),
  reimprimir: (ticketId: string) =>
    llamar(
      "POST",
      conId(RUTAS.reimprimirTicket, ticketId),
      ReimpresionRespuestaSchema,
    ),

  // Impresora (RF-56): el servidor imprime; el POS solo muestra si algo falló y permite reintentar.
  estadoImpresora: () =>
    llamar("GET", RUTAS.estadoImpresora, EstadoImpresoraSchema),
  reintentarImpresion: () =>
    llamar("POST", RUTAS.reintentarImpresion, EstadoImpresoraSchema),
};
