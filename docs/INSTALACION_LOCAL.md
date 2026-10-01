# Instalación local en Windows 11

Guía revisada contra el código y los scripts del repositorio el 26/09/2026. Los ejemplos usan `C:\ElApurimeno`; sustituir esa ruta por la elegida. Completar los marcadores `<...>` localmente. No enviar secretos por chat ni incluirlos en registros.

**Estado:** un solo instalador, `apps/server/scripts/instalar-servicio.ps1 -Produccion`, deja como servicios de Windows el servidor (3001), el Dashboard (3000) y Limpieza (3002). Los tres arrancan solos y se reinician si se caen; probado el 26 y 27/09/2026 en el equipo de desarrollo, incluido un reinicio del equipo (sección 4). El respaldo externo va a una carpeta física sincronizada por Drive (sección 5).

## 1. Programas y preparación

- Windows 11 de 64 bits y cuenta administradora para instalar servicios y configurar firewall.
- Git para Windows.
- Node.js 22.9 o superior, compatible con las dependencias fijadas; este equipo usa 22.12.0.
- Corepack y pnpm **9.0.0**, fijado en `package.json`.
- Google Drive para escritorio, configurado por la propietaria.
- NSSM: el instalador del servidor descarga 2.24-101, verifica SHA-256 y lo guarda en `C:\Program Files\NSSM`. Si ya existe, lo reutiliza.
- MSI del POS ya compilado. Para instalarlo no hacen falta Rust, Visual Studio ni Windows SDK.
- **Hora de Windows sincronizada automáticamente**, confirmada antes de poner el sistema en marcha: Configuración → Hora e idioma → Fecha y hora → "Establecer la hora automáticamente" activado, y "Sincronizar ahora" sin error. El servidor registra con la hora del equipo los ingresos, las salidas y el tiempo de cortesía: un reloj atrasado o adelantado los cambia directamente. El 28/09/2026 el equipo de desarrollo iba 37 s atrasado y por eso fallaba la verificación en dos pasos de la vista remota. Tras sincronizarlo, la diferencia con Supabase bajó a menos de 1 s.

En PowerShell como administrador:

```powershell
corepack enable
corepack prepare pnpm@9.0.0 --activate
```

Clonar el repositorio autorizado en una ruta corta; se necesita internet para instalar dependencias:

```powershell
git clone <URL_DEL_REPOSITORIO> C:\ElApurimeno
Set-Location C:\ElApurimeno
git rev-parse HEAD
node --version
pnpm --version
pnpm install --frozen-lockfile
```

`postinstall` genera el cliente de Prisma. No reinstalar dependencias con el servicio funcionando: SQLite puede mantener sus binarios abiertos. Para actualizar, hacer antes una copia desde Dashboard y detener únicamente el servicio correspondiente.

Reservar una IP fija para el PC, comprobar el perfil de red privada y evitar suspensión durante la operación. Los celulares deben estar en el wifi del local con acceso al PC.

## 2. Variables de producción

En una instalación nueva, copiar `apps/server/.env.example` a `apps/server/.env`, sin sobrescribir uno existente. Editarlo localmente, no mostrar su contenido ni subirlo a Git. Rutas con espacios entre comillas, con barras `/`.

