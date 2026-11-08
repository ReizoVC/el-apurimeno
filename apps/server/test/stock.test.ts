import {
  LIMITE_MOVIMIENTOS_INVENTARIO,
  MovimientoHistorialSchema,
  MovimientoStockRespuestaSchema,
  ProductoSchema,
  RUTAS,
  TicketSchema,
} from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { efectivo, prepararEntorno, ruta, type Entorno } from "./entorno.js";

// Cantidades y stock en milésimas (decisión 31 de contracts): `u(3)` = 3 unidades = 3000.
const u = (unidades: number) => unidades * 1000;

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
const venta = (unidades: number, clave: string, confirmarSinStock?: boolean) =>
  e.llamar(
    "POST",
    RUTAS.registrarVenta,
    cajero,
    {
      items: [{ productoId: "prod-gaseosa", cantidadMilesimas: u(unidades) }],
      esHuesped: false,
      habitacionReferenciaId: null,
      ajuste: null,
      pagos: [efectivo(350 * unidades)],
      ...(confirmarSinStock === undefined ? {} : { confirmarSinStock }),
    },
    clave,
  );

const base = { categoriaId: "cat-bebidas", sku: null, codigoBarras: null, unidad: "UNIDAD" as const, costo: null, stockMinimo: null, stockOptimo: null, activo: true };

beforeEach(async () => {
  e = await prepararEntorno();
  admin = await e.login("admin");
  cajero = await e.login("cajero");
  await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 });
  await e.prisma.categoriaProducto.create({ data: { id: "cat-bebidas", nombre: "Bebidas" } });
  await e.prisma.producto.createMany({
    data: [
      { ...base, id: "prod-gaseosa", nombre: "Gaseosa", precioHuesped: 400, precioPublico: 350, costo: 220, controlaStock: true, stock: u(10) },
      { ...base, id: "prod-agua", nombre: "Agua", precioHuesped: 200, precioPublico: 150, controlaStock: true, stock: u(5) },
      { ...base, id: "prod-servicio", nombre: "Lavado", precioHuesped: 100, precioPublico: 100, controlaStock: false, stock: 0 },
      { ...base, id: "prod-cable", nombre: "Cable mellizo", unidad: "METRO", precioHuesped: 300, precioPublico: 300, controlaStock: true, stock: u(20) },
    ],
  });
});
afterEach(() => e.cerrar());

describe("Salida de mercadería (decisiones 29 y 31)", () => {
  it("resta con su motivo fijo, deja el kardex y queda auditada", async () => {
    const r = await salida({ cantidad: u(3), motivoSalida: "VENCIDO", motivo: " Lote de agosto ", stockVisto: u(10) });
    expect(r.statusCode).toBe(200);
    expect(MovimientoStockRespuestaSchema.parse(r.json())).toMatchObject({
      producto: { stock: u(7) },
      movimiento: { tipo: "SALIDA", cantidad: -u(3), motivoSalida: "VENCIDO", motivo: "Lote de agosto", ticketId: null },
    });
    expect(await stock()).toBe(u(7));
    expect(await e.prisma.registroAuditoria.findFirstOrThrow({ where: { accion: "STOCK_SALIDA" } })).toMatchObject({
      motivo: "VENCIDO: Lote de agosto",
      valorPrevio: { stock: u(10) },
      valorNuevo: { stock: u(7), cantidad: -u(3), motivoSalida: "VENCIDO" },
    });
  });

  it("sin detalle basta el motivo fijo; OTRO sin detalle o por encima del stock se rechaza sin tocar nada", async () => {
    expect((await salida({ cantidad: u(1), motivoSalida: "OTRO", motivo: "  ", stockVisto: u(10) })).json()).toMatchObject({ codigo: "REASON_REQUIRED" });
    expect((await salida({ cantidad: u(11), motivoSalida: "DANADO", motivo: null, stockVisto: u(10) })).json()).toMatchObject({ codigo: "INSUFFICIENT_STOCK" });
    expect((await salida({ cantidad: u(1), motivoSalida: "ROBO", motivo: null, stockVisto: u(10) })).statusCode).toBe(400);
    expect(await stock()).toBe(u(10));
    expect(await e.prisma.movimientoInventario.count()).toBe(0);
    const r = await salida({ cantidad: u(1), motivoSalida: "DANADO", motivo: null, stockVisto: u(10) });
    expect(r.statusCode).toBe(200);
    expect(await e.prisma.registroAuditoria.findFirstOrThrow({ where: { accion: "STOCK_SALIDA" } })).toMatchObject({ motivo: "DANADO" });
  });

  it("repetir la misma salida (doble clic) no resta dos veces", async () => {
    const cuerpo = { cantidad: u(2), motivoSalida: "DANADO", motivo: null, stockVisto: u(10) };
    expect((await salida(cuerpo)).statusCode).toBe(200);
    const repetida = await salida(cuerpo);
    expect(repetida.statusCode).toBe(422);
    expect(repetida.json()).toMatchObject({ codigo: "INVALID_STATE_TRANSITION" });
    expect(await stock()).toBe(u(8));
  });

  it("un producto sin control de stock responde con error de negocio", async () => {
    const r = await salida({ cantidad: u(1), motivoSalida: "DANADO", motivo: null, stockVisto: 0 }, admin, "prod-servicio");
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: "INVALID_STATE_TRANSITION" });
  });

  it("de un producto por unidad no salen fracciones; de uno por metro, sí", async () => {
    expect((await salida({ cantidad: 1500, motivoSalida: "DANADO", motivo: null, stockVisto: u(10) })).json()).toMatchObject({ codigo: "INVALID_QUANTITY" });
    const r = await salida({ cantidad: 1250, motivoSalida: "CONSUMO_INTERNO", motivo: null, stockVisto: u(20) }, admin, "prod-cable");
    expect(r.statusCode).toBe(200);
    expect(await stock("prod-cable")).toBe(18_750);
  });
});

