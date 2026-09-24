import { RUTAS, RegistrarVentaEntradaSchema } from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registrarVentaServicio } from "../src/servicios/tienda.js";
import type { ContextoServicio } from "../src/servicios/contexto.js";
import { efectivo, prepararEntorno, type Entorno } from "./entorno.js";

// La venta todavía no tiene ruta HTTP; se prueba el servicio contra la base real.
let e: Entorno;
let ctx: ContextoServicio;

beforeEach(async () => {
  e = await prepararEntorno();
  const token = await e.login("cajero");
  await e.llamar("POST", RUTAS.abrirTurno, token, { efectivoInicial: 0 });
  await e.prisma.categoriaProducto.create({ data: { id: "cat-bebidas", nombre: "Bebidas" } });
  await e.prisma.producto.create({
    data: {
      id: "prod-gaseosa",
      categoriaId: "cat-bebidas",
      nombre: "Gaseosa",
      codigoBarras: "7750000000001",
      precioHuesped: 300,
      precioPublico: 350,
      controlaStock: true,
      stock: 10,
      activo: true,
    },
  });
  ctx = {
    prisma: e.prisma,
    usuario: { id: "usuario-cajero", nombreUsuario: "cajero", permisos: ["sales.sell", "store.manual_adjustment"] },
    ahora: e.reloj.ahora,
  };
});
afterEach(() => e.cerrar());

const venta = (esHuesped: boolean, habitacionReferenciaId: string | null, monto: number) =>
  RegistrarVentaEntradaSchema.parse({
    items: [{ productoId: "prod-gaseosa", cantidad: 2 }],
    esHuesped,
    habitacionReferenciaId,
    ajuste: null,
    pagos: [efectivo(monto)],
  });

describe("Venta en tienda con esHuesped explícito (RN-20, RN-22)", () => {
  it("a huésped cobra el precio de huésped, descuenta stock y registra el kardex", async () => {
    const { resultado: ticket } = await registrarVentaServicio(ctx, venta(true, "hab-107", 600), "clave-venta-1");
    expect(ticket).toMatchObject({ total: 600, origen: "VENTA_TIENDA", habitacionReferenciaId: "hab-107", alquilerId: null });
    expect((await e.prisma.producto.findUniqueOrThrow({ where: { id: "prod-gaseosa" } })).stock).toBe(8);
    expect(await e.prisma.movimientoInventario.findFirst({ where: { ticketId: ticket.id } })).toMatchObject({ tipo: "VENTA", cantidad: -2 });
  });

  it("a público cobra el precio de público, sin habitación (RN-24)", async () => {
    const { resultado: ticket } = await registrarVentaServicio(ctx, venta(false, null, 700), "clave-venta-2");
    expect(ticket.total).toBe(700);
  });

  it("el servidor no infiere huésped: sin alquiler en la habitación, respeta lo que indica el cajero", async () => {
    const { resultado: ticket } = await registrarVentaServicio(ctx, venta(true, null, 600), "clave-venta-3");
    expect(ticket.total).toBe(600);
  });

  it("stock insuficiente se rechaza sin tocar nada (RN-26)", async () => {
    await e.prisma.producto.update({ where: { id: "prod-gaseosa" }, data: { stock: 1 } });
    await expect(registrarVentaServicio(ctx, venta(false, null, 700), "clave-venta-4")).rejects.toMatchObject({
      codigo: "INSUFFICIENT_STOCK",
    });
    expect(await e.prisma.ticket.count()).toBe(0);
  });

  it("una venta a público asociada a una habitación no cumple el contrato", () => {
    expect(RegistrarVentaEntradaSchema.safeParse({ ...venta(false, null, 700), habitacionReferenciaId: "hab-107" }).success).toBe(false);
  });
});