| Variable                   | Uso y valor que debe elegirse                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                 | `production`; el instalador lo fija con `-Produccion`. Puede declararse también en `.env` para ejecución manual.                                                                                                                           |
| `DATABASE_URL`             | Ruta SQLite con prefijo `file:`. Preferir una ruta absoluta fija, por ejemplo `file:C:/ElApurimeno/apps/server/datos/apurimeno.db`. Por defecto `file:./datos/apurimeno.db`, relativa a `apps/server`. No guardar la base activa en Drive. |
| `JWT_SECRET`               | Secreto propio y estable, mínimo 32 caracteres, introducido por la propietaria. Obligatorio en producción.                                                                                                                                 |
| `HOST`                     | `0.0.0.0` para escuchar en la red local, limitada por firewall.                                                                                                                                                                            |
| `PORT`                     | Puerto API, `3001`. No dejar vacío.                                                                                                                                                                                                        |
| `CORS_ORIGINS`             | Orígenes exactos separados por comas, sin comodines ni barra final; incluir Dashboard, Limpieza y POS. Ver ejemplo debajo.                                                                                                                 |
| `IMPRESORA_DISPOSITIVO`    | Dónde está la impresora: el valor que sugiere `pnpm buscar-impresora` (`COM5`, `usb` o `windows:<nombre>`), después de probarlo con `pnpm enviar-impresora --estado` y la página de prueba (`apps/server/README.md`, "Impresión"). No escribir `USB001`: el servidor lo rechaza. |
| `IMPRESORA_PAGINA_CODIGOS` | `PC850` por defecto o `WPC1252`; se confirmará con la impresora.                                                                                                                                                                           |
| `IMPRESORA_LOGO`           | Vacío: el logotipo del negocio. `no`: sin logotipo (si en papel no se ve bien).                                                                                                                                                            |
| `ESPEJO_SUPABASE_URL`      | URL HTTPS del proyecto autorizado. Vacío mientras el espejo esté apagado.                                                                                                                                                                  |
| `ESPEJO_SUPABASE_ANON_KEY` | Clave publicable, nunca secreta ni `service_role`. La introduce la propietaria.                                                                                                                                                            |
| `ESPEJO_SYNC_EMAIL`        | Cuenta de Supabase con rol `sincronizador`.                                                                                                                                                                                                |
| `ESPEJO_SYNC_PASSWORD`     | Contraseña de esa cuenta, introducida localmente por la propietaria.                                                                                                                                                                       |
| `ESPEJO_INTERVALO_MINUTOS` | Entero entre 5 y 1440; predeterminado 30.                                                                                                                                                                                                  |
| `RESPALDO_CARPETA_LOCAL`   | Carpeta de copias locales. Vacío usa `respaldos` junto a la base; se crea automáticamente.                                                                                                                                                 |
| `RESPALDO_CARPETA_EXTERNA` | Ruta absoluta existente, distinta de la local, accesible para la cuenta del servicio y sincronizada por Drive. No se crea automáticamente.                                                                                                 |
| `RESPALDO_CLAVE_PUBLICA`   | Clave pública `apr-publica-…` introducida por la propietaria. La privada nunca va en `.env`, repositorio ni copias.                                                                                                                        |
| `REGISTRO_ARCHIVO`         | NSSM lo fija en `apps/server/datos/logs/servidor.log`, con rotación a 10 MB y cinco anteriores. Vacío en ejecución manual escribe a consola.                                                                                               |
| `SEED_ADMIN_USER`          | Solo carga inicial; nombre del administrador. Predeterminado `admin`.                                                                                                                                                                      |
| `SEED_ADMIN_PASSWORD`      | Solo carga inicial; mínimo ocho caracteres. Preferir entrada oculta temporal en memoria, como se muestra debajo.                                                                                                                           |

Ejemplo de CORS: sustituir `<IP_LOCAL>` por la IP reservada. No contiene credenciales:

```dotenv
CORS_ORIGINS="http://<IP_LOCAL>:3000,http://<IP_LOCAL>:3002,http://localhost:3000,http://127.0.0.1:3000,http://tauri.localhost,tauri://localhost"
```

**Detalle comprobado en `src/cors.ts`:** una lista explícita reemplaza la predeterminada y no añade automáticamente Tauri. Incluir `http://tauri.localhost` para Windows; los README que dicen que el POS siempre está permitido omiten este caso.

`start`, `dev` y `migrate` cargan `.env`; el entorno existente tiene prioridad. No tratar todos los vacíos como ausentes: `DATABASE_URL`, `HOST` y `PORT` deben ser válidos. NSSM fija `NODE_ENV` y `REGISTRO_ARCHIVO` en su propio entorno.

Las cuatro credenciales del espejo pueden quedar vacías: la API funciona sin él. Una configuración parcial lo apaga con un aviso. La configuración del Supabase de producción requiere autorización separada; no generar credenciales ni conectar una base de pruebas a ese proyecto.

`RESPALDO_CLAVE_PRIVADA` es una entrada alternativa de los comandos de restauración y claves, no una variable del servidor. No persistirla en `.env`; utilizar el ingreso interactivo oculto y [el procedimiento de restauración](RESPALDO_Y_RESTAURACION.md).

## 3. Migraciones y carga inicial

En una base nueva, antes de instalar el servicio:

```powershell
Set-Location C:\ElApurimeno\apps\server
New-Item -ItemType Directory -Force datos | Out-Null
pnpm migrate
```

Crear la carpeta padre de la base elegida si es distinta de `datos`. `migrate` ejecuta `prisma migrate deploy` y carga `.env` desde `prisma.config.ts`.

**`pnpm seed` no carga `.env` por sí solo.** Usar el mismo script con carga explícita para sembrar la base configurada. La propietaria escribe su contraseña en el aviso oculto, sin incorporarla al historial:

