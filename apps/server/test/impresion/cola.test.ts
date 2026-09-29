import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CABECERA_IDEMPOTENCIA, EstadoImpresoraSchema, RUTAS, RegistrarIngresoRespuestaSchema, TicketSchema } from "@apurimeno/contracts";
import { componerLineasComprobante } from "@apurimeno/domain";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { construirApp, type OpcionesApp } from "../../src/app.js";
import { comandosComprobante } from "../../src/impresion/escpos.js";
import { RESPUESTAS_TIPICAS } from "../../src/impresion/estado.js";
import { cargarLogo } from "../../src/impresion/logo.js";
import {
  conexionSimulada,
  transporteArchivo,
  transporteConEstado,
  type EstadoSimulado,
  type TransporteImpresora,
} from "../../src/impresion/transporte.js";
import { CONTRASENA, efectivo, prepararEntorno, ruta, type Entorno } from "../entorno.js";

let e: Entorno;
let app: FastifyInstance;
let token: string;
let archivo: string;

async function levantar(impresora: TransporteImpresora | null, extra: Partial<OpcionesApp> = {}) {
  app = await construirApp({
    prisma: e.prisma,
    jwtSecret: "s".repeat(32),
    ahora: () => e.reloj.ahora,
    costoBcrypt: 4,
    impresora,
    // Los reintentos de conexión esperan 2 y 5 s; aquí, 1 ms.
    esperasReintentoImpresionMs: [1, 1],
    ...extra,
  });
  const r = await app.inject({ method: "POST", url: RUTAS.login, payload: { nombreUsuario: "cajero", contrasena: CONTRASENA } });
  token = r.json<{ token: string }>().token;
  await llamar("POST", RUTAS.abrirTurno, { efectivoInicial: 0 });
}

function llamar(metodo: "POST" | "GET", url: string, payload?: object, clave?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (clave !== undefined) headers[CABECERA_IDEMPOTENCIA] = clave;
  return app.inject({ method: metodo, url, headers, ...(payload === undefined ? {} : { payload }) });
}

const ingreso = (clave: string) =>
  llamar(
    "POST",
    RUTAS.registrarIngreso,
    { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000, 5000)] },
    clave,
  );

const trabajos = (ticketId: string) => e.prisma.trabajoImpresion.findMany({ where: { ticketId }, orderBy: { creadoEn: "asc" } });

beforeEach(async () => {
  e = await prepararEntorno();
  archivo = join(mkdtempSync(join(tmpdir(), "impresora-")), "lp0");
});
afterEach(async () => {
  await app.close();
  await e.cerrar();
});

