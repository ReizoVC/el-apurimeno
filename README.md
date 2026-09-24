# El Apurimeño

Sistema de gestión para hospedaje por horas — **en construcción**.

Esqueleto base importado de [Arbarwings/tauri-v2-nextjs-monorepo](https://github.com/Arbarwings/tauri-v2-nextjs-monorepo)
(Tauri v2 + Next.js + Turborepo + pnpm workspaces, con un paquete de UI compartido).

Estado actual: los contratos compartidos, las reglas de negocio y un backend local con el flujo de
ingreso (turno de caja, ingreso, hora adicional y salida), la tienda, la anulación de cobros y los
reportes básicos. La app de limpieza existe con datos de prueba (mock). Todavía no hay interfaces
conectadas al backend. La especificación completa está en `docs/`.

## Estructura

- `apps/server` — backend local (Fastify + Prisma + SQLite)
- `apps/cleaning` — app de limpieza (Next.js), con API mock
- `apps/web` — aplicación web (Next.js)
- `apps/native` — aplicación de escritorio (Tauri v2)
- `packages/contracts` — tipos y esquemas Zod compartidos (`@apurimeno/contracts`)
- `packages/domain` — reglas de negocio como funciones puras (`@apurimeno/domain`)
- `packages/ui` — componentes de UI compartidos (`@apurimeno/ui`)
- `packages/eslint-config`, `packages/typescript-config` — configuración compartida

## Requisitos

- Node.js >= 18
- pnpm
- Toolchain de Rust (para `pnpm tauri dev`)

## Desarrollo

```bash
pnpm install

# app web
pnpm dev

# app de escritorio (Tauri)
pnpm tauri dev
```