```powershell
$claveInicial = Read-Host 'Contraseña del administrador inicial' -AsSecureString
$punteroClave = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($claveInicial)
try {
    $env:SEED_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($punteroClave)
    node --import tsx --env-file-if-exists=.env src/scripts/sembrar.ts
    if ($LASTEXITCODE -ne 0) { throw 'Falló la carga inicial; no instalar el servicio.' }
} finally {
    Remove-Item Env:SEED_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($punteroClave)
    $claveInicial.Dispose()
}
```

La semilla crea configuración, métodos de pago, rangos, 17 habitaciones y administrador. No carga productos ni personal adicional. No duplica ni actualiza los datos existentes; tampoco cambia una contraseña ya creada. Revisar los precios antes de atender. Para recuperar datos anteriores, restaurar en lugar de sustituir esa operación con la semilla.

## 4. Servicios de Windows con -Produccion

Antes, compilar el Dashboard y Limpieza (necesita internet por las fuentes de Google; compilar cada app por separado):

```powershell
Set-Location C:\ElApurimeno
pnpm --filter web build
pnpm --filter cleaning build
```

`NEXT_PUBLIC_SERVIDOR_URL` es opcional y se fija al compilar. Sin ella, cada app llama a la API en el mismo host de la página, puerto 3001: es lo correcto para los celulares. No fijar `localhost` en una app que se abrirá desde otro dispositivo.

Después, en PowerShell como administrador, desde la raíz:

```powershell
Set-Location C:\ElApurimeno
powershell -NoProfile -ExecutionPolicy Bypass -File apps\server\scripts\instalar-servicio.ps1 -Produccion
```

Con `-Produccion` el script crea o actualiza tres servicios, los inicia y comprueba que respondan:

| Servicio             | Puerto | Qué ejecuta                                                                  | Registro en `apps/server/datos/logs`                                            |
| -------------------- | ------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ApurimenoServidor`  | 3001   | `node --import tsx src/index.ts` en `apps/server`, con `NODE_ENV=production` | `servidor.log` (rota cada 10 MB, guarda 5 anteriores); `servicio.log` (consola) |
| `ApurimenoDashboard` | 3000   | `next start` sobre el build de `apps/web`                                    | `web.log` (consola)                                                             |
| `ApurimenoLimpieza`  | 3002   | `next start` sobre el build de `apps/cleaning`                               | `cleaning.log` (consola)                                                        |

Los tres corren con la cuenta LocalSystem y arranque automático, como un solo proceso `node.exe` (el que escucha el puerto). Si el proceso termina, NSSM lo relanza a los 5 s; si terminara el propio NSSM, Windows reintenta el servicio. La rotación de NSSM queda apagada (ver "Servicio de Windows" en `apps/server/README.md`). El script se detiene sin tocar nada si falta el build de una app o el `JWT_SECRET`.

**`-Pantallas` es solo para pruebas.** Instala el Dashboard y Limpieza sin pasar el servidor a producción, para probarlos en un equipo de desarrollo cuyo `.env` no tiene `JWT_SECRET` ni `CORS_ORIGINS`. En el PC del local se usa siempre `-Produccion`.

Comprobar:

```powershell
foreach ($s in 'ApurimenoServidor','ApurimenoDashboard','ApurimenoLimpieza') { & 'C:\Program Files\NSSM\nssm.exe' status $s }
Invoke-RestMethod http://127.0.0.1:3001/health
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/).StatusCode
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3002/).StatusCode
```

Para aplicar cambios de `apps/server/.env`, como administrador: `& 'C:\Program Files\NSSM\nssm.exe' restart ApurimenoServidor`. `-Desinstalar` elimina los tres servicios sin tocar la base ni las copias.

**No correr `pnpm dev` del Dashboard ni de Limpieza en la carpeta de los servicios.** `next dev` escribe en la misma carpeta `.next` que el build de producción y lo reemplaza, y el servicio deja de arrancar la próxima vez que se inicie. Si pasa, volver a compilar la app y reiniciar su servicio. Ocurrió durante la prueba del 26/09: el instalador lo detectó y no tocó nada.

**Actualizar el código (lo habitual): `recompilar-produccion.ps1`.** Cada actualización de código necesita recompilar el Dashboard y Limpieza y reiniciar los servicios. Hacerlo **en un horario de baja ocupación del local**:

1. Hacer antes una copia con "Copiar ahora".
2. En el checkout de producción, en `main` y sin cambios: `git pull`.
3. Como administrador, desde la raíz:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File apps\server\scripts\recompilar-produccion.ps1
   ```

