import {
  LIMITE_MOVIMIENTOS_INVENTARIO,
  MovimientoHistorialSchema,
  MovimientoStockRespuestaSchema,
  RUTAS,
  TicketSchema,
} from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { efectivo, prepararEntorno, ruta, type Entorno } from "./entorno.js";

let e: Entorno;
let admin: string;
let cajero: string;

const stock = async (id = "prod-gaseosa") => (await e.prisma.producto.findUniqueOrThrow({ where: { id } })).stock;
const salida = (cuerpo: unknown, token = admin, id = "prod-gaseosa") => e.llamar("POST", ruta(RUTAS.salidaStock, id), token, cuerpo);
const conteo = (cuerpo: unknown, token = admin, id = "prod-gaseosa") => e.llamar("POST", ruta(RUTAS.conteoStock, id), token, cuerpo);
const historial = async (consulta = "") => {
  const r = await e.llamar("GET", `${RUTAS.movimientosInventario}${consulta}`, admin);
  expect(r.statusCode).toBe(200);
  return MovimientoHistorialSchema.array().parse(r.json());
};
const venta = (cantidad: number, clave: string, confirmarSinStock?: boolean) =>
  e.llamar(
    "POST",
    RUTAS.registrarVenta,
    cajero,
    {
      items: [{ productoId: "prod-gaseosa", cantidad }],
      esHuesped: false,
      habitacionReferenciaId: null,
      ajuste: null,
      pagos: [efectivo(350 * cantidad)],
      ...(confirmarSinStock === undefined ? {} : { confirmarSinStock }),
    },
    clave,
  );

beforeEach(async () => {
  e = await prepararEntorno();
  admin = await e.login("admin");
  cajero = await e.login("cajero");
  await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 });
  await e.prisma.categoriaProducto.create({ data: { id: "cat-bebidas", nombre: "Bebidas" } });
  await e.prisma.producto.createMany({
    data: [
      { id: "prod-gaseosa", categoriaId: "cat-bebidas", nombre: "Gaseosa", codigoBarras: null, precioHuesped: 400, precioPublico: 350, controlaStock: true, stock: 10, activo: true },
      { id: "prod-agua", categoriaId: "cat-bebidas", nombre: "Agua", codigoBarras: null, precioHuesped: 200, precioPublico: 150, controlaStock: true, stock: 5, activo: true },
      { id: "prod-servicio", categoriaId: "cat-bebidas", nombre: "Lavado", codigoBarras: null, precioHuesped: 100, precioPublico: 100, controlaStock: false, stock: 0, activo: true },
    ],
  });
});
afterEach(() => e.cerrar());

describe("Salida de mercadería (decisión 29)", () => {
  it("resta, deja el kardex con motivo y queda auditada", async () => {
    const r = await salida({ cantidad: 3, motivo: " Vencido ", stockVisto: 10 });
    expect(r.statusCode).toBe(200);
    expect(MovimientoStockRespuestaSchema.parse(r.json())).toMatchObject({
      producto: { stock: 7 },
      movimiento: { tipo: "SALIDA", cantidad: -3, motivo: "Vencido", ticketId: null },
    });
    expect(await stock()).toBe(7);
    expect(await e.prisma.registroAuditoria.findFirstOrThrow({ where: { accion: "STOCK_SALIDA" } })).toMatchObject({
      motivo: "Vencido",
      valorPrevio: { stock: 10 },
      valorNuevo: { stock: 7, cantidad: -3 },
    });
  });

  it("sin motivo o por encima del stock se rechaza sin tocar nada", async () => {
    expect((await salida({ cantidad: 1, motivo: "  ", stockVisto: 10 })).json()).toMatchObject({ codigo: "REASON_REQUIRED" });
    expect((await salida({ cantidad: 11, motivo: "Dañado", stockVisto: 10 })).json()).toMatchObject({ codigo: "INSUFFICIENT_STOCK" });
    expect(await stock()).toBe(10);
    expect(await e.prisma.movimientoInventario.count()).toBe(0);
  });

  it("repetir la misma salida (doble clic) no resta dos veces", async () => {
    const cuerpo = { cantidad: 2, motivo: "Dañado", stockVisto: 10 };
    expect((await salida(cuerpo)).statusCode).toBe(200);
    const repetida = await salida(cuerpo);
    expect(repetida.statusCode).toBe(422);
    expect(repetida.json()).toMatchObject({ codigo: "INVALID_STATE_TRANSITION" });
    expect(await stock()).toBe(8);
  });

  it("un producto sin control de stock responde con error de negocio", async () => {
    const r = await salida({ cantidad: 1, motivo: "Dañado", stockVisto: 0 }, admin, "prod-servicio");
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: "INVALID_STATE_TRANSITION" });
  });
});

