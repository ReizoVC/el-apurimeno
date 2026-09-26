-- Estado de la sincronización con el espejo en la nube (ADR-06). Una sola fila; no guarda datos del negocio.
-- CreateTable
CREATE TABLE "EstadoEspejo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "ultimoIntentoEn" DATETIME,
    "ultimoExitoEn" DATETIME,
    "cambiosDesde" DATETIME,
    "ultimoErrorCodigo" TEXT,
    "ultimoErrorMensaje" TEXT,
    "ultimoErrorEn" DATETIME
);