El script **compila primero, con los servicios funcionando**:

- **Dónde compila:** cada app se compila en `.next-nuevo`, no en `.next`, que es la carpeta que están sirviendo.
- **Qué detiene el proceso:** solo un error real de compilación, es decir, un código de salida distinto de 0. Los avisos de herramientas (Browserslist, avisos de Node) quedan en el registro, `apps/server/datos/logs/compilacion-<app>.log`, y no detienen nada.
- **Si una compilación falla:** los servicios no se tocan, siguen sirviendo lo de antes, y el script muestra las últimas líneas del registro.

**Solo si las dos compilaron, reemplaza:**

- **La interrupción:** detiene los servicios, cambia `.next` por el build nuevo (un cambio de nombre, instantáneo) y los vuelve a iniciar. Los tres servicios del local, y `ApurimenoCapacitacion` si está instalado, se interrumpen **solo durante ese reemplazo**, no mientras compila. El POS tampoco puede cobrar durante ese intervalo, porque el servidor se reinicia.
- **Duración:** el script informa cuánto duró la interrupción. **Medida el 30/09/2026 en el equipo de desarrollo, con los cuatro servicios: 45 s**, desde que empieza a detenerlos hasta que los cuatro responden con el código nuevo. La estimación anterior, de 15 a 30 s, sumaba solo los arranques (unos 7 s el servidor y 6,5 s cada app de Next). Se quedaba corta porque no contaba la detención de los servicios, que se inician y verifican uno tras otro. Contar con alrededor de 1 minuto sin cobros en el POS.
- **Si algo no responde:** si una app no responde con su build nuevo en 40 s, vuelve sola al anterior y queda funcionando con él. El build que falló queda en `.next-fallido` para revisarlo, y el script lo informa como error. Las demás apps siguen con su build nuevo. En ese caso la interrupción se alarga unos 50 s. El build anterior de una app que sí respondió queda en `.next-anterior`.
- **Cómo se probó la vuelta atrás:** `apps/server/scripts/probar-reversion-recompilar.ps1`. Corre el reemplazo real del script con `next start` en los puertos 3100 y 3102 en vez de los servicios, y con un build nuevo del Dashboard que no arranca. Resultado del 28/09/2026: 12 de 12 comprobaciones.

  - El Dashboard volvió a su build anterior, responde y quedó sin nada a medio camino.
  - Limpieza quedó con su build nuevo.
  - Hubo un solo mensaje de error, claro.
  - La interrupción duró 48 s.

  La prueba se corre en un clon o worktree de desarrollo: se niega a correr en el checkout de producción.

**Tiempos medidos** en el equipo de desarrollo:

- **Compilación:** el 28/09/2026, Dashboard unos 30 s y Limpieza unos 20 a 28 s. El 30/09/2026, en la primera corrida real del script, con la compilación en frío, el Dashboard tardó 62 s (el doble) y Limpieza 25 s.
  - **El tiempo de compilación varía** entre corridas, y el PC del local puede tardar más.
  - **No alarga la interrupción:** se compila con los servicios funcionando, y solo se espera más antes de que empiece el reemplazo.
- **Interrupción:** 45 s el 30/09/2026 (ver "Duración", arriba).
- **Cómo medirlo allí sin tocar nada:** correr el script con `-SoloCompilar`, que no toca ningún servicio ni exige administrador. Deja `.next-nuevo` listo e informa los tiempos.

**El script se detiene sin tocar nada** si el checkout no está en `main` sin cambios, si falta un servicio, o si alguna base (la del local o la de capacitación) tiene migraciones pendientes. En ese último caso, usar la actualización completa.

**Por qué así:** el 28/09/2026 un script temporal, que ya no existe, compilaba con los servicios ya detenidos, y un aviso de Browserslist cortó la compilación. Los tres servicios quedaron caídos unos 2,5 minutos. En Windows PowerShell 5.1, redirigir la salida de errores de un programa con `$ErrorActionPreference = "Stop"` convierte cualquier aviso en un error fatal. El script nuevo compila con `cmd /c` y manda la salida a un archivo.

**Actualización completa (cuando cambian las dependencias o hay migraciones).** Si `git pull` trae cambios en `pnpm-lock.yaml` o en `apps/server/prisma/migrations`, `pnpm install` y las migraciones necesitan los servicios detenidos. Aquí la interrupción dura toda la actualización, varios minutos; también en horario de baja ocupación:

