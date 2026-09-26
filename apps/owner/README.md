# owner: resumen remoto para la propietaria

App web estática (Next 15, `output: 'export'`) que la propietaria y su hija abren desde el celular, fuera del
local, para ver el resumen que el servidor del local publica en Supabase (ADR-06, RN-45, CU-28). Lee **solo** de
Supabase con su propia sesión (Supabase Auth, separada del inicio de sesión del sistema local). Nunca habla con el
servidor del local y nunca escribe nada.

```bash
cp .env.example .env.local   # URL del proyecto y clave publicable
pnpm dev                     # http://localhost:3004 (sin las cabeceras de seguridad)
pnpm build                   # out/ + out/_headers (CSP con hashes)
pnpm preview                 # out/ servido por wrangler, con las cabeceras reales de Cloudflare Pages
pnpm publicar                # sube out/ a Cloudflare Pages (ver "Despliegue")
```

## Pantallas

Una sola página que avanza por estados: ingreso → verificación en dos pasos → resumen. Pensada para el celular
primero: una columna, tarjetas en vez de tablas anchas, números grandes. (Este plan se escribió antes del código,
en el primer commit de la app, y se siguió tal cual.)

### 1. Ingreso

- Correo y contraseña contra Supabase Auth (`signInWithPassword`). No hay registro ni "olvidé mi contraseña": las
  cuentas las crea el administrador a mano (`supabase/README.md`), y el registro público está cerrado.
- Errores en castellano: credenciales incorrectas, sin conexión, demasiados intentos.
- Tras la contraseña, la app pregunta el rol de la cuenta (`espejo_mi_rol()`). Solo las cuentas `lector`
  continúan. La cuenta del servidor (`sincronizador`) o una sin acceso ven "Sin acceso" y se cierra la sesión.
  Si el proyecto aún no tiene esa función (migración pendiente), se sigue: lo que se puede leer lo deciden igual
  las políticas de la base.

### 2. Verificación en dos pasos (TOTP, obligatoria)

- **Primera vez** (la cuenta no tiene autenticador): muestra el código QR y, a pedido, la clave para escribirla a
  mano; sugiere Google Authenticator o Microsoft Authenticator, y pide el primer código para confirmar.
- **Siguientes veces:** solo el código de 6 dígitos.
- **Ningún dato se consulta ni se muestra** hasta que la sesión está en el nivel `aal2`: el componente del resumen
  ni siquiera se monta antes. Además, la base lo exige: con la migración `20260926090000_lector_requiere_aal2.sql`
  las políticas de lectura piden `aal2` a las cuentas `lector`, así que con solo la contraseña no se lee nada ni
  llamando a la API directamente.
- Un alta que quedó a medias (autenticador sin confirmar) se descarta y se empieza de nuevo.
- "Salir" está disponible también en este paso, para entrar con otra cuenta.

### 3. Resumen

- **Franja "Datos al 26/09/2026, 03:56 (hora de Lima)"** con "hace N min": es la hora de la última publicación
  correcta del local. En **ámbar**, con "desactualizados", si pasaron más de dos intervalos de sincronización
  (2 × 30 min) sin publicar: el mismo criterio que la pantalla "Espejo en la nube" del Dashboard, con la misma
  función (`estaDesactualizado` de `@apurimeno/domain`). Si el local nunca publicó, lo dice.
- **Periodo:** Hoy · Ayer · 7 días · Mes (del 1 del mes a hoy). Los días son días de Lima según la hora del celular;
  solo sirve para elegir qué días pedir, los totales vienen del local.
- **Ventas:** total vendido y cantidad de cobros; anulados (cantidad y monto, en rojo si hay); por origen; por
  método de pago; y, si el periodo tiene más de un día, el total de cada día (el más reciente arriba).
- **Arqueos:** diferencia total y turnos con diferencia; una tarjeta por turno cerrado (el más reciente arriba) con
  cajero, apertura y cierre, lo vendido en el turno, efectivo inicial, esperado, contado, diferencia (rojo si falta,
  verde si cuadra), "cierre forzado" si lo cerró un administrador, y el comentario de cierre.
- **Ocupación:** alquileres y horas vendidas del periodo; habitaciones de la más a la menos usada con sus ingresos;
  las que no tuvieron alquileres, en gris al final ("sin uso"). Nunca muestra qué está ocupado ahora (RN-45).
- **Sin datos:** "No hay datos publicados para este periodo" / "No se cerró ningún turno en este periodo".
- **Actualizar:** botón en la franja, y recarga automática cada 5 minutos mientras la app está abierta.
- **Formato más nuevo:** si el local publica una versión del resumen más nueva que esta app, pide recargar en vez
  de mostrar números a medias.

### Decisiones

- **La sesión queda guardada en el celular** (almacenamiento del navegador, lo que hace supabase-js por defecto):
  la propietaria no escribe contraseña y código cada vez que abre la app. "Salir" la cierra; desactivar la cuenta
  en `privado.acceso_espejo` le quita el acceso a los datos en la siguiente consulta, aunque la sesión siga abierta.
- **Sin fuentes descargadas:** usa la fuente del sistema del celular. Es más rápido, no depende de Google Fonts al
  compilar (ver CLAUDE.md) y no pide nada fuera de este sitio y de Supabase.
- **Etiquetas propias en vez de las del Dashboard:** "Ingresos a habitación", "Horas adicionales", "Tienda": la
  propietaria lee el resumen sin contexto del POS.
