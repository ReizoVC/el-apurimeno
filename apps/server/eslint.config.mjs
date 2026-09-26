import { config } from "@apurimeno/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    rules: {
      // El servidor no se compila con turbo: lee JWT_SECRET, DATABASE_URL, RESPALDO_* y demás al ejecutarse
      // (`pnpm start`), no al construir. Declararlas en turbo.json no cambiaría ninguna salida cacheada.
      "turbo/no-undeclared-env-vars": "off",
    },
  },
  // El cliente de Prisma es generado; la base y las copias no son código.
  { ignores: ["src/generated/**", "datos/**"] },
];