1. Hacer antes una copia con "Copiar ahora".
2. Como administrador, detener `ApurimenoDashboard`, `ApurimenoLimpieza`, `ApurimenoServidor` y, si está instalado, `ApurimenoCapacitacion`.
3. `git pull` y `pnpm install --frozen-lockfile`.
4. `pnpm migrate` en `apps/server`, y `pnpm preparar-capacitacion` en la raíz si está la capacitación.
5. `pnpm --filter web build` y `pnpm --filter cleaning build`.
6. Volver a correr el instalador con `-Produccion` (y con `-Capacitacion`, si está).

**Comprobado el 26/09/2026 en el equipo de desarrollo** (con `-Pantallas`):

- **Instalación:** los tres servicios quedaron en ejecución, con arranque automático, cuenta LocalSystem y un solo proceso `node.exe` cada uno.
- **Caídas:** `taskkill /F` del proceso que escucha en 3000 y en 3002, dos veces seguidas cada uno. Volvieron a responder en 6,5 a 6,6 s (la espera de 5 s más el arranque de Next). El servidor vuelve en unos 7 s (prueba anterior).
- **Reinicio del equipo:** hecho el 27/09/2026 a las 00:10. Los tres servicios arrancaron solos y respondieron en 3001, 3000 y 3002.

## 5. Respaldo externo: carpeta física sincronizada por Drive

