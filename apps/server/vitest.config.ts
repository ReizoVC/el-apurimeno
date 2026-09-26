import { defineConfig } from "vitest/config";

// Las pruebas del servidor son de integración: base SQLite real y temporal, migraciones, bcrypt y copias de la base.
// El límite por defecto de vitest (5 s) se excedía en la primera prueba de un archivo cuando `turbo` corre a la vez
// el typecheck, el lint y las pruebas de todo el monorepo.
export default defineConfig({
  test: { testTimeout: 20_000 },
});