describe("Conteo físico (decisión 29)", () => {
  it("deja el stock en lo contado, guarda la diferencia y queda auditado", async () => {
    const r = await conteo({ contado: 7, nota: "Faltaban", stockVisto: 10 });
    expect(MovimientoStockRespuestaSchema.parse(r.json())).toMatchObject({
      producto: { stock: 7 },
      movimiento: { tipo: "CONTEO", cantidad: -3, motivo: "Faltaban" },
    });
    expect(await e.prisma.registroAuditoria.findFirstOrThrow({ where: { accion: "STOCK_CONTADO" } })).toMatchObject({
      valorPrevio: { stock: 10 },
      valorNuevo: { stock: 7, cantidad: -3 },
    });
  });

  it("sin diferencia también queda constancia", async () => {
    expect((await conteo({ contado: 10, nota: null, stockVisto: 10 })).statusCode).toBe(200);
    expect(await e.prisma.movimientoInventario.findFirstOrThrow()).toMatchObject({ tipo: "CONTEO", cantidad: 0, motivo: null });
  });

  it("una venta hecha mientras se contaba hace rechazar el conteo", async () => {
    expect((await venta(1, "clave-mientras-contaba")).statusCode).toBe(201);
    const r = await conteo({ contado: 10, nota: null, stockVisto: 10 });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: "INVALID_STATE_TRANSITION", mensaje: expect.stringContaining("cambió de 10 a 9") });
    expect(await stock()).toBe(9);
  });

  it("lo contado no puede ser negativo", async () => {
    expect((await conteo({ contado: -1, nota: null, stockVisto: 10 })).statusCode).toBe(400);
  });
});

describe("Permisos (decisión 29)", () => {
  it("salida, conteo e historial exigen inventory.manage", async () => {
    expect((await salida({ cantidad: 1, motivo: "Robo", stockVisto: 10 }, cajero)).statusCode).toBe(403);
    expect((await conteo({ contado: 1, nota: null, stockVisto: 10 }, cajero)).statusCode).toBe(403);
    expect((await e.llamar("GET", RUTAS.movimientosInventario, cajero)).statusCode).toBe(403);
    expect(await stock()).toBe(10);
  });
});

describe("Venta sin stock (decisión 29)", () => {
  it("una instalación nueva la permite, pero sin confirmar se rechaza", async () => {
    const r = await venta(11, "clave-sin-confirmar");
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: "INSUFFICIENT_STOCK", mensaje: expect.stringContaining("Confirme el aviso") });
    expect(await e.prisma.ticket.count()).toBe(0);
  });

  it("confirmada, se cobra, el stock queda negativo y queda auditada con el ticket", async () => {
    const r = await venta(12, "clave-confirmada", true);
    expect(r.statusCode).toBe(201);
    const ticket = TicketSchema.parse(r.json());
    expect(await stock()).toBe(-2);
    expect(await e.prisma.registroAuditoria.findFirstOrThrow({ where: { accion: "VENTA_SIN_STOCK" } })).toMatchObject({
      usuarioId: "usuario-cajero",
      entidadId: ticket.id,
      valorNuevo: { productos: [{ productoId: "prod-gaseosa", stockPrevio: 10, cantidad: 12 }] },
    });
  });

  it("rechazar sin confirmar no gasta la clave: confirmar con la misma clave cobra una sola vez", async () => {
    expect((await venta(11, "clave-reintento")).statusCode).toBe(422);
    expect((await venta(11, "clave-reintento", true)).statusCode).toBe(201);
    expect((await venta(11, "clave-reintento", true)).statusCode).toBe(200);
    expect(await e.prisma.ticket.count()).toBe(1);
    expect(await stock()).toBe(-1);
  });

  it("confirmar sin que falte stock no deja rastro de venta sin stock", async () => {
    expect((await venta(10, "clave-justa", true)).statusCode).toBe(201);
    expect(await e.prisma.registroAuditoria.count({ where: { accion: "VENTA_SIN_STOCK" } })).toBe(0);
  });

  it("con la configuración apagada, confirmar no alcanza", async () => {
    await e.prisma.configuracionGlobal.update({ where: { id: 1 }, data: { permitirStockNegativo: false } });
    const r = await venta(11, "clave-apagada", true);
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: "INSUFFICIENT_STOCK", mensaje: expect.stringContaining("desactivada") });
    expect(await stock()).toBe(10);
  });

  it("un conteo corrige el stock negativo", async () => {
    await venta(12, "clave-negativa", true);
    expect((await conteo({ contado: 0, nota: null, stockVisto: -2 })).statusCode).toBe(200);
    expect(await stock()).toBe(0);
  });
});

