import { ClienteSchema, RUTAS, RegistrarIngresoRespuestaSchema, ReimpresionRespuestaSchema, TicketSchema } from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { efectivo, prepararEntorno, ruta, type Entorno } from "./entorno.js";

let e: Entorno;
let cajero: string;
let ticketId: string;

beforeEach(async () => {
  e = await prepararEntorno();
  cajero = await e.login("cajero");
  await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 });
  const cliente = ClienteSchema.parse((await e.llamar("POST", RUTAS.clientes, cajero, { documento: "45678912", nombre: "Juan Pérez" })).json());
  const r = await e.llamar(
    "POST",
    RUTAS.registrarIngreso,
    cajero,
    { habitacionId: "hab-205", clienteId: cliente.id, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000, 5000)] },
    "clave-reimp-1",
  );
  ticketId = RegistrarIngresoRespuestaSchema.parse(r.json()).ticket.id;
});
afterEach(() => e.cerrar());

describe("Reimpresión de comprobante (CU-22, RF-44)", () => {
  it("encola una copia visible como tal, sin datos del cliente, y queda auditada", async () => {
    const r = await e.llamar("POST", ruta(RUTAS.reimprimirTicket, ticketId), cajero);
    expect(r.statusCode).toBe(201);
    const { trabajo, contenido } = ReimpresionRespuestaSchema.parse(r.json());
    expect(trabajo).toMatchObject({ ticketId, estado: "PENDIENTE", esCopia: true });
    expect(contenido.map((l) => l.trim())).toEqual(
      expect.arrayContaining(["*** COPIA ***", "Documento interno sin valor tributario."]),
    );
    expect(contenido.every((l) => l.length <= 48)).toBe(true);
    const texto = contenido.join("\n");
    expect(texto).not.toMatch(/Juan|Pérez|45678912/);
    expect(texto).toMatch(/Vuelto\s+S\/ 10\.00/);

    expect(await e.prisma.trabajoImpresion.count({ where: { ticketId, esCopia: true } })).toBe(1);
    expect(await e.prisma.registroAuditoria.findFirst({ where: { accion: "COMPROBANTE_REIMPRESO", entidadId: ticketId } })).toMatchObject({
      usuarioId: "usuario-cajero",
      valorNuevo: { trabajoId: trabajo.id },
    });
  });

  it("ticket inexistente → 404; Limpieza no reimprime (tickets.reprint)", async () => {
    expect((await e.llamar("POST", ruta(RUTAS.reimprimirTicket, "ticket-x"), cajero)).statusCode).toBe(404);
    expect((await e.llamar("POST", ruta(RUTAS.reimprimirTicket, ticketId), await e.login("limpieza"))).statusCode).toBe(403);
  });
});

describe("Búsqueda de tickets para reimprimir (CU-22)", () => {
  it("por número exacto o por periodo, del más reciente al más antiguo", async () => {
    e.reloj.avanzarMinutos(30);
    const segundo = await e.llamar(
      "POST",
      RUTAS.registrarIngreso,
      cajero,
      { habitacionId: "hab-105", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
      "clave-reimp-2",
    );
    const numeroSegundo = RegistrarIngresoRespuestaSchema.parse(segundo.json()).ticket.numero;

    const porNumero = TicketSchema.array().parse((await e.llamar("GET", `${RUTAS.tickets}?numero=${numeroSegundo}`, cajero)).json());
    expect(porNumero.map((t) => t.numero)).toEqual([numeroSegundo]);

    const todos = TicketSchema.array().parse((await e.llamar("GET", RUTAS.tickets, cajero)).json());
    expect(todos.map((t) => t.numero)).toEqual([numeroSegundo, numeroSegundo - 1]);
    expect(todos.at(-1)?.id).toBe(ticketId);

    const periodo = `?desde=2026-09-23T14:00:00.000Z&hasta=2026-09-23T14:10:00.000Z`;
    expect(TicketSchema.array().parse((await e.llamar("GET", `${RUTAS.tickets}${periodo}`, cajero)).json()).map((t) => t.id)).toEqual([ticketId]);
  });

  it("filtros inválidos → 400; Limpieza no busca tickets", async () => {
    expect((await e.llamar("GET", `${RUTAS.tickets}?numero=abc`, cajero)).statusCode).toBe(400);
    expect((await e.llamar("GET", `${RUTAS.tickets}?limite=500`, cajero)).statusCode).toBe(400);
    expect((await e.llamar("GET", RUTAS.tickets, await e.login("limpieza"))).statusCode).toBe(403);
  });
});