describe("Impresión en cada cobro (ADR-05, RF-56)", () => {
  it("el ingreso encola su comprobante original y lo envía: los bytes son los de la parte 1", async () => {
    await levantar(transporteArchivo(archivo));
    const r = await ingreso("clave-imp-1");
    expect(r.statusCode).toBe(201);
    const { ticket } = RegistrarIngresoRespuestaSchema.parse(r.json());
    await app.colaImpresion();

    expect(await trabajos(ticket.id)).toMatchObject([{ estado: "IMPRESO", esCopia: false }]);
    const esperado = comandosComprobante(
      componerLineasComprobante(ticket, {
        datos: { nombreNegocio: "El Apurimeño", datosAdicionales: "Gracias por su preferencia.", leyenda: "Documento interno sin valor tributario." },
        anchoPapelMm: 80,
        metodosPago: (await e.prisma.metodoPago.findMany()).map((m) => ({ ...m })),
        esCopia: false,
      }),
    );
    const escrito = readFileSync(archivo);
    expect(Buffer.from(esperado).equals(escrito)).toBe(true);
    expect(escrito.includes(Buffer.from([0x48, 0x61, 0x62, 0x69, 0x74, 0x61, 0x63, 0x69, 0xa2, 0x6e]))).toBe(true); // "Habitación" en PC850
  });

  it("la hora adicional y la venta también imprimen; un reintento idempotente no imprime dos veces", async () => {
    await levantar(transporteArchivo(archivo));
    const { alquiler, ticket: ticketIngreso } = RegistrarIngresoRespuestaSchema.parse((await ingreso("clave-imp-2")).json());
    await ingreso("clave-imp-2"); // reintento del mismo cobro
    const hora = await llamar("POST", ruta(RUTAS.registrarHoraAdicional, alquiler.id), { ajuste: null, pagos: [efectivo(800)] }, "clave-imp-3");
    const cat = await e.prisma.categoriaProducto.create({ data: { id: "cat-1", nombre: "Bebidas" } });
    await e.prisma.producto.create({
      data: { id: "p-1", categoriaId: cat.id, nombre: "Agua", codigoBarras: null, precioHuesped: 150, precioPublico: 200, controlaStock: false, stock: 0, activo: true },
    });
    const venta = await llamar(
      "POST",
      RUTAS.registrarVenta,
      { items: [{ productoId: "p-1", cantidad: 1 }], esHuesped: false, habitacionReferenciaId: null, ajuste: null, pagos: [efectivo(200)] },
      "clave-imp-4",
    );
    await app.colaImpresion();
    const todos = await e.prisma.trabajoImpresion.findMany();
    expect(todos).toHaveLength(3);
    expect(todos.every((t) => t.estado === "IMPRESO" && !t.esCopia)).toBe(true);
    expect(new Set(todos.map((t) => t.ticketId))).toEqual(
      new Set([ticketIngreso.id, hora.json<{ ticket: { id: string } }>().ticket.id, TicketSchema.parse(venta.json()).id]),
    );
    // Tres comprobantes, uno detrás de otro, cada uno con su corte.
    expect(readFileSync(archivo).toString("latin1").split("\x1dV\x01")).toHaveLength(4);
  });

  it("si la impresora falla, el cobro queda firme y el trabajo en ERROR (RF-56)", async () => {
    await levantar({ descripcion: "impresora apagada", enviar: () => Promise.reject(new Error("sin papel")), comprobar: () => Promise.resolve() });
    const r = await ingreso("clave-imp-5");
    expect(r.statusCode).toBe(201);
    const { ticket, habitacion } = RegistrarIngresoRespuestaSchema.parse(r.json());
    await app.colaImpresion();
    expect(habitacion.estado).toBe("OCUPADA");
    expect(await e.prisma.ticket.findUnique({ where: { id: ticket.id } })).not.toBeNull();
    expect(await trabajos(ticket.id)).toMatchObject([{ estado: "ERROR" }]);
  });

  it("sin impresora configurada, el comprobante queda en cola (PENDIENTE)", async () => {
    await levantar(null);
    const { ticket } = RegistrarIngresoRespuestaSchema.parse((await ingreso("clave-imp-6")).json());
    await app.colaImpresion();
    expect(await trabajos(ticket.id)).toMatchObject([{ estado: "PENDIENTE", esCopia: false }]);
    expect(existsSync(archivo)).toBe(false);
  });

  it("la reimpresión envía la copia, con COPIA a doble alto", async () => {
    await levantar(transporteArchivo(archivo));
    const { ticket } = RegistrarIngresoRespuestaSchema.parse((await ingreso("clave-imp-7")).json());
    await app.colaImpresion();
    await llamar("POST", ruta(RUTAS.reimprimirTicket, ticket.id));
    await app.colaImpresion();
    expect(await trabajos(ticket.id)).toMatchObject([
      { estado: "IMPRESO", esCopia: false },
      { estado: "IMPRESO", esCopia: true },
    ]);
    const texto = readFileSync(archivo).toString("latin1");
    expect(texto).toContain("\x1b\x45\x01\x1d\x21\x01                 *** COPIA ***\x1d\x21\x00\x1b\x45\x00\n");
    expect(texto.split("*** COPIA ***")).toHaveLength(2);
  });
});

/** Impresora simulada: responde DLE EOT según `estado` y, si imprime, escribe en `archivo`. Cuenta las aperturas. */
function simulada(estadoInicial: EstadoSimulado) {
  const s = { estado: estadoInicial, aperturas: 0 };
  const transporte = transporteConEstado("impresora simulada", () => {
    s.aperturas++;
    return conexionSimulada(archivo, () => s.estado);
  });
  return Object.assign(s, { transporte });
}

