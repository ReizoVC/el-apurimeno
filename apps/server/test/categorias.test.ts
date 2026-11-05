import { CategoriaProductoSchema, RUTAS } from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepararEntorno, ruta, type Entorno } from "./entorno.js";

let e: Entorno;
let admin: string;

beforeEach(async () => {
  e = await prepararEntorno();
  admin = await e.login("admin");
  await e.prisma.categoriaProducto.createMany({
    data: [
      { id: "cat-snacks", nombre: "Snaks" },
      { id: "cat-bebidas", nombre: "Bebidas" },
    ],
  });
  await e.prisma.producto.createMany({
    data: ["activo", "inactivo"].map((estado) => ({
      id: `prod-${estado}`,
      categoriaId: "cat-snacks",
      nombre: `Producto ${estado}`,
      codigoBarras: null,
      precioHuesped: 100,
      precioPublico: 100,
      controlaStock: true,
      stock: 3,
      activo: estado === "activo",
    })),
  });
});
afterEach(() => e.cerrar());

const categoria = (id: string) => ruta(RUTAS.categoriaProducto, id);
const auditoria = (accion: "CATEGORIA_RENOMBRADA" | "CATEGORIA_ELIMINADA") =>
  e.prisma.registroAuditoria.findFirstOrThrow({ where: { accion } });

describe("Renombrar categoría", () => {
  it("cambia el nombre, conserva los productos y queda auditado", async () => {
    const r = await e.llamar("PUT", categoria("cat-snacks"), admin, { nombre: "Snacks" });
    expect(r.statusCode).toBe(200);
    expect(CategoriaProductoSchema.parse(r.json()).nombre).toBe("Snacks");
    expect(await e.prisma.producto.count({ where: { categoriaId: "cat-snacks" } })).toBe(2);
    expect(await auditoria("CATEGORIA_RENOMBRADA")).toMatchObject({ valorPrevio: { nombre: "Snaks" }, valorNuevo: { nombre: "Snacks" } });
  });

  it("rechaza un nombre repetido y una categoría que no existe", async () => {
    expect((await e.llamar("PUT", categoria("cat-snacks"), admin, { nombre: "Bebidas" })).statusCode).toBe(400);
    expect((await e.llamar("PUT", categoria("no-existe"), admin, { nombre: "Otra" })).statusCode).toBe(404);
  });

  it("exige inventory.manage", async () => {
    const cajero = await e.login("cajero");
    expect((await e.llamar("PUT", categoria("cat-snacks"), cajero, { nombre: "Otra" })).statusCode).toBe(403);
    expect((await e.llamar("DELETE", categoria("cat-bebidas"), cajero)).statusCode).toBe(403);
  });
});

describe("Eliminar categoría (decisión 28)", () => {
  it("elimina una vacía y queda auditado", async () => {
    expect((await e.llamar("DELETE", categoria("cat-bebidas"), admin)).statusCode).toBe(204);
    expect(await e.prisma.categoriaProducto.findUnique({ where: { id: "cat-bebidas" } })).toBeNull();
    expect(await auditoria("CATEGORIA_ELIMINADA")).toMatchObject({ valorNuevo: { productosMovidos: 0, movidosA: null } });
  });

  it("no elimina una con productos, ni siquiera inactivos, sin decir a dónde van", async () => {
    await e.prisma.producto.delete({ where: { id: "prod-activo" } });
    const r = await e.llamar("DELETE", categoria("cat-snacks"), admin);
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ mensaje: expect.stringContaining("1 producto") });
    expect(await e.prisma.categoriaProducto.count({ where: { id: "cat-snacks" } })).toBe(1);
  });

  it("con moverA pasa todos los productos a la otra y elimina", async () => {
    const r = await e.llamar("DELETE", `${categoria("cat-snacks")}?moverA=cat-bebidas`, admin);
    expect(r.statusCode).toBe(204);
    expect(await e.prisma.producto.count({ where: { categoriaId: "cat-bebidas" } })).toBe(2);
    expect(await e.prisma.categoriaProducto.findUnique({ where: { id: "cat-snacks" } })).toBeNull();
    expect(await auditoria("CATEGORIA_ELIMINADA")).toMatchObject({
      valorPrevio: { nombre: "Snaks" },
      valorNuevo: { productosMovidos: 2, movidosA: "Bebidas" },
    });
  });

  it("rechaza moverA igual a sí misma o inexistente, sin mover nada", async () => {
    expect((await e.llamar("DELETE", `${categoria("cat-snacks")}?moverA=cat-snacks`, admin)).statusCode).toBe(400);
    expect((await e.llamar("DELETE", `${categoria("cat-snacks")}?moverA=no-existe`, admin)).statusCode).toBe(404);
    expect(await e.prisma.producto.count({ where: { categoriaId: "cat-snacks" } })).toBe(2);
  });
});
