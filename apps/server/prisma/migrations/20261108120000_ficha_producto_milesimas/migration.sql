-- Decisión 31 de contracts: ficha de producto (SKU, unidad, costo, mínimos), motivo fijo de las salidas, y
-- cantidades en milésimas de la unidad. Las cantidades existentes eran unidades enteras: se multiplican por 1000.
-- Lo que ya quedó en la auditoría (valorPrevio / valorNuevo) conserva las cantidades de entonces, en unidades.

-- AlterTable
ALTER TABLE "MovimientoInventario" ADD COLUMN "motivoSalida" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Producto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoriaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "sku" TEXT,
    "codigoBarras" TEXT,
    "unidad" TEXT NOT NULL DEFAULT 'UNIDAD',
    "precioHuesped" INTEGER NOT NULL,
    "precioPublico" INTEGER NOT NULL,
    "costo" INTEGER,
    "controlaStock" BOOLEAN NOT NULL,
    "stock" INTEGER NOT NULL,
    "stockMinimo" INTEGER,
    "stockOptimo" INTEGER,
    "activo" BOOLEAN NOT NULL,
    CONSTRAINT "Producto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaProducto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Producto" ("activo", "categoriaId", "codigoBarras", "controlaStock", "id", "nombre", "precioHuesped", "precioPublico", "stock") SELECT "activo", "categoriaId", "codigoBarras", "controlaStock", "id", "nombre", "precioHuesped", "precioPublico", "stock" * 1000 FROM "Producto";
DROP TABLE "Producto";
ALTER TABLE "new_Producto" RENAME TO "Producto";
CREATE UNIQUE INDEX "Producto_sku_key" ON "Producto"("sku");
CREATE UNIQUE INDEX "Producto_codigoBarras_key" ON "Producto"("codigoBarras");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Cantidades a milésimas: kardex y líneas de ticket (también las del hospedaje: una habitación o una hora = 1000).
UPDATE "MovimientoInventario" SET "cantidad" = "cantidad" * 1000;
UPDATE "LineaTicket" SET "cantidad" = "cantidad" * 1000;

-- Las salidas registradas antes tenían solo texto libre: quedan con el motivo OTRO y ese texto como detalle.
UPDATE "MovimientoInventario" SET "motivoSalida" = 'OTRO' WHERE "tipo" = 'SALIDA';
