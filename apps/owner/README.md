# owner: resumen remoto para la propietaria

App web estática (Next 15, `output: 'export'`) que la propietaria y su hija abren desde el celular, fuera del
local, para ver el resumen que el servidor del local publica en Supabase (ADR-06, RN-45, CU-28). Lee **solo** de
Supabase con su propia sesión (Supabase Auth). Nunca habla con el servidor del local y nunca escribe nada.

> Estado: **plan**. Este archivo se escribió antes del código, como plan de pantallas; las secciones siguientes
> se completan con la implementación, el despliegue y las pruebas.

## Plan de pantallas

Una sola página que avanza por estados: ingreso → verificación en dos pasos → resumen. Pensada para el celular
primero: una columna, tarjetas en vez de tablas anchas, números grandes.

### 1. Ingreso

- Correo y contraseña contra Supabase Auth (`signInWithPassword`). No hay registro ni "olvidé mi contraseña": las
  cuentas las crea el administrador a mano (`supabase/README.md`), y el registro público está cerrado.
- Errores en castellano: credenciales incorrectas, sin conexión, demasiados intentos.
- Tras el ingreso, la app pregunta a Supabase el rol de la cuenta (`espejo_mi_rol()`, función nueva). Solo las
  cuentas `lector` continúan. La cuenta del servidor (`sincronizador`) o una cuenta sin acceso ven "Esta cuenta
  no tiene acceso al resumen" y se cierra la sesión.

### 2. Verificación en dos pasos (TOTP, obligatoria)

- **Primera vez** (la cuenta no tiene autenticador): alta del autenticador. Muestra el código QR y la clave para
  escribirla a mano, sugiere Google Authenticator o Microsoft Authenticator, y pide el primer código de 6 dígitos
  para confirmar.
- **Siguientes veces:** solo pide el código de 6 dígitos.
- **Ningún dato se consulta ni se muestra** hasta que la sesión llega al nivel `aal2` (verificada con el segundo
  paso). Además, la base lo exige: una migración nueva hace que las políticas de lectura pidan `aal2` a las
  cuentas `lector`, así que ni siquiera llamando a la API directamente se leen datos con solo la contraseña.
- Si queda un alta a medias (autenticador sin confirmar), se descarta y se empieza de nuevo.

### 3. Resumen

- **Franja superior "Datos al 26/09/2026, 03:15 (hora de Lima)"**, con "hace N min". En **ámbar** con la palabra
  "desactualizados" si pasaron más de dos intervalos de sincronización (2 × 30 min) sin publicar: mismo criterio
  que la pantalla "Espejo en la nube" del Dashboard (la función se comparte desde `@apurimeno/domain`). Si nunca
  se publicó nada, lo dice.
- **Selector de periodo:** Hoy · Ayer · 7 días · Mes (del 1 del mes a hoy). Los días son días de Lima, según la
  hora del celular (solo elige qué días pedir; los totales vienen del local).
- **Pestaña Ventas:** total vendido y cantidad de cobros; anulados (cantidad y monto); por origen (ingresos,
  horas adicionales, tienda); por método de pago; y, si el periodo tiene más de un día, el total de cada día.
- **Pestaña Arqueos:** diferencia total y turnos con diferencia; una tarjeta por turno cerrado en el periodo
  (cajero, apertura y cierre, esperado, contado, diferencia en rojo si falta y en verde si cuadra, "forzado" si
  lo cerró un administrador, lo vendido en el turno y el comentario de cierre).
- **Pestaña Ocupación:** alquileres y horas vendidas del periodo; habitaciones de la más a la menos usada, con sus
  ingresos; las que no tuvieron alquileres, en gris al final. Nunca muestra qué está ocupado ahora (RN-45).
- **Periodo sin datos:** "No hay datos publicados para este periodo".
- **Actualizar:** botón y recarga automática cada 5 minutos mientras la app está abierta (el local publica cada
  30 minutos).
- **Salir:** cierra la sesión. La sesión se guarda en el celular (así no pide contraseña y código cada vez que
  abre la app); vence o se corta con "Salir", o desactivando la cuenta en Supabase.

### Datos

- Lee `resumen_dia` (días del periodo), `resumen_turno` (turnos cerrados en el periodo) y `estado_espejo` (hora
  de la última publicación), por la API de datos de Supabase y con row-level security.
- Suma varios días con una función pura de `@apurimeno/domain` (con pruebas), que usa los mismos contratos
  (`ResumenDia`, `ResumenTurno`) que el servidor al publicar.

### Seguridad

- Solo la clave **publicable** de Supabase va en la app (es pública por diseño). La compilación falla si se le
  pasa una clave secreta o `service_role`.
- `noindex`: etiqueta meta, cabecera `X-Robots-Tag` y `robots.txt`.
- Cabeceras de Cloudflare Pages (`_headers`): Content-Security-Policy con `connect-src` solo hacia el proyecto de
  Supabase, scripts solo propios (los scripts en línea de Next se autorizan por su hash, calculado al compilar),
  sin marcos, sin plugins; además `Referrer-Policy`, `X-Content-Type-Options` y `Permissions-Policy`.

### Despliegue

Cloudflare Pages, subiendo la carpeta `out/` con `wrangler`. Los pasos exactos quedan en este README.

### Formatos compartidos

Los formatos de dinero y fechas de Lima que tenían `apps/web` y `apps/native` pasan a un paquete
`@apurimeno/formato`, que también usa esta app. El dominio lo usa para el comprobante y los días de Lima.
