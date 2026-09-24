/*
  Warnings:

  - You are about to drop the column `codigo` on the `CodigoAutorizacion` table. All the data in the column will be lost.
  - Added the required column `codigoHash` to the `CodigoAutorizacion` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CodigoAutorizacion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigoHash" TEXT NOT NULL,
    "operacion" TEXT NOT NULL,
    "generadoPorId" TEXT NOT NULL,
    "generadoEn" DATETIME NOT NULL,
    "expiraEn" DATETIME NOT NULL,
    "usadoEn" DATETIME,
    "usadoPorId" TEXT,
    "ticketId" TEXT,
    CONSTRAINT "CodigoAutorizacion_generadoPorId_fkey" FOREIGN KEY ("generadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CodigoAutorizacion_usadoPorId_fkey" FOREIGN KEY ("usadoPorId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CodigoAutorizacion_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- Los códigos existentes se descartan en vez de copiarse: guardaban el valor en claro, no hay forma de
-- calcular su hash, y de todos modos vencen en minutos. (Antes de esta migración ninguna ruta generaba códigos.)
DROP TABLE "CodigoAutorizacion";
ALTER TABLE "new_CodigoAutorizacion" RENAME TO "CodigoAutorizacion";
CREATE UNIQUE INDEX "CodigoAutorizacion_ticketId_key" ON "CodigoAutorizacion"("ticketId");
CREATE INDEX "CodigoAutorizacion_codigoHash_idx" ON "CodigoAutorizacion"("codigoHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
