import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CABECERA_IDEMPOTENCIA, RUTAS, RegistrarIngresoRespuestaSchema, TicketSchema } from "@apurimeno/contracts";
import { componerLineasComprobante } from "@apurimeno/domain";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { construirApp } from "../../src/app.js";
import { comandosComprobante } from "../../src/impresion/escpos.js";
import { transporteArchivo, type TransporteImpresora } from "../../src/impresion/transporte.js";
import { CONTRASENA, efectivo, prepararEntorno, ruta, type Entorno } from "../entorno.js";

let e: Entorno;
let app: FastifyInstance;
let token: string;
let archivo: string;

async function levantar(impresora: TransporteImpresora | null) {
  app = await construirApp({ prisma: e.prisma, jwtSecret: "s".repeat(32), ahora: () => e.reloj.ahora, costoBcrypt: 4, impresora });
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
        datos: { nombreNegocio: "El Apurimeño", datosAdicionales: "Documento interno sin valor tributario" },
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
    await levantar({ descripcion: "impresora apagada", enviar: () => Promise.reject(new Error("sin papel")) });
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
