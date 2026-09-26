-- Códigos de autorización para reintentar un cierre de turno (decisión 25): el código registra el turno en el que se
-- usó. Se rehace la tabla (SQLite) conservando todas las filas.
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
    "turnoId" TEXT,
    CONSTRAINT "CodigoAutorizacion_generadoPorId_fkey" FOREIGN KEY ("generadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CodigoAutorizacion_usadoPorId_fkey" FOREIGN KEY ("usadoPorId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CodigoAutorizacion_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CodigoAutorizacion_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "Turno" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CodigoAutorizacion" ("codigoHash", "expiraEn", "generadoEn", "generadoPorId", "id", "operacion", "ticketId", "usadoEn", "usadoPorId") SELECT "codigoHash", "expiraEn", "generadoEn", "generadoPorId", "id", "operacion", "ticketId", "usadoEn", "usadoPorId" FROM "CodigoAutorizacion";
DROP TABLE "CodigoAutorizacion";
ALTER TABLE "new_CodigoAutorizacion" RENAME TO "CodigoAutorizacion";
CREATE UNIQUE INDEX "CodigoAutorizacion_ticketId_key" ON "CodigoAutorizacion"("ticketId");
CREATE INDEX "CodigoAutorizacion_codigoHash_idx" ON "CodigoAutorizacion"("codigoHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
