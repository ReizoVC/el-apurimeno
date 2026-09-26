# El Apurimeño

Notas para trabajar en este monorepo (pnpm + Turborepo). Las reglas de negocio y las decisiones del proyecto
están en `docs/` (SRS y Planos) y en `packages/contracts/README.md`. El estado del proyecto (qué está hecho, qué
falta, qué decisiones esperan a la propietaria) está en `docs/ESTADO_ACTUAL.md`. El mapa de carpetas, en
`README.md`; cada app tiene su README con su conexión, pantallas y decisiones de diseño.

## Arquitectura y convenciones

- **Contratos primero:** toda forma de dato nueva va en `packages/contracts` (Zod) antes de usarse. Las
  interpretaciones del SRS se registran como decisiones numeradas en `packages/contracts/README.md`.
- **La lógica de negocio vive en `packages/domain`** (funciones puras con pruebas). `apps/server` solo lee datos,
  llama al dominio, guarda en una transacción (con su auditoría) y expone HTTP. Las pantallas no calculan precios
  ni tiempos.
- **Dinero en céntimos enteros** (RN-37). **Fechas en ISO UTC**; los días del negocio son días de Lima (UTC−5,
  sin horario de verano): usar `@apurimeno/formato` (`diaLima`, `periodoDeDias`, `soles`, `fechaHora`…), no
  copias locales.
- **Permisos, no rangos:** el código comprueba permisos del catálogo fijo; cada ruta declara su operación
  (`PERMISO_POR_OPERACION` en domain).
- Nombres, textos de pantalla y comentarios en castellano. Mensajes de commit en inglés con prefijo
  `feat(ámbito):` / `fix(ámbito):` / `docs(ámbito):`; los PR se integran de a uno, en el orden en que se abrieron.
- No se toca la impresión parte 2 (transporte USB/Bluetooth/Windows) sin la impresora física conectada.

## Pruebas

- `pnpm check-types`, `pnpm lint` y `pnpm test` desde la raíz cubren todo el monorepo (las pruebas viven en
  contracts, domain, formato y server; las del servidor usan una base SQLite real y temporal).
- Las pantallas se prueban contra el servidor real en un navegador (Playwright con el Chrome instalado), no con
  mocks. La vista remota (`apps/owner`) se prueba compilada y servida por `pnpm --filter owner preview`, para que
  apliquen las cabeceras y la CSP reales.

## Compilación

- `turbo run build` falla en entornos sin acceso a internet (o con un proxy cuyo certificado turbo no
  reenvía): las apps Next (`web`, `cleaning`, `store-catalog`) descargan la fuente Geist de Google Fonts al
  compilar (`next/font/google`). Compilar cada app por separado funciona: `pnpm --filter <app> build`. Solo
  importa si el entorno de build no tiene acceso a internet. (`apps/owner` usa la fuente del sistema y no tiene
  este problema.)
- `apps/owner` exige `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` para compilar
  (`apps/owner/.env.local`); falla a propósito con una clave secreta.

## Windows

- **`better-sqlite3` va fijado en la versión 12**, la misma que usa el adaptador de Prisma: la 13 intenta
  compilar con `node-gyp` en Windows y sus binarios exigen Node ≥ 22.14. Si `pnpm install` deja
  `better-sqlite3` sin binario ("Could not locate the bindings file"), correr `npx prebuild-install` dentro de
  `node_modules/.pnpm/better-sqlite3@12.*/node_modules/better-sqlite3`.
- **Tauri (`apps/native/src-tauri`)** necesita Visual Studio con "Desarrollo para el escritorio con C++" y el
  Windows SDK; sin eso, `cargo` falla con `LNK1104: msvcrt.lib`.
- **Rutas largas:** `pnpm install` en una carpeta de ruta muy larga (p. ej. dentro de `%TEMP%\claude\…`) falla con
  `ELIFECYCLE -4058` por el límite de 260 caracteres de Windows. Para un clon de prueba, usar una ruta corta.
- **Finales de línea:** el repositorio guarda LF y git en Windows convierte a CRLF al extraer. Prettier escribe
  LF, así que formatear carpetas enteras marca como modificados archivos que no cambiaron: formatear solo los
  archivos tocados, o restaurar con `git checkout -- <archivo>` los que solo cambiaron de final de línea.

## Variables de entorno y credenciales

- `apps/server/.env` (servidor: base, JWT, impresora, espejo) y `apps/owner/.env.local` /
  `.env.production.local` (vista remota). Ninguno se sube al repositorio; las plantillas son los `.env.example`.
- **Supabase:** la app y el servidor usan solo la clave **publicable**. La secreta no se usa en ninguna parte.
  `apurimeno-prueba` es el proyecto de pruebas; el de producción lo configura la propietaria.
- **Nunca apuntar un servidor de desarrollo o de prueba al espejo de producción:** cada sincronización reemplaza
  los días que publica, y una base de prueba publicaría días vacíos sobre los reales (ver `supabase/README.md`).
- **Respaldos:** la clave **privada** de respaldo no se escribe en ningún archivo (ni `.env`, ni el repositorio, ni la
  carpeta de las copias): la guarda la propietaria. El servidor solo tiene `RESPALDO_CLAVE_PUBLICA`. Las pruebas
  generan claves de prueba al momento. Procedimiento: `docs/RESPALDO_Y_RESTAURACION.md`.
- Las cuentas de prueba (lectora, sincronizador) no se escriben en ningún archivo del repositorio: se pasan por
  variables de entorno a los scripts de prueba. Una prueba que da de alta un autenticador TOTP debe quitarlo al
  terminar.
