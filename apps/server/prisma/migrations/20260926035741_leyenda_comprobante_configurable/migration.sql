-- La leyenda al pie del comprobante pasa a ser configurable (decisión 21 de contracts). El esquema no cambia:
-- `comprobante` es una columna JSON; esta migración solo completa los datos existentes.

-- Las configuraciones existentes reciben la leyenda que hasta ahora estaba fija en el código.
UPDATE "ConfiguracionGlobal"
SET "comprobante" = json_set("comprobante", '$.leyenda', 'Documento interno sin valor tributario.')
WHERE json_extract("comprobante", '$.leyenda') IS NULL;

-- La semilla anterior ponía esa misma frase como dato adicional, y el comprobante la imprimía dos veces.
-- Solo se reemplaza si nadie la cambió desde entonces.
UPDATE "ConfiguracionGlobal"
SET "comprobante" = json_set("comprobante", '$.datosAdicionales', 'Gracias por su preferencia.')
WHERE json_extract("comprobante", '$.datosAdicionales') = 'Documento interno sin valor tributario';
