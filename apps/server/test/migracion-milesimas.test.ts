import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

// Decisión 31 de contracts: la migración pasa a milésimas las cantidades que ya existían y deja la ficha nueva con
// valores por defecto. Se prueba sobre una base migrada hasta la versión anterior, con datos de esa versión.

const MIGRACIONES = fileURLToPath(new URL("../prisma/migrations", import.meta.url));
const carpetas = readdirSync(MIGRACIONES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const MILESIMAS = carpetas.find((c) => c.endsWith("_ficha_producto_milesimas"));
const aplicar = (db: Database.Database, carpeta: string) => db.exec(readFileSync(join(MIGRACIONES, carpeta, "migration.sql"), "utf8"));

let dir: string | null = null;
afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function baseAnterior(): Database.Database {
  dir = mkdtempSync(join(tmpdir(), "migracion-"));
  const db = new Database(join(dir, "anterior.db"));
  for (const carpeta of carpetas.filter((c) => MILESIMAS !== undefined && c < MILESIMAS)) aplicar(db, carpeta);
  // Filas sueltas, sin usuario, turno ni ticket: solo importa cómo cambian sus cantidades.
  db.pragma("foreign_keys = OFF");
  db.exec(`
    INSERT INTO "CategoriaProducto" ("id", "nombre") VALUES ('cat-1', 'Bebidas');
    INSERT INTO "Producto" ("id", "categoriaId", "nombre", "codigoBarras", "precioHuesped", "precioPublico", "controlaStock", "stock", "activo")
      VALUES ('prod-1', 'cat-1', 'Gaseosa', '775', 300, 350, 1, 7, 1);
    INSERT INTO "MovimientoInventario" ("id", "productoId", "tipo", "cantidad", "ticketId", "motivo", "creadoPorId", "creadoEn")
      VALUES ('m-1', 'prod-1', 'REPOSICION', 10, NULL, NULL, 'u-1', 0),
             ('m-2', 'prod-1', 'SALIDA', -3, NULL, 'Vencido', 'u-1', 0);
    INSERT INTO "LineaTicket" ("id", "ticketId", "posicion", "tipo", "descripcion", "cantidad", "precioUnitario", "importe", "productoId")
      VALUES ('l-1', 't-1', 0, 'BASE_HABITACION', 'Habitación 101 — 8 horas', 1, 3000, 3000, NULL),
             ('l-2', 't-1', 1, 'HORA_ADICIONAL', 'Horas adicionales', 2, 800, 1600, NULL),
             ('l-3', 't-2', 0, 'PRODUCTO', 'Gaseosa', 2, 350, 700, 'prod-1');
  `);
  return db;
}

describe("Migración: ficha de producto y cantidades en milésimas (decisión 31)", () => {
  it("la migración existe", () => {
    expect(MILESIMAS).toBeDefined();
  });

  it("multiplica por 1000 el stock, el kardex y las líneas, sin tocar importes ni precios", () => {
    const db = baseAnterior();
    aplicar(db, MILESIMAS ?? "");
    db.pragma("foreign_keys = OFF");
    expect(db.prepare(`SELECT "stock", "unidad", "sku", "costo", "stockMinimo", "codigoBarras", "precioPublico" FROM "Producto"`).get()).toEqual({
      stock: 7000,
      unidad: "UNIDAD",
      sku: null,
      costo: null,
      stockMinimo: null,
      codigoBarras: "775",
      precioPublico: 350,
    });
    expect(db.prepare(`SELECT "id", "cantidad", "motivoSalida", "motivo" FROM "MovimientoInventario" ORDER BY "id"`).all()).toEqual([
      { id: "m-1", cantidad: 10_000, motivoSalida: null, motivo: null },
      { id: "m-2", cantidad: -3000, motivoSalida: "OTRO", motivo: "Vencido" },
    ]);
    expect(db.prepare(`SELECT "id", "cantidad", "importe" FROM "LineaTicket" ORDER BY "id"`).all()).toEqual([
      { id: "l-1", cantidad: 1000, importe: 3000 },
      { id: "l-2", cantidad: 2000, importe: 1600 },
      { id: "l-3", cantidad: 2000, importe: 700 },
    ]);
    db.close();
  });
});