const estadoImpresora = async () => EstadoImpresoraSchema.parse((await llamar("GET", RUTAS.estadoImpresora)).json());
const escrito = () => (existsSync(archivo) ? readFileSync(archivo) : Buffer.alloc(0));

describe("Estados de la impresora: el cajero ve la causa, el cobro sigue firme (RF-56, decisión 26)", () => {
  it.each([
    ["sin papel", RESPUESTAS_TIPICAS.sinPapel, "PRINTER_OUT_OF_PAPER"],
    ["tapa abierta", RESPUESTAS_TIPICAS.tapaAbierta, "PRINTER_COVER_OPEN"],
    ["cabezal sobrecalentado", RESPUESTAS_TIPICAS.sobrecalentada, "PRINTER_OVERHEATED"],
    ["cuchilla trabada", RESPUESTAS_TIPICAS.cuchillaTrabada, "PRINTER_ERROR"],
  ] as const)("%s: no envía nada, el trabajo queda en ERROR y el estado lo dice", async (_, respuesta, causa) => {
    const impresora = simulada(respuesta);
    await levantar(impresora.transporte);
    const r = await ingreso("clave-estado-1");
    expect(r.statusCode).toBe(201);
    const { ticket } = RegistrarIngresoRespuestaSchema.parse(r.json());
    await app.colaImpresion();

    expect(await trabajos(ticket.id)).toMatchObject([{ estado: "ERROR" }]);
    expect(escrito()).toHaveLength(0);
    // Un problema que informa la impresora no se reintenta de inmediato: lo resuelve una persona.
    expect(impresora.aperturas).toBe(1);
    expect(await estadoImpresora()).toMatchObject({ configurada: true, causa, comprobantesEnEspera: 1 });
  });

  it("al resolverlo, 'reintentar ahora' imprime el comprobante pendiente y el aviso desaparece", async () => {
    const impresora = simulada(RESPUESTAS_TIPICAS.sinPapel);
    await levantar(impresora.transporte);
    const { ticket } = RegistrarIngresoRespuestaSchema.parse((await ingreso("clave-estado-2")).json());
    await app.colaImpresion();
    expect((await estadoImpresora()).causa).toBe("PRINTER_OUT_OF_PAPER");

    impresora.estado = RESPUESTAS_TIPICAS.lista; // el cajero puso un rollo nuevo
    const r = await llamar("POST", RUTAS.reintentarImpresion);
    expect(r.statusCode).toBe(200);
    expect(EstadoImpresoraSchema.parse(r.json())).toMatchObject({ causa: null, comprobantesEnEspera: 0 });
    expect(await trabajos(ticket.id)).toMatchObject([{ estado: "IMPRESO" }]);
    expect(escrito().toString("latin1")).toContain("Ticket ");
  });

  it("sin conexión: hasta 3 intentos; si vuelve en el tercero, imprime", async () => {
    const impresora = simulada("SIN_CONEXION");
    const original = impresora.transporte.enviar;
    impresora.transporte.enviar = async (bytes) => {
      if (impresora.aperturas === 2) impresora.estado = RESPUESTAS_TIPICAS.lista; // se reconectó el Bluetooth
      return original(bytes);
    };
    await levantar(impresora.transporte);
    const { ticket } = RegistrarIngresoRespuestaSchema.parse((await ingreso("clave-estado-3")).json());
    await app.colaImpresion();
    expect(impresora.aperturas).toBe(3);
    expect(await trabajos(ticket.id)).toMatchObject([{ estado: "IMPRESO" }]);
    expect((await estadoImpresora()).causa).toBeNull();
  });

  it("sin conexión los 3 intentos: ERROR y 'sin conexión' para el cajero", async () => {
    const impresora = simulada("SIN_CONEXION");
    await levantar(impresora.transporte);
    const { ticket } = RegistrarIngresoRespuestaSchema.parse((await ingreso("clave-estado-4")).json());
    await app.colaImpresion();
    expect(impresora.aperturas).toBe(3);
    expect(await trabajos(ticket.id)).toMatchObject([{ estado: "ERROR" }]);
    expect(await estadoImpresora()).toMatchObject({ causa: "PRINTER_DISCONNECTED", comprobantesEnEspera: 1 });
  });

  it("una impresora sin canal de vuelta (no responde DLE EOT) imprime igual", async () => {
    const impresora = simulada(null);
    await levantar(impresora.transporte);
    const { ticket } = RegistrarIngresoRespuestaSchema.parse((await ingreso("clave-estado-5")).json());
    await app.colaImpresion();
    expect(await trabajos(ticket.id)).toMatchObject([{ estado: "IMPRESO" }]);
    expect(escrito().length).toBeGreaterThan(0);
  });

  it("el reintento se detiene en el primer fallo y no toca los comprobantes de hace más de 15 minutos", async () => {
    const impresora = simulada(RESPUESTAS_TIPICAS.tapaAbierta);
    await levantar(impresora.transporte);
    const { alquiler, ticket: viejo } = RegistrarIngresoRespuestaSchema.parse((await ingreso("clave-estado-6")).json());
    await app.colaImpresion();
    e.reloj.avanzarMinutos(16);
    const hora = await llamar("POST", ruta(RUTAS.registrarHoraAdicional, alquiler.id), { ajuste: null, pagos: [efectivo(800)] }, "clave-estado-7");
    const nuevo = hora.json<{ ticket: { id: string } }>().ticket;
    await app.colaImpresion();
    expect(await estadoImpresora()).toMatchObject({ causa: "PRINTER_COVER_OPEN", comprobantesEnEspera: 1 });

    const antes = impresora.aperturas;
    await llamar("POST", RUTAS.reintentarImpresion);
    expect(impresora.aperturas - antes).toBe(1);

    impresora.estado = RESPUESTAS_TIPICAS.lista;
    await llamar("POST", RUTAS.reintentarImpresion);
    expect(await trabajos(nuevo.id)).toMatchObject([{ estado: "IMPRESO" }]);
    // El de hace 16 minutos queda en ERROR: si el cliente lo pide, se reimprime una copia (CU-22).
    expect(await trabajos(viejo.id)).toMatchObject([{ estado: "ERROR" }]);
    expect((await estadoImpresora()).comprobantesEnEspera).toBe(0);
  });

  it("dos comprobantes en espera: el reintento prueba una vez y, si sigue el problema, no insiste con el segundo", async () => {
    const impresora = simulada(RESPUESTAS_TIPICAS.sinPapel);
    await levantar(impresora.transporte);
    const { alquiler } = RegistrarIngresoRespuestaSchema.parse((await ingreso("clave-estado-8")).json());
    await llamar("POST", ruta(RUTAS.registrarHoraAdicional, alquiler.id), { ajuste: null, pagos: [efectivo(800)] }, "clave-estado-9");
    await app.colaImpresion();
    expect((await estadoImpresora()).comprobantesEnEspera).toBe(2);
    const antes = impresora.aperturas;
    await llamar("POST", RUTAS.reintentarImpresion);
    expect(impresora.aperturas - antes).toBe(1);
    expect(await e.prisma.trabajoImpresion.count({ where: { estado: "ERROR" } })).toBe(2);
  });

  it("el reintento automático, al arrancar, toma enseguida lo que quedó pendiente", async () => {
    const impresora = simulada(RESPUESTAS_TIPICAS.sinPapel);
    await levantar(impresora.transporte);
    const { ticket } = RegistrarIngresoRespuestaSchema.parse((await ingreso("clave-estado-11")).json());
    await app.colaImpresion();
    impresora.estado = RESPUESTAS_TIPICAS.lista;
    app.impresion.iniciar();
    await app.colaImpresion();
    expect(await trabajos(ticket.id)).toMatchObject([{ estado: "IMPRESO" }]);
    app.impresion.detener();
  });

  it("sin comprobantes en espera, 'reintentar ahora' solo comprueba la impresora, sin imprimir", async () => {
    const impresora = simulada(RESPUESTAS_TIPICAS.sobrecalentada);
    await levantar(impresora.transporte);
    expect((await estadoImpresora()).ultimoIntento).toBeNull();
    expect(EstadoImpresoraSchema.parse((await llamar("POST", RUTAS.reintentarImpresion)).json()).causa).toBe("PRINTER_OVERHEATED");
    impresora.estado = RESPUESTAS_TIPICAS.lista;
    expect(EstadoImpresoraSchema.parse((await llamar("POST", RUTAS.reintentarImpresion)).json()).causa).toBeNull();
    expect(escrito()).toHaveLength(0);
  });

  it("sin impresora configurada, el estado lo dice y no hay causa", async () => {
    await levantar(null);
    await ingreso("clave-estado-10");
    await app.colaImpresion();
    expect(await estadoImpresora()).toMatchObject({ configurada: false, causa: null });
  });

  it("el estado lo consulta quien usa el POS; reintentar, quien reimprime; limpieza, ninguno", async () => {
    await levantar(null);
    const login = await app.inject({ method: "POST", url: RUTAS.login, payload: { nombreUsuario: "limpieza", contrasena: CONTRASENA } });
    const headers = { authorization: `Bearer ${login.json<{ token: string }>().token}` };
    expect((await app.inject({ method: "GET", url: RUTAS.estadoImpresora, headers })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: RUTAS.reintentarImpresion, headers })).statusCode).toBe(403);
    expect((await llamar("GET", RUTAS.estadoImpresora)).statusCode).toBe(200);
    expect((await llamar("POST", RUTAS.reintentarImpresion)).statusCode).toBe(200);
  });
});

