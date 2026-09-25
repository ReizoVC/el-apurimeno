import { ClienteSchema, RUTAS, RegistrarIngresoRespuestaSchema, ReimpresionRespuestaSchema } from "@apurimeno/contracts";
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
