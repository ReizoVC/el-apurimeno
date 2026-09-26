# El Apurimeño

Sistema de gestión para un hospedaje por horas: reemplaza el cuaderno de papel del local. Monorepo pnpm +
Turborepo en TypeScript. La especificación está en `docs/` (SRS y Planos Técnicos); el estado del proyecto, en
[`docs/ESTADO_ACTUAL.md`](docs/ESTADO_ACTUAL.md).

Funciona **local-first** (ADR-06): el servidor, la base de datos y la impresora viven en el local y operan sin
internet. Solo un resumen sale, con demora, hacia un espejo en Supabase para que la propietaria lo vea desde
fuera.

## Estructura

| Carpeta | Qué es | Dónde corre |
|---|---|---|
| `apps/server` | Backend local: Fastify + Prisma 7 + SQLite. API, auditoría, cola de impresión y sincronización con el espejo | PC del local |
| `apps/native` | POS del cajero: Tauri v2 + Vite + React (tablero, ingresos, horas adicionales, salidas, tienda, caja) | PC del local |
| `apps/web` | Dashboard del administrador: Next.js (reportes, administración, configuración, auditoría, espejo) | Navegador en la red del local |
| `apps/cleaning` | App de limpieza para el celular del personal: Next.js | Celular en la red del local |
| `apps/owner` | Resumen remoto para la propietaria, con verificación en dos pasos: Next.js estático | Cloudflare Pages + Supabase |
| `apps/store-catalog` | Catálogo de la tienda: **maqueta**, todavía sin conectar al servidor | — |
| `packages/contracts` | Tipos y esquemas Zod compartidos, y las decisiones de interpretación del SRS | — |
| `packages/domain` | Reglas de negocio como funciones puras, con sus pruebas | — |
| `packages/formato` | Formatos de dinero y de fechas de Lima para las pantallas | — |
| `packages/ui` | Componentes de interfaz compartidos (shadcn/ui + Tailwind) | — |
| `supabase` | SQL del espejo en la nube (tablas, row-level security) y cómo instalarlo | Supabase |

Cada app tiene su README con la conexión, las pantallas y las decisiones de diseño.

## Requisitos

- **Node.js 22.9 o posterior** (el servidor usa `--env-file-if-exists`) y **pnpm 9**.
- Para compilar el POS de escritorio: Rust y, en Windows, Visual Studio con la carga de trabajo "Desarrollo
  para el escritorio con C++" (el enlazador necesita `msvcrt.lib` y el Windows SDK).

## Desarrollo

```bash
pnpm install
pnpm check-types && pnpm lint && pnpm test   # todo el monorepo

cd apps/server && pnpm migrate && SEED_ADMIN_PASSWORD='...' pnpm seed && pnpm dev   # API en :3001
pnpm --filter native dev      # POS en el navegador, :1420 (pnpm tauri dev para la app de escritorio)
pnpm --filter web dev         # Dashboard, :3000
pnpm --filter cleaning dev    # limpieza, :3002
pnpm --filter owner dev       # resumen remoto, :3004
```

Notas de compilación y trabajo en el repositorio: [`CLAUDE.md`](CLAUDE.md).
