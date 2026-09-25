-- Hasta esta versión no existía una ruta para registrar clientes, así que no puede haber documentos repetidos.

-- DropIndex
DROP INDEX "Cliente_documento_idx";

-- AlterTable
ALTER TABLE "MovimientoCaja" ADD COLUMN "claveIdempotencia" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_documento_key" ON "Cliente"("documento");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoCaja_claveIdempotencia_key" ON "MovimientoCaja"("claveIdempotencia");

