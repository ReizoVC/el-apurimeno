-- Versión del formato con que se publicó el espejo por última vez. Vacía en las bases existentes: la primera
-- sincronización después de esta migración publica todo el historial y la guarda.
-- AlterTable
ALTER TABLE "EstadoEspejo" ADD COLUMN "versionResumen" INTEGER;