- **Una sola página con estados**, no rutas: el sitio estático tiene un solo `index.html`, y las cabeceras y la
  CSP se calculan sobre él.

## Seguridad

- **Solo la clave publicable** de Supabase va en la app: es pública por diseño y lo que permite lo deciden las
  políticas de la base. `next.config.ts` hace fallar la compilación si se le pasa una clave secreta o
  `service_role`, y la app vuelve a comprobarlo al iniciar (`esClaveSupabasePrivilegiada` de contracts).
- **`noindex`:** etiqueta meta `robots`, cabecera `X-Robots-Tag: noindex, nofollow` y `robots.txt` que lo prohíbe
  todo.
- **Cabeceras** (`out/_headers`, que genera `scripts/cabeceras.mjs` al compilar y Cloudflare Pages aplica):
  - `Content-Security-Policy`: `default-src 'none'`; scripts solo del sitio y los scripts en línea de Next
    autorizados **por su hash** (sin `'unsafe-inline'` ni `'unsafe-eval'`); `connect-src` **solo hacia el
    proyecto de Supabase** configurado; imágenes del sitio y `data:` (el QR); sin marcos (`frame-ancestors
    'none'`), sin formularios hacia afuera, sin `<base>`.
  - `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
    `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy` sin cámara, micrófono, ubicación, pagos, USB
    ni Bluetooth, y `Strict-Transport-Security`.
  - Los hashes cambian con cada compilación: por eso `_headers` se genera siempre en `pnpm build`, nunca a mano.

## Despliegue en Cloudflare Pages

Sitio estático subido desde tu PC con `wrangler` (ya es dependencia de esta app). No hace falta conectar el
repositorio a Cloudflare. Pasos exactos, la primera vez:

1. **Cuenta de Cloudflare:** crea una gratis en <https://dash.cloudflare.com/sign-up> si no la tienes. El plan
   gratuito de Pages alcanza.
2. **Variables de producción:** en `apps/owner/`, crea `.env.production.local` (no se sube al repositorio) con el
   proyecto de Supabase de **producción**:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<proyecto-de-produccion>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

   La clave publicable está en Supabase → **Project Settings → API Keys**. Nunca la secreta: la compilación falla
   con ella. Este archivo tiene prioridad sobre `.env.local` (que puede quedar apuntando al proyecto de prueba).
3. **Compilar**, desde la raíz del repositorio:

   ```bash
   pnpm install
   pnpm --filter owner build
   ```

   Debe terminar con una línea como `_headers: 2 páginas, 10 scripts en línea autorizados por hash; connect-src
   https://<proyecto-de-produccion>.supabase.co`. Si el `connect-src` muestra el proyecto de prueba, revisa el
   paso 2.
4. **Iniciar sesión en Cloudflare** (abre el navegador para autorizar):

   ```bash
   pnpm --filter owner exec wrangler login
   ```

5. **Crear el proyecto de Pages** (solo la primera vez):

   ```bash
   pnpm --filter owner exec wrangler pages project create apurimeno-owner --production-branch main
   ```

   El nombre es el de `wrangler.toml`. Si ese nombre ya estuviera tomado en `pages.dev`, usa otro y cámbialo
   también en `wrangler.toml`.
6. **Publicar:**

   ```bash
   pnpm --filter owner publicar
   ```

   Sube `out/` como despliegue de producción (`--branch main`) y muestra la dirección, p. ej.
   `https://apurimeno-owner.pages.dev`.
7. **Comprobar las cabeceras:**

   ```bash
   curl -sI https://apurimeno-owner.pages.dev | grep -iE "content-security|x-robots"
   ```

   Debe aparecer la `Content-Security-Policy` con `connect-src https://<proyecto-de-produccion>.supabase.co` y
   `X-Robots-Tag: noindex, nofollow`.
8. **Probar con una cuenta lectora:** abre la dirección en el celular, entra, da de alta el autenticador y revisa
   que los números coincidan con los reportes del Dashboard del local.

Para **actualizar** la app después de un cambio: repetir los pasos 3 y 6.

Opcional: un dominio propio se agrega en Cloudflare → **Workers & Pages → apurimeno-owner → Custom domains**. No
hace falta cambiar nada en la app ni en Supabase: la CSP solo restringe hacia dónde se conecta la app, no desde qué
dirección se sirve.

## Pruebas

Se probó de punta a punta contra el proyecto de prueba de Supabase, con el sitio compilado servido por
`wrangler pages dev` (las cabeceras reales), en Chrome con tamaño de celular:

- CSP con `connect-src` solo hacia Supabase, sin `'unsafe-inline'`; `noindex` en cabecera y página; ninguna
  violación de CSP en la consola.
- Contraseña equivocada → mensaje en castellano.
- Primera vez: QR y clave; un código equivocado se rechaza; con el correcto entra. **Antes del código no se pidió
  ningún dato del resumen** (se revisaron las solicitudes de red).
- Hoy, Mes, Ventas, Arqueos y Ocupación coinciden con lo publicado en Supabase (leído aparte con la cuenta del
  servidor): total, cobros, anulados, métodos de pago, diferencia total, un turno por tarjeta, alquileres, horas e
  ingresos por habitación.
- Con una publicación de hace 2 horas (simulada), la franja pasa a ámbar y dice "desactualizados".
- Salir y volver a entrar: solo pide el código. Recargar la página: sigue en el resumen.
- Al terminar, la prueba quita el autenticador que dio de alta, para dejar la cuenta de prueba como estaba.