describe("Historial (decisión 29)", () => {
  it("del más nuevo al más viejo, con saldo, usuario, ticket y motivo", async () => {
    await e.llamar("POST", ruta(RUTAS.reponerProducto, "prod-gaseosa"), admin, { cantidad: 5 });
    e.reloj.avanzarMinutos(1);
    const ticket = TicketSchema.parse((await venta(3, "clave-historial")).json());
    e.reloj.avanzarMinutos(1);
    await salida({ cantidad: 2, motivo: "Dañado", stockVisto: 12 });
    e.reloj.avanzarMinutos(1);
    await conteo({ contado: 9, nota: null, stockVisto: 10 });

    const filas = await historial();
    expect(filas.map((f) => [f.movimiento.tipo, f.movimiento.cantidad, f.saldo])).toEqual([
      ["CONTEO", -1, 9],
      ["SALIDA", -2, 10],
      ["VENTA", -3, 12],
      ["REPOSICION", 5, 15],
    ]);
    expect(filas[1]).toMatchObject({ productoNombre: "Gaseosa", creadoPorNombre: "admin", ticketNumero: null, movimiento: { motivo: "Dañado" } });
    expect(filas[2]).toMatchObject({ creadoPorNombre: "cajero", ticketNumero: ticket.numero });
  });

  it("filtra por producto; sin filtro, cada producto lleva su propio saldo", async () => {
    await salida({ cantidad: 1, motivo: "Dañado", stockVisto: 10 });
    e.reloj.avanzarMinutos(1);
    await salida({ cantidad: 1, motivo: "Dañado", stockVisto: 5 }, admin, "prod-agua");
    e.reloj.avanzarMinutos(1);
    await salida({ cantidad: 1, motivo: "Dañado", stockVisto: 9 });

    const todos = await historial();
    expect(todos.map((f) => [f.productoNombre, f.saldo])).toEqual([
      ["Gaseosa", 8],
      ["Agua", 4],
      ["Gaseosa", 9],
    ]);
    const agua = await historial("?productoId=prod-agua");
    expect(agua.map((f) => f.saldo)).toEqual([4]);
  });

  it(`devuelve como máximo los últimos ${LIMITE_MOVIMIENTOS_INVENTARIO}`, async () => {
    await e.prisma.movimientoInventario.createMany({
      data: Array.from({ length: LIMITE_MOVIMIENTOS_INVENTARIO + 1 }, (_, i) => ({
        id: `mov-${i}`,
        productoId: "prod-agua",
        tipo: "REPOSICION" as const,
        cantidad: 1,
        creadoPorId: "usuario-cajero",
        creadoEn: new Date(e.reloj.ahora.getTime() + i * 1000),
      })),
    });
    const filas = await historial();
    expect(filas).toHaveLength(LIMITE_MOVIMIENTOS_INVENTARIO);
    expect(filas[0]?.movimiento.id).toBe(`mov-${LIMITE_MOVIMIENTOS_INVENTARIO}`);
  });
});