**Por qué no `G:\Mi unidad`:** el 26/09/2026 el servicio, que corre como LocalSystem, no pudo escribir en `G:/Mi unidad/respaldoApurimeno`. Las copias externas fallaron con `EPERM` / `DESTINO_INACCESIBLE` en cada ciclo, mientras las locales seguían bien. `G:` es una unidad virtual de Google Drive que existe en la sesión de la propietaria y un servicio no la ve ([Microsoft: unidades por sesión](https://learn.microsoft.com/en-us/windows/win32/services/services-and-redirected-drives); [Google: unidad virtual y carpetas del equipo](https://support.google.com/drive/answer/13401938?hl=es)).

**Configuración elegida:** una carpeta física del disco, `C:\RespaldosApurimeno`. El servicio escribe en ella y Google Drive para escritorio la sube:

1. Crear la carpeta `C:\RespaldosApurimeno`, fuera del repositorio y distinta de la carpeta de copias locales.
2. En Google Drive para escritorio: Preferencias → **Mi computadora** ("My Computer" en inglés) → **Agregar carpeta** → elegir `C:\RespaldosApurimeno` → **Sincronizar con Google Drive** → Listo. En la web de Drive la carpeta aparece en **Computadoras**, no en "Mi unidad".
3. En `apps/server/.env`, poner `RESPALDO_CARPETA_EXTERNA="C:/RespaldosApurimeno"` (con barras `/`) y en `RESPALDO_CLAVE_PUBLICA` la clave pública (`apr-publica-…`). La clave privada nunca va ahí.
4. Reiniciar el servidor como administrador: `& 'C:\Program Files\NSSM\nssm.exe' restart ApurimenoServidor`.
5. Esperar el siguiente ciclo de 15 minutos y comprobar tres cosas:
   - en Dashboard → Respaldos, "Copias recientes en la nube" y "Copia externa diaria" sin error rojo ni "Desactualizado";
   - en la carpeta, un `apurimeno-reciente-….db.gz.cifrado` nuevo;
   - en la web de Drive, el mismo archivo. Que exista en el disco no prueba que subió.

**Comprobado el 26/09/2026:**

- **Después del reinicio de las 21:08:** el servidor hizo al arrancar la copia diaria que faltaba. Siguieron 9 ciclos seguidos (21:12 a 23:12) sin ningún `EPERM`.
- **Retención:** en la carpeta quedaron exactamente las 8 recientes.
- **Dashboard:** Respaldos, servido por `ApurimenoDashboard`, muestra las tres tarjetas sin error.

**Drive nunca ve una copia a medio escribir con su nombre final.**

- **Cómo se escribe:** cada copia cifrada se escribe como `….db.gz.cifrado.parcial` en la misma carpeta. Solo cuando termina y se cierra se renombra a su nombre final; el renombrado en el mismo disco es atómico.
- **La foto sin cifrar** se toma en el disco local y nunca pasa por la carpeta de Drive.
- **Si Drive sube un `.parcial`:** puede pasar mientras se escribe, que dura menos de un segundo. No molesta, porque los `.parcial`:
  - se borran antes de cada copia (solo quedan si una copia se cortó, por ejemplo por un corte de luz);
  - no cuentan como copias: no ocupan lugar entre las 8 recientes ni entran en los 30 días;
  - nunca se restauran: `pnpm restaurar` no los lista y rechaza uno aunque se le pase su ruta.
- **Por qué no escribir el temporal fuera de la carpeta sincronizada:** aquí sería peor. La base está en otro disco, y mover entre discos es una copia, no un renombrado atómico.

**Retención:**

| Copias             | Cuándo                                                 | Cuántas se guardan |
| ------------------ | ------------------------------------------------------ | ------------------ |
| Locales            | Cada 15 minutos                                        | Las de 24 horas    |
| Recientes cifradas | Con cada copia local                                   | Las últimas 8      |
| Diarias cifradas   | A las 04:00 de Lima, o al encender si faltó la del día | 30 días            |

La más reciente de cada tipo no se borra por antigüedad.

**Subida a la nube:** necesita Drive abierto en la sesión de la propietaria y conexión a internet. Si Drive no corre, las copias se siguen escribiendo en la carpeta y suben cuando vuelva.

**Espacio en Google Drive: dos medidas obligatorias mientras no haya una solución en el sistema.**

Cada copia reciente que el servidor borra va a la papelera de Drive y ocupa espacio durante 30 días. Con el volumen de un negocio real, los 15 GB gratuitos se llenarían en unos 2 a 7 meses. El análisis y las opciones están en `docs/ESTADO_ACTUAL.md` ("Fuera del MVP"); se retoma a los 2 o 3 meses de operación. Mientras tanto:

1. **Una cuenta de Google solo para los respaldos**, distinta de la personal de la propietaria. Si se llena, no afecta su correo ni sus fotos.
   - Iniciar sesión con esa cuenta en Google Drive para escritorio (Preferencias → Configuración → Agregar otra cuenta) y agregar `C:\RespaldosApurimeno` desde **esa** cuenta, en el paso 2 de arriba.
   - La contraseña de esa cuenta va al gestor de contraseñas de la propietaria.
2. **Revisar el espacio una vez al mes**, con esa cuenta, en [drive.google.com](https://drive.google.com) → Almacenamiento, contando la papelera.
   - Si pasa del 80 %, avisar antes de que se llene.
   - Con la cuenta llena, Drive deja de subir las copias, y el Dashboard no lo nota.

## 6. Dashboard y Limpieza

Instalados como servicios por el mismo script con `-Produccion` (sección 4). Se sirven con `next start` sobre el build de cada app. Es el camino más directo con las configuraciones actuales, que ya traen `build` y `start` ([Next.js en Node](https://nextjs.org/docs/15/app/getting-started/deploying)). Servir las páginas desde Fastify reduciría procesos, pero exigiría exportar ambas apps y cambiar el servidor ya probado. Para una prueba manual sin servicios:

```powershell
pnpm --filter web start --hostname 0.0.0.0 --port 3000
pnpm --filter cleaning start --hostname 0.0.0.0 --port 3002
```

Con el servidor en producción, el navegador solo puede llamar a la API desde los orígenes de `CORS_ORIGINS` (sección 2): incluir `http://<IP_LOCAL>:3000` y `http://<IP_LOCAL>:3002`.

## 7. POS desde el MSI

Artefacto existente comprobado:

```text
apps/native/src-tauri/target/release/bundle/msi/El Apurimeño_0.1.0_x64_en-US.msi
```

Copiar al PC del local y abrir el asistente, o ejecutar:

```powershell
msiexec.exe /i "C:\Instaladores\El Apurimeño_0.1.0_x64_en-US.msi"
```

El MSI generado comprueba WebView2 y descarga su instalador si falta, por lo que ese caso necesita internet. El POS y la API deben estar en la misma máquina: el build comprobado usa `http://localhost:3001`. `VITE_SERVIDOR_URL` se fija al compilar; no cambia al editar `.env` del servidor. Confirmar conexión abriendo el MSI instalado.

El MSI no viene en un clon limpio: `target` es un artefacto de compilación. Instalar el POS no instala la API ni los servicios web.

## 8. Firewall privado

Como administrador, comprobar que la red del local tenga el perfil **Privado**. Las reglas siguientes solo permiten entrada TCP desde la subred local, en red privada:

```powershell
Get-NetConnectionProfile
New-NetFirewallRule -Name 'ApurimenoApiPrivada' -DisplayName 'El Apurimeño - API local' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001 -Profile Private -RemoteAddress LocalSubnet
New-NetFirewallRule -Name 'ApurimenoLimpiezaPrivada' -DisplayName 'El Apurimeño - Limpieza' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3002 -Profile Private -RemoteAddress LocalSubnet
```

**Las reglas de 3002 (Limpieza) y 3001 (API) son necesarias:** el celular abre `http://<IP_LOCAL>:3002`, y esa página llama directamente a la API en `http://<IP_LOCAL>:3001`. Sin la regla de 3002 la app no abre en el celular; sin la de 3001 abre pero no carga datos. Comprobarlo desde un celular conectado al wifi del local.

Abrir 3000 solo si el Dashboard se usará desde otro dispositivo:

```powershell
New-NetFirewallRule -Name 'ApurimenoDashboardPrivada' -DisplayName 'El Apurimeño - Dashboard' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private -RemoteAddress LocalSubnet
```

Abrir 3011 solo si el personal practicará Limpieza desde el celular (sección 9):

```powershell
New-NetFirewallRule -Name 'ApurimenoCapacitacionPrivada' -DisplayName 'El Apurimeño - Capacitación' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3011 -Profile Private -RemoteAddress LocalSubnet
```

Antes de crear las reglas, revisar las que ya existan para no duplicarlas: `Get-NetFirewallRule -Name 'Apurimeno*'`. Una regla nueva y limitada no anula otra más amplia para Node. No abrir 1420 ni 3003, y no publicar puertos en el router. [Referencia de Microsoft](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule).

## 9. Entorno de capacitación

Un espacio aislado para que la propietaria y el personal practiquen el sistema completo (POS, Dashboard y Limpieza) sin tocar datos reales. Es una segunda copia del mismo servidor, `ApurimenoCapacitacion`, en el puerto **3011**, con su propia base. Las apps son las mismas: se conectan a este servidor cuando el usuario escrito en el login empieza con `capacitacion.` (sin distinguir mayúsculas ni tildes), antes de cualquier llamada de red. Detalle técnico y decisiones: `apps/server/README.md`, "Instancia de capacitación".

**Qué lo separa de los datos reales:**

| Qué                | Producción (`ApurimenoServidor`) | Capacitación (`ApurimenoCapacitacion`)                                                     |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------------------------ |
| Puerto             | 3001                             | 3011                                                                                       |
| Base               | `DATABASE_URL`                   | `apps/server/datos/capacitacion/apurimeno-capacitacion.db`, fija                           |
| Espejo en Supabase | Con `ESPEJO_*`                   | Nunca, aunque `ESPEJO_*` esté en `.env`                                                    |
| Respaldos          | Local y `C:\RespaldosApurimeno`  | Solo locales, en `datos/capacitacion/respaldos`; nunca la carpeta de Drive                 |
| Comprobantes       | Normales                         | Con `*** CAPACITACIÓN ***`, en la misma impresora                                          |
| Pantallas          | Normales                         | Banner fijo "MODO CAPACITACIÓN — ningún dato aquí es real", marco y fondo a franjas fucsia |

**Instalar**, una vez que los tres servicios del local funcionan (sección 4). No crea, detiene ni cambia esos tres:

1. Preparar la base y las tres cuentas (`capacitacion.admin`, `capacitacion.cajero1`, `capacitacion.cajero2`). Pide una contraseña para las tres, que no se muestra; no usar la de ninguna cuenta real:

   ```powershell
   Set-Location C:\ElApurimeno
   pnpm preparar-capacitacion
   ```

2. Como administrador, instalar el servicio:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File apps\server\scripts\instalar-servicio.ps1 -Capacitacion
   ```

   Toma el modo (`NODE_ENV`) de `ApurimenoServidor`, así que acepta los mismos orígenes de `CORS_ORIGINS`. Registro en `apps/server/datos/capacitacion/logs`. Para quitarlo: `-Capacitacion -Desinstalar`, que no toca la base ni los otros servicios.

3. Si el personal practicará Limpieza desde el celular, abrir el puerto 3011 en el firewall (sección 8).

**Practicar:** en el POS, el Dashboard o Limpieza, entrar con una cuenta `capacitacion.…`. Antes de enviar ya aparece el aviso "Cuenta de capacitación: entrará al servidor de práctica", y dentro, el banner en todas las pantallas. Todo lo que se haga queda solo en la base de capacitación.

**Volver a empezar de cero:**

```powershell
Set-Location C:\ElApurimeno
pnpm reiniciar-capacitacion
```

Borra todo lo operativo (alquileres, tickets, turnos, movimientos, auditoría, clientes y cuentas creadas al practicar) y vuelve a cargar las 17 habitaciones y los productos de ejemplo. Las tres cuentas quedan con su contraseña. Se corre con el servicio funcionando; quien tenga una sesión de práctica abierta verá la caja cerrada y el tablero vacío.

**Al actualizar el código** (sección 4), `recompilar-produccion.ps1` también reinicia `ApurimenoCapacitacion` y se niega a seguir si su base tiene migraciones pendientes. Si hubo migraciones nuevas, el reinicio de la capacitación también lo avisa. Entonces, como administrador: detener `ApurimenoCapacitacion`, correr `pnpm preparar-capacitacion` (migra y no cambia nada de lo que ya existe) y volver a iniciarlo.

**Comprobado el 27/09/2026 en el equipo de desarrollo:**

- **Servicio:** instalado con `-Capacitacion`, responde en 3011. Los tres servicios del local conservaron su proceso, así que no se reiniciaron.
- **Cuentas y conexión:** el POS entró con las tres cuentas (una escrita "Capacitación.Admin", otra "Capacitacion.cajero2") y todas sus llamadas fueron a 3011, ninguna a 3001.
- **Operación:** un ingreso con su cobro y la salida. Limpieza marcó la habitación como lista, y el Dashboard de capacitación mostró el ingreso.
- **Comprobante:** el comprobante (salida a archivo) y su reimpresión salieron con `*** CAPACITACIÓN ***` (la reimpresión, además, con `*** COPIA ***`), con la Ó bien codificada.
- **Aislamiento:** la base de producción quedó con las mismas cifras (tickets, alquileres, turnos, pagos, auditoría) y sin cuentas `capacitacion.`. El proceso de capacitación no abrió ninguna conexión fuera del equipo, y su registro no tiene sincronizaciones ni copias externas.
- **Reinicio:** con el servicio funcionando, quedó todo en cero, con 17 habitaciones libres y 8 productos. Las tres cuentas siguieron entrando con la misma contraseña.
- **Pendiente:** la impresión física, con la impresora conectada (parte 2).

## 10. Lista final

- [ ] Revisión Git y versiones anotadas; instalación con lockfile correcta.
- [ ] `pnpm check-types`, `pnpm lint` y `pnpm test` pasan desde la raíz.
- [ ] `.env` completado por la propietaria, excluido de Git y sin clave privada de respaldo.
- [ ] Migraciones y semilla sobre la base elegida; configuración, precios, productos y personal revisados.
- [ ] Dashboard y Limpieza compilados; instalador corrido con `-Produccion` (no `-Pantallas`); los tres servicios responden.
- [ ] MSI abre, inicia sesión y consulta la API con los permisos correctos.
- [ ] Limpieza abre desde un celular en `http://<IP_LOCAL>:3002`; CORS correcto.
- [ ] Firewall limitado al perfil privado y subred local.
- [ ] `C:\RespaldosApurimeno` agregada en Drive → Mi computadora; copia local y reciente cifrada nuevas tras un ciclo automático; copia diaria presente.
- [ ] Dashboard → Respaldos sin error rojo y archivo visible en la web de Drive.
- [ ] Arranque automático de los tres servicios comprobado tras un reinicio hecho por la propietaria; `taskkill /F` de cada uno y vuelta sola.
- [ ] Drive inicia en la sesión; se conoce que la subida requiere sesión activa e internet.
- [ ] La carpeta de respaldos sincroniza con una cuenta de Google solo para respaldos, y la revisión mensual de su espacio (con la papelera) está agendada.
- [ ] Capacitación: `pnpm preparar-capacitacion` y `-Capacitacion` instalados; se entra con `capacitacion.admin` y aparece el banner; `pnpm reiniciar-capacitacion` deja todo limpio.
- [ ] Restauración ensayada de forma separada siguiendo la guía, sin sustituir la base operativa.
- [ ] Pendientes explícitos: impresión física, Supabase de producción y piloto con cuaderno.

Fuentes locales: `apps/server/scripts/instalar-servicio.ps1`, `src/registro.ts`, `src/respaldo/copia.ts`, `src/respaldo/control.ts`, `src/respaldo/restauracion.ts`, `apps/server/package.json`, `.env.example`, `prisma.config.ts`, `src/index.ts`, `src/cors.ts`, `src/scripts/sembrar.ts`, `src/semilla.ts`, `src/respaldo/`, `src/espejo/configuracion.ts`; README y configuraciones de web, cleaning y native; WiX y build del POS; `docs/RESPALDO_Y_RESTAURACION.md`.
