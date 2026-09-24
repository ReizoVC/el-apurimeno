# El Apurimeño

Sistema de gestión para hospedaje por horas — **en construcción**.

Esqueleto base importado de [Arbarwings/tauri-v2-nextjs-monorepo](https://github.com/Arbarwings/tauri-v2-nextjs-monorepo)
(Tauri v2 + Next.js + Turborepo + pnpm workspaces, con un paquete de UI compartido).

Todavía no hay lógica de negocio del hospedaje implementada; por ahora es solo
el esqueleto del monorepo corriendo, listo para construir los contratos
compartidos y las funcionalidades del dominio.

## Estructura

- `apps/web` — aplicación web (Next.js)
- `apps/native` — aplicación de escritorio (Tauri v2)
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
