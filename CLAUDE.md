# El Apurimeño

Notas para trabajar en este monorepo (pnpm + Turborepo). Las reglas de negocio y las decisiones del proyecto
están en `docs/` (SRS y Planos) y en `packages/contracts/README.md`.

## Compilación

- `turbo run build` falla en entornos sin acceso a internet (o con un proxy cuyo certificado turbo no
  reenvía): las apps Next (`web`, `cleaning`, `store-catalog`) descargan la fuente Geist de Google Fonts al
  compilar (`next/font/google`). Compilar cada app por separado funciona: `pnpm --filter <app> build`. Solo
  importa si el entorno de build no tiene acceso a internet.