describe("Logotipo en el comprobante impreso", () => {
  it("cada comprobante empieza con el logotipo centrado y el nombre del negocio debajo, en fuente A", async () => {
    const logo = cargarLogo(undefined);
    await levantar(transporteArchivo(archivo), { logo });
    const { ticket } = RegistrarIngresoRespuestaSchema.parse((await ingreso("clave-logo-1")).json());
    await app.colaImpresion();
    const bytes = readFileSync(archivo);
    // ESC @, ESC t 2, ESC M 0, ESC a 1, GS v 0 0 (28 bytes por fila) (195 filas), 5460 bytes de imagen, ESC a 0, ESC J 8.
    expect(bytes.subarray(0, 19).toString("hex")).toBe("1b401b74021b4d001b61011d7630001c00c300");
    expect(bytes.subarray(19, 19 + 5460).equals(Buffer.from(logo?.datos ?? []))).toBe(true);
    expect(bytes.subarray(19 + 5460, 19 + 5460 + 6).toString("hex")).toBe("1b61001b4a08");
    // El nombre de la semilla, centrado en 48 columnas, en negrita ("ñ" = A4 en PC850).
    const nombre = bytes.subarray(19 + 5466, bytes.indexOf(0x0a, 19 + 5466) + 1);
    expect(nombre.toString("latin1")).toBe(`\x1bE\x01${" ".repeat(18)}El Apurime\xa4o\x1bE\x00\n`);
    expect(await trabajos(ticket.id)).toMatchObject([{ estado: "IMPRESO" }]);
  });

  it("en papel de 58 mm, un logotipo más ancho que el papel se omite y el comprobante sale igual", async () => {
    await e.prisma.configuracionGlobal.update({ where: { id: 1 }, data: { impresora: { anchoPapelMm: 58, conexion: "USB" } } });
    const ancho = { ancho: 400, alto: 2, bytesPorFila: 50, datos: new Uint8Array(100).fill(0xff) };
    await levantar(transporteArchivo(archivo), { logo: ancho });
    await ingreso("clave-logo-2");
    await app.colaImpresion();
    expect(readFileSync(archivo).includes(Buffer.from([0x1d, 0x76, 0x30]))).toBe(false);
    expect(readFileSync(archivo).toString("latin1")).toContain("El Apurime");
  });
});