describe("Conteo físico (decisión 29)", () => {
  it("deja el stock en lo contado, guarda la diferencia y queda auditado", async () => {
    const r = await conteo({ contado: u(7), nota: "Faltaban", stockVisto: u(10) });
    expect(MovimientoStockRespuestaSchema.parse(r.json())).toMatchObject({
      producto: { stock: u(7) },
      movimiento: { tipo: "CONTEO", cantidad: -u(3), motivo: "Faltaban", motivoSalida: null },
    });
    expect(await e.prisma.registroAuditoria.findFirstOrThrow({ where: { accion: "STOCK_CONTADO" } })).toMatchObject({
      valorPrevio: { stock: u(10) },
      valorNuevo: { stock: u(7), cantidad: -u(3) },
    });
  });

  it("sin diferencia también queda constancia", async () => {
    expect((await conteo({ contado: u(10), nota: null, stockVisto: u(10) })).statusCode).toBe(200);
    expect(await e.prisma.movimientoInventario.findFirstOrThrow()).toMatchObject({ tipo: "CONTEO", cantidad: 0, motivo: null });
  });

  it("una venta hecha mientras se contaba hace rechazar el conteo", async () => {
    expect((await venta(1, "clave-mientras-contaba")).statusCode).toBe(201);
    const r = await conteo({ contado: u(10), nota: null, stockVisto: u(10) });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: "INVALID_STATE_TRANSITION", mensaje: expect.stringContaining("cambió de 10 a 9") });
    expect(await stock()).toBe(u(9));
  });

  it("cuenta metros con decimales y muestra la unidad si el stock cambió", async () => {
    expect((await conteo({ contado: 12_750, nota: null, stockVisto: u(20) }, admin, "prod-cable")).statusCode).toBe(200);
    expect(await stock("prod-cable")).toBe(12_750);
    const viejo = await conteo({ contado: u(12), nota: null, stockVisto: u(20) }, admin, "prod-cable");
    expect(viejo.json()).toMatchObject({ mensaje: expect.stringContaining("cambió de 20 m a 12.75 m") });
  });

  it("lo contado no puede ser negativo", async () => {
    expect((await conteo({ contado: -1, nota: null, stockVisto: u(10) })).statusCode).toBe(400);
  });
});

