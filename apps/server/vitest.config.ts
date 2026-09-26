import { defineConfig } from "vitest/config";

// Las pruebas del servidor son de integración: base SQLite real y temporal, migraciones, bcrypt y copias de la base.
// Los límites por defecto de vitest (5 s por prueba, 10 s por hook como el beforeEach que prepara la base) se
// excedían en la primera prueba de un archivo cuando `turbo` corre a la vez el typecheck, el lint y las pruebas de
// todo el monorepo.
export default defineConfig({
  test: { testTimeout: 20_000, hookTimeout: 20_000 },
});
