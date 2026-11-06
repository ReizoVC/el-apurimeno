-- Decisión 30: en una base existente, el rango Administrador recibe el permiso nuevo. La semilla lo da en una base nueva.
INSERT OR IGNORE INTO "RangoPermiso" ("rangoId", "permiso")
SELECT "id", 'system.update' FROM "Rango" WHERE "id" = 'rango-administrador';