describe("Permisos (decisión 29)", () => {
  it("salida, conteo e historial exigen inventory.manage", async () => {
    expect((await salida({ cantidad: u(1), motivoSalida: "PERDIDA", motivo: null, stockVisto: u(10) }, cajero)).statusCode).toBe(403);
    expect((await conteo({ contado: u(1), nota: null, stockVisto: u(10) }, cajero)).statusCode).toBe(403);
    expect((await e.llamar("GET", RUTAS.movimientosInventario, cajero)).statusCode).toBe(403);
    expect(await stock()).toBe(u(10));
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
    expect(await stock()).toBe(-u(2));
    expect(await e.prisma.registroAuditoria.findFirstOrThrow({ where: { accion: "VENTA_SIN_STOCK" } })).toMatchObject({
      usuarioId: "usuario-cajero",
      entidadId: ticket.id,
      valorNuevo: { productos: [{ productoId: "prod-gaseosa", stockPrevio: u(10), cantidad: u(12) }] },
    });
  });

  it("rechazar sin confirmar no gasta la clave: confirmar con la misma clave cobra una sola vez", async () => {
    expect((await venta(11, "clave-reintento")).statusCode).toBe(422);
    expect((await venta(11, "clave-reintento", true)).statusCode).toBe(201);
    expect((await venta(11, "clave-reintento", true)).statusCode).toBe(200);
    expect(await e.prisma.ticket.count()).toBe(1);
    expect(await stock()).toBe(-u(1));
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
    expect(await stock()).toBe(u(10));
  });

  it("un conteo corrige el stock negativo", async () => {
    await venta(12, "clave-negativa", true);
    expect((await conteo({ contado: 0, nota: null, stockVisto: -u(2) })).statusCode).toBe(200);
    expect(await stock()).toBe(0);
  });
});

describe("Venta por metro y ficha del producto (decisión 31)", () => {
  it("vende 2,5 m a S/ 3.00 el metro: S/ 7.50, con la unidad en la línea", async () => {
    const r = await e.llamar(
      "POST",
      RUTAS.registrarVenta,
      cajero,
      { items: [{ productoId: "prod-cable", cantidadMilesimas: 2500 }], esHuesped: false, habitacionReferenciaId: null, ajuste: null, pagos: [efectivo(750)] },
      "clave-cable",
    );
    expect(r.statusCode).toBe(201);
    expect(TicketSchema.parse(r.json())).toMatchObject({
      total: 750,
      lineas: [{ descripcion: "Cable mellizo (m)", cantidad: 2500, precioUnitario: 300, importe: 750 }],
    });
    expect(await stock("prod-cable")).toBe(17_500);
  });

  it("un POS anterior, que envía `cantidad` en unidades, es rechazado por el contrato", async () => {
    const r = await e.llamar(
      "POST",
      RUTAS.registrarVenta,
      cajero,
      { items: [{ productoId: "prod-gaseosa", cantidad: 2 }], esHuesped: false, habitacionReferenciaId: null, ajuste: null, pagos: [efectivo(700)] },
      "clave-pos-viejo",
    );
    expect(r.statusCode).toBe(400);
    expect(await stock()).toBe(u(10));
  });

  it("una fracción de un producto por unidad responde INVALID_QUANTITY", async () => {
    const r = await e.llamar(
      "POST",
      RUTAS.registrarVenta,
      cajero,
      { items: [{ productoId: "prod-gaseosa", cantidadMilesimas: 1500 }], esHuesped: false, habitacionReferenciaId: null, ajuste: null, pagos: [efectivo(525)] },
      "clave-fraccion",
    );
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: "INVALID_QUANTITY" });
  });

  it("el costo lo ve quien gestiona el inventario; el cajero recibe null", async () => {
    const delAdmin = ProductoSchema.array().parse((await e.llamar("GET", RUTAS.productos, admin)).json());
    const delCajero = ProductoSchema.array().parse((await e.llamar("GET", RUTAS.productos, cajero)).json());
    expect(delAdmin.find((p) => p.id === "prod-gaseosa")?.costo).toBe(220);
    expect(delCajero.find((p) => p.id === "prod-gaseosa")?.costo).toBeNull();
  });

  const ficha = (extra: Record<string, unknown> = {}) => ({
    categoriaId: "cat-bebidas", nombre: "Gaseosa", sku: null, codigoBarras: null, unidad: "UNIDAD", precioHuesped: 400, precioPublico: 350,
    costo: 220, controlaStock: true, stockMinimo: null, stockOptimo: null, activo: true, ...extra,
  });

  it("guarda SKU, costo y mínimos; el SKU es único y un producto por unidad lleva mínimos enteros", async () => {
    const r = await e.llamar("PUT", ruta(RUTAS.producto, "prod-gaseosa"), admin, ficha({ sku: "10001", stockMinimo: u(6), stockOptimo: u(24) }));
    expect(ProductoSchema.parse(r.json())).toMatchObject({ sku: "10001", stockMinimo: u(6), stockOptimo: u(24), stock: u(10) });
    const repetido = await e.llamar("PUT", ruta(RUTAS.producto, "prod-agua"), admin, ficha({ nombre: "Agua", sku: "10001" }));
    expect(repetido.statusCode).toBe(400);
    expect(repetido.json()).toMatchObject({ mensaje: expect.stringContaining("Gaseosa") });
    expect((await e.llamar("PUT", ruta(RUTAS.producto, "prod-gaseosa"), admin, ficha({ stockMinimo: 1500 }))).statusCode).toBe(400);
    expect((await e.llamar("PUT", ruta(RUTAS.producto, "prod-gaseosa"), admin, ficha({ stockMinimo: u(6), stockOptimo: u(2) }))).statusCode).toBe(400);
  });

  it("la unidad solo cambia mientras el producto no tenga movimientos ni ventas", async () => {
    expect((await e.llamar("PUT", ruta(RUTAS.producto, "prod-agua"), admin, ficha({ nombre: "Agua", unidad: "LITRO" }))).statusCode).toBe(200);
    await venta(1, "clave-antes-de-cambiar");
    const r = await e.llamar("PUT", ruta(RUTAS.producto, "prod-gaseosa"), admin, ficha({ unidad: "LITRO" }));
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ mensaje: expect.stringContaining("ya tiene movimientos o ventas") });
  });
});

describe("Historial (decisión 29)", () => {
  it("del más nuevo al más viejo, con saldo, unidad, usuario, ticket y motivo", async () => {
    await e.llamar("POST", ruta(RUTAS.reponerProducto, "prod-gaseosa"), admin, { cantidad: u(5) });
    e.reloj.avanzarMinutos(1);
    const ticket = TicketSchema.parse((await venta(3, "clave-historial")).json());
    e.reloj.avanzarMinutos(1);
    await salida({ cantidad: u(2), motivoSalida: "DANADO", motivo: null, stockVisto: u(12) });
    e.reloj.avanzarMinutos(1);
    await conteo({ contado: u(9), nota: null, stockVisto: u(10) });

    const filas = await historial();
    expect(filas.map((f) => [f.movimiento.tipo, f.movimiento.cantidad, f.saldo])).toEqual([
      ["CONTEO", -u(1), u(9)],
      ["SALIDA", -u(2), u(10)],
      ["VENTA", -u(3), u(12)],
      ["REPOSICION", u(5), u(15)],
    ]);
    expect(filas[1]).toMatchObject({ productoNombre: "Gaseosa", unidad: "UNIDAD", creadoPorNombre: "admin", ticketNumero: null, movimiento: { motivoSalida: "DANADO" } });
    expect(filas[2]).toMatchObject({ creadoPorNombre: "cajero", ticketNumero: ticket.numero });
  });

  it("filtra por producto; sin filtro, cada producto lleva su propio saldo", async () => {
    await salida({ cantidad: u(1), motivoSalida: "DANADO", motivo: null, stockVisto: u(10) });
    e.reloj.avanzarMinutos(1);
    await salida({ cantidad: u(1), motivoSalida: "DANADO", motivo: null, stockVisto: u(5) }, admin, "prod-agua");
    e.reloj.avanzarMinutos(1);
    await salida({ cantidad: u(1), motivoSalida: "DANADO", motivo: null, stockVisto: u(9) });

    const todos = await historial();
    expect(todos.map((f) => [f.productoNombre, f.saldo])).toEqual([
      ["Gaseosa", u(8)],
      ["Agua", u(4)],
      ["Gaseosa", u(9)],
    ]);
    const agua = await historial("?productoId=prod-agua");
    expect(agua.map((f) => f.saldo)).toEqual([u(4)]);
  });

  it(`devuelve como máximo los últimos ${LIMITE_MOVIMIENTOS_INVENTARIO}`, async () => {
    await e.prisma.movimientoInventario.createMany({
      data: Array.from({ length: LIMITE_MOVIMIENTOS_INVENTARIO + 1 }, (_, i) => ({
        id: `mov-${i}`,
        productoId: "prod-agua",
        tipo: "REPOSICION" as const,
        cantidad: u(1),
        creadoPorId: "usuario-cajero",
        creadoEn: new Date(e.reloj.ahora.getTime() + i * 1000),
      })),
    });
    const filas = await historial();
    expect(filas).toHaveLength(LIMITE_MOVIMIENTOS_INVENTARIO);
    expect(filas[0]?.movimiento.id).toBe(`mov-${LIMITE_MOVIMIENTOS_INVENTARIO}`);
  });
});
