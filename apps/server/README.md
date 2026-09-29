# server

Backend local de **El Apurimeño**: Fastify + Prisma 7 + SQLite (modo WAL). Envuelve las funciones puras
de `@apurimeno/domain` y valida entradas y salidas con `@apurimeno/contracts`. Aquí no se reescribe
lógica de negocio: el servidor solo lee datos, llama al dominio, persiste el resultado en una
transacción y expone HTTP.

## Puesta en marcha

```bash
pnpm install                        # también genera el cliente de Prisma (postinstall)
cd apps/server
pnpm migrate                        # prisma migrate deploy: crea ./datos/apurimeno.db
SEED_ADMIN_PASSWORD='...' pnpm seed # configuración, métodos de pago, rangos, 17 habitaciones, usuario admin
pnpm dev                            # migra y levanta el servidor en 0.0.0.0:3001 con recarga
```

Variables de entorno (ver `.env.example`). `pnpm start`, `pnpm dev` y `pnpm migrate` leen `apps/server/.env` si existe; lo
que ya esté definido en el entorno tiene prioridad, y un valor vacío cuenta como no definido.

| Variable | Por defecto | Nota |
|---|---|---|
| `DATABASE_URL` | `file:./datos/apurimeno.db` | |
| `JWT_SECRET` | aleatorio por arranque | **Obligatorio en producción** (`NODE_ENV=production`), al menos 32 caracteres. En desarrollo, las sesiones se invalidan al reiniciar. |
| `HOST` / `PORT` | `0.0.0.0` / `3001` | Escucha en la red local para el POS, el Dashboard y la app de limpieza (RES-04). |
| `CORS_ORIGINS` | en desarrollo, `http://localhost` y `http://127.0.0.1` en los puertos 3000, 3002 y 3003; en producción, ninguno | Orígenes de navegador que pueden llamar a la API, separados por comas y exactos (esquema, host y puerto). No admite `*`: el servidor no arranca con un comodín o un origen mal formado. Para el celular de limpieza en la red del local: `CORS_ORIGINS=http://192.168.1.50:3002` (la IP de la máquina que sirve la app). |
| `IMPRESORA_DISPOSITIVO` | — | Ruta a la que se escriben los comprobantes ESC/POS, p. ej. `/dev/usb/lp0` en Linux. Sin ella, quedan en cola (`PENDIENTE`). |
| `IMPRESORA_PAGINA_CODIGOS` | `PC850` | `PC850` o `WPC1252`, según la página de prueba (`pnpm prueba-impresora`). |
| `SEED_ADMIN_USER` / `SEED_ADMIN_PASSWORD` | `admin` / — | Solo para `pnpm seed`. |
| `ESPEJO_SUPABASE_URL`, `ESPEJO_SUPABASE_ANON_KEY` | — | Proyecto de Supabase del espejo en la nube y su clave **publicable**. Una clave secreta o `service_role` se rechaza. Ver "Espejo en la nube". |
| `ESPEJO_SYNC_EMAIL` / `ESPEJO_SYNC_PASSWORD` | — | Cuenta de Supabase Auth con rol `sincronizador` (`supabase/README.md`). |
| `ESPEJO_INTERVALO_MINUTOS` | `30` | Minutos entre sincronizaciones automáticas, de 5 a 1440. |
| `RESPALDO_CARPETA_LOCAL` | `respaldos/` junto a la base | Copias locales cada 15 minutos. Ver "Respaldos". |
| `RESPALDO_CARPETA_EXTERNA` | — | Ruta completa de la carpeta que se sincroniza con la nube (Google Drive, OneDrive). Debe existir. Sin ella, no hay copia externa y el Dashboard lo advierte. |
| `RESPALDO_CLAVE_PUBLICA` | — | Clave **pública** de cifrado (`apr-publica-…`, de `pnpm clave-respaldo`). La privada nunca va aquí: el servidor la rechaza. |

## Servicio de Windows (arranque automático)

En el PC del local, el servidor corre como servicio de Windows con [NSSM](https://nssm.cc/): arranca solo al encender
el equipo (aunque nadie inicie sesión) y se reinicia solo si se cae. Lo instala `scripts/instalar-servicio.ps1`, que:

1. descarga NSSM 2.24-101 del sitio oficial (la versión recomendada para Windows 10 y 11), verifica su SHA-256 y lo
   deja en `C:\Program Files\NSSM\nssm.exe`;
2. crea el servicio `ApurimenoServidor` ("El Apurimeño - servidor local"): un solo proceso `node.exe --import tsx`
   en `apps/server`, igual que `pnpm start` (lee `apps/server/.env`), cuenta `LocalSystem` y arranque automático. Si
   el servidor se cae, NSSM lo vuelve a lanzar a los 5 s; si terminara el propio NSSM, Windows reintenta el servicio
   (5 s, 5 s y 30 s). El registro lo escribe el propio servidor en `datos/logs/servidor.log` y lo rota cada 10 MB
   mientras corre (ver abajo); `datos/logs/servicio.log` guarda solo lo que salga por la consola;
3. con `-Produccion`, crea también `ApurimenoDashboard` (puerto 3000) y `ApurimenoLimpieza` (puerto 3002): `next start`
   sobre el build de producción de cada app, con la misma recuperación (ver `docs/INSTALACION_LOCAL.md`, sección 4).
   `-Pantallas` los instala sin pasar el servidor a producción: solo para probarlos en un equipo de desarrollo;
4. los inicia y comprueba que responden (`/health` en el servidor).

**Antes:** `pnpm install` en la raíz, y en `apps/server` el `.env`, `pnpm migrate` y, la primera vez, `pnpm seed`.

**Instalación**, en una PowerShell **abierta como administrador** (crear un servicio lo exige), en la raíz del
repositorio:

```powershell
# PC del local: NODE_ENV=production (exige JWT_SECRET en apps/server/.env; CORS solo con CORS_ORIGINS)
powershell -NoProfile -ExecutionPolicy Bypass -File apps\server\scripts\instalar-servicio.ps1 -Produccion
# Equipo de desarrollo
powershell -NoProfile -ExecutionPolicy Bypass -File apps\server\scripts\instalar-servicio.ps1
```

Así se instaló el 26/09/2026 en el equipo de desarrollo, desde una PowerShell sin permisos de administrador (abre el
aviso de Control de cuentas de usuario y deja el registro de la instalación en `datos/logs`):

```powershell
Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass',
  '-File','"D:\dev\el-apurimeno\apps\server\scripts\instalar-servicio.ps1"',
  '-Registro','"D:\dev\el-apurimeno\apps\server\datos\logs\instalacion-servicio.log"')
```

Volver a correr el script actualiza los servicios existentes. `-Desinstalar` los elimina (no toca la base ni las copias).

**Uso diario** (como administrador): `nssm status|stop|start|restart ApurimenoServidor`, o desde "Servicios" de
Windows. Ver la configuración: `nssm dump ApurimenoServidor`. Registro: `apps/server/datos/logs/servidor.log` (los anteriores,
`servidor.1.log` … `servidor.5.log`); un error al arrancar queda en `servicio.log`.

**Actualizar el sistema:** hacer una copia con "Copiar ahora" antes (RNF-DEPL-02) y detener los servicios (con el
servidor corriendo, `pnpm install` no puede reemplazar los archivos de la base SQLite en uso); `git pull`,
`pnpm install`, `pnpm migrate` en `apps/server`, compilar el Dashboard y Limpieza, y volver a correr el instalador.

**Comprobado el 26/09/2026 en el equipo de desarrollo:** al reiniciar el PC, el servicio arrancó solo y el POS se
conectó sin abrir nada. Con el servidor matado a la fuerza (`taskkill /F`), volvió a responder en `/health` en unos
7 s (6,8 a 7,1 s: la espera de 5 s más el arranque), en caídas seguidas.

**Detalles de configuración, con su porqué:**
- **Un solo proceso** (`node --import tsx`), no el lanzador `tsx`: ese deja dos procesos `node`, y matar solo el hijo
  lo dejaría huérfano con el puerto tomado.
- **El registro lo rota el servidor, no NSSM.** NSSM solo rota por tamaño mientras el proceso corre con la rotación "en
  línea" (`AppRotateOnline 1`), y con ella, al morir el proceso, NSSM quedaba esperando el hilo que lee su salida y
  nunca lo relanzaba (el servicio seguía "En ejecución" sin servidor). Por eso el servicio fija
  `REGISTRO_ARCHIVO=datos\logs\servidor.log` y el servidor (`src/registro.ts`) pasa a un archivo nuevo al llegar a
  10 MB, sin reiniciarse, y conserva 5 anteriores: como mucho unos 60 MB. La rotación de NSSM queda apagada
  (`AppRotateFiles 0`): la de arranque dejaba un archivo nuevo en cada inicio aunque estuviera vacío, y
  `servicio.log` solo recibe lo que salga por la consola.

  Comprobado el 26/09/2026 con el servicio instalado: unas 27 000 consultas a `/health` en 7 s llevaron el registro a
  10 MB, y rotó (dos veces, en dos pruebas) sin cambiar de proceso. Matado a la fuerza antes y después de rotar, volvió
  a responder en 6,9 a 7,2 s.

**A tener en cuenta:**
- Corre como `LocalSystem`: puede escribir en `datos/` y en la carpeta sincronizada del perfil de la propietaria.
  Drive u OneDrive tienen que estar iniciados con su sesión para subir las copias.
- Sin `-Produccion`, `JWT_SECRET` vacío genera uno nuevo en cada arranque: tras un reinicio hay que volver a iniciar
  sesión en el POS y el Dashboard. En el PC del local se usa `-Produccion` con un `JWT_SECRET` fijo.
- El equipo no debe suspenderse: las copias, el espejo y la impresión corren dentro del servicio.

**Actualizar el código: `scripts/recompilar-produccion.ps1`** (uso en `docs/INSTALACION_LOCAL.md`, sección 4).
Compila el Dashboard y Limpieza con los servicios funcionando y solo después reemplaza. Decisiones (28/09/2026):

- **Otra carpeta de compilación:** `CARPETA_COMPILACION` elige la carpeta del build en el `next.config.ts` de cada
  app; por defecto sigue siendo `.next`. El script compila en `.next-nuevo` y al final cambia los nombres, con los
  servicios detenidos solo durante ese cambio.
- **Archivos preparados para esa carpeta:** los `tsconfig.json` ya incluyen `.next-nuevo/types`. Si no, Next los
  reescribe al compilar y el checkout de producción queda con cambios. `.next-nuevo/`, `.next-anterior/` y
  `.next-fallido/` están en `.gitignore`: si no, el checkout de producción quedaría con cambios y la siguiente
  corrida se negaría a seguir.
- **Solo el código de salida cuenta como error:** la compilación va por `cmd /c` con la salida a un archivo, para que
  PowerShell 5.1 no convierta en error los avisos de Browserslist o de Node. No se actualizó `caniuse-lite`: el
  aviso de Browserslist no es el único que sale por la salida de errores (también `punycode` de Node), y actualizarlo
  cambia el lockfile de todas las apps sin resolver el problema.
- **No migra:** si alguna base tiene migraciones pendientes (`prisma migrate status`, que funciona con el servidor
  encendido), se niega antes de tocar nada y remite a la actualización completa, que empieza con una copia.
- **Qué reinicia:** también `ApurimenoCapacitacion`, porque corre el mismo código.
- **Vuelta atrás:** si una app no responde con su build nuevo, vuelve sola al anterior y se informa. El build que
  falló queda en `.next-fallido`.
- **Espera de respuesta:** tiene un plazo de 40 s en total, no 40 intentos. En Windows, cada intento contra un
  puerto donde nadie escucha tarda unos 2 s en fallar, y con 40 intentos la espera se estiraba a 2 minutos con el
  servicio detenido: pasó en la primera prueba de la vuelta atrás.
- **Cómo se prueba sin tocar los servicios reales:** el reemplazo está en la función `Reemplazar-Builds`, y detener
  o iniciar un servicio en `Detener-Servicio` / `Iniciar-Servicio`. Cargado con `.`, el script solo define sus
  funciones. `scripts/probar-reversion-recompilar.ps1` lo carga, reemplaza esas dos funciones por `next start` en
  los puertos 3100 y 3102, y comprueba la vuelta atrás con un build que no arranca. Se niega a correr en la carpeta
  desde la que sirven los servicios reales.

## Instancia de capacitación

Una segunda copia de este mismo servidor para que la dueña y el personal practiquen sin tocar datos reales. Se
arranca con el argumento `--capacitacion` (`src/instancia.ts`); instalación y uso en `docs/INSTALACION_LOCAL.md`,
sección 9.

**Qué la aísla.** Es un argumento de la línea de comandos, no una variable: un `.env` mal copiado no convierte un
servidor en el otro. Con `--capacitacion` el servidor **ignora** `DATABASE_URL`, `PORT`, `JWT_SECRET`, `ESPEJO_*` y
`RESPALDO_*` aunque estén definidas. La base es fija, `datos/capacitacion/apurimeno-capacitacion.db`, y el puerto es
3011 (`CAPACITACION_PORT` lo cambia). El transporte a Supabase no se crea nunca, y las copias van solo junto a su
base, en `datos/capacitacion/respaldos`, nunca a la carpeta sincronizada. El servidor de producción se niega a
arrancar si su `DATABASE_URL` apunta a la base de capacitación. De `.env` solo toma lo que no lleva datos a ningún
lado: `HOST`, `CORS_ORIGINS`, la impresora y `NODE_ENV`. Lo comprueba `test/capacitacion.test.ts` con el `.env`
completo de producción.

**Cuentas:** `capacitacion.admin` (Administrador), `capacitacion.cajero1` y `capacitacion.cajero2` (Cajero), creadas
por `pnpm preparar-capacitacion` con una contraseña que se escribe al prepararla. No se copia ninguna cuenta ni
credencial de producción. Las apps eligen el servidor mirando el usuario escrito en el login
(`packages/ui/src/lib/capacitacion.ts`); la autenticación de este servidor no cambia.

**Comprobantes:** todo comprobante de esta instancia lleva `*** CAPACITACIÓN ***`, en el mismo lugar y tamaño que
`*** COPIA ***` (la reimpresión lleva las dos), tanto el impreso como la vista previa del Dashboard. Usa la misma
impresora que producción.

**Decisiones de interpretación** (27/09/2026):

- **Modo del servicio:** `-Capacitacion` copia el `NODE_ENV` de `ApurimenoServidor`. Así acepta los mismos orígenes
  (`CORS_ORIGINS`): en el PC del local, producción; en uno de desarrollo, los orígenes de desarrollo.
- **Secreto de las sesiones:** nunca el de producción. Sin `CAPACITACION_JWT_SECRET`, uno nuevo en cada arranque:
  al reiniciar el servicio hay que volver a entrar.
- **Copias locales:** sí, junto a su base. El pedido excluye la carpeta de respaldos y cualquier carpeta
  sincronizada, no las copias locales, y así un reinicio accidental se puede deshacer.
- **Qué borra el reinicio** (`pnpm reiniciar-capacitacion`): todo lo operativo (alquileres, tickets, pagos, turnos,
  movimientos de caja e inventario, códigos, trabajos de impresión y auditoría), más los clientes, las cuentas
  creadas al practicar y el estado del espejo. Recarga las 17 habitaciones de la semilla (con sus precios) y los 8
  productos de ejemplo. No toca las tres cuentas ni su contraseña, la configuración, los métodos de pago ni los
  rangos. Se niega a correr si la base no tiene las tres cuentas.
- **El reinicio no aplica migraciones:** `prisma migrate deploy` necesita la base en exclusiva y el servicio la tiene
  abierta. El reinicio corre con el servicio funcionando y solo comprueba que no falte ninguna. Si falta, pide
  detener el servicio y correr `pnpm preparar-capacitacion`, que migra y no cambia nada de lo que ya existe.

## Endpoints

Los cuerpos de entrada y salida están en `@apurimeno/contracts` (`api.ts`, constante `RUTAS`). Todos
requieren `Authorization: Bearer <token>`, salvo `/auth/login` y `/health`.

| Método y ruta | Operación (`puede()`) | Idempotente |
|---|---|---|
| `POST /auth/login` | pública | — |
| `GET /health` | pública | — |
| `POST /turnos` | `ABRIR_TURNO` | — |
| `GET /turnos/actual` | `ABRIR_TURNO` o `CERRAR_TURNO` | — |
| `GET /tablero` | `CONSULTAR_TABLERO` | — |
| `POST /turnos/actual/cierre` | `CERRAR_TURNO` | — |
| `POST /alquileres/cotizacion` | `REGISTRAR_INGRESO` | — |
| `POST /alquileres` | `REGISTRAR_INGRESO` | Sí |
| `GET /alquileres/:id/hora-adicional/cotizacion` | `COBRAR_HORA_ADICIONAL` | — |
| `POST /alquileres/:id/horas-adicionales` | `COBRAR_HORA_ADICIONAL` | Sí |
| `POST /alquileres/:id/salida` | `REGISTRAR_SALIDA` | — |
| `POST /alquileres/:id/salida-sin-pago` | `REGISTRAR_SALIDA_SIN_PAGO` | — |
| `GET /categorias-producto` | `VENDER` o `GESTIONAR_PRODUCTOS` | — |
| `POST /categorias-producto` | `GESTIONAR_PRODUCTOS` | — |
| `GET /productos?codigoBarras=&incluirInactivos=` | `VENDER` o `GESTIONAR_PRODUCTOS`; `incluirInactivos=true` exige `GESTIONAR_PRODUCTOS` | — |
| `POST /productos`, `PUT /productos/:id` | `GESTIONAR_PRODUCTOS` | — |
| `POST /productos/:id/reposicion` | `REPONER_INVENTARIO` | — |
| `POST /ventas` | `VENDER` | Sí |
| `POST /codigos-autorizacion` (cuerpo opcional `{ operacion }`: `ANULAR_TICKET` por defecto o `REINTENTAR_CIERRE_TURNO`) | `GENERAR_CODIGO_AUTORIZACION` | — |
| `POST /tickets/:id/anulacion` | `ANULAR_TICKET` o `ANULAR_TICKET_CON_CODIGO` | Sí |
| `GET /reportes/ventas?desde=&hasta=` | `CONSULTAR_REPORTES` | — |
| `GET /reportes/arqueos?desde=&hasta=` | `CONSULTAR_REPORTES` | — |
| `GET /reportes/ocupacion?desde=&hasta=` | `CONSULTAR_REPORTES` | — |
| `POST /turnos/actual/movimientos` | `REGISTRAR_MOVIMIENTO_CAJA` | Sí |
| `GET /habitaciones/pendientes-limpieza` | `VER_PENDIENTES_LIMPIEZA` | — |
| `POST /habitaciones/:id/lista` | `MARCAR_HABITACION_LISTA` | — (decisión 18) |
| `POST /habitaciones/:id/reporte-mantenimiento` | `REPORTAR_MANTENIMIENTO` | — (decisión 18) |
| `GET /habitaciones` | `CONSULTAR_TABLERO`, `GESTIONAR_HABITACIONES` o `BLOQUEAR_O_REACTIVAR_HABITACION` | — |
| `POST /habitaciones`, `PUT /habitaciones/:id` | `GESTIONAR_HABITACIONES` | — |
| `POST /habitaciones/:id/bloqueo`, `POST /habitaciones/:id/reactivacion` | `BLOQUEAR_O_REACTIVAR_HABITACION` | — |
| `GET /clientes?q=` | `BUSCAR_CLIENTE` o `GESTIONAR_PRECIO_ESPECIAL` | — |
| `POST /clientes`, `PUT /clientes/:id` | `REGISTRAR_CLIENTE` o `GESTIONAR_PRECIO_ESPECIAL` | — |
| `GET`/`POST /clientes/:id/precios-especiales` | `GESTIONAR_PRECIO_ESPECIAL` | — |
| `PUT`/`DELETE /clientes/:id/precios-especiales/:habitacionId` | `GESTIONAR_PRECIO_ESPECIAL` | — |
| `GET /usuarios`, `POST /usuarios`, `PUT /usuarios/:id` | `GESTIONAR_USUARIOS` | — |
| `PUT /usuarios/:id/contrasena` | `GESTIONAR_USUARIOS` | — |
| `GET /rangos` | `GESTIONAR_USUARIOS` o `GESTIONAR_RANGOS` | — |
| `POST /rangos`, `PUT /rangos/:id` | `GESTIONAR_RANGOS` | — |
| `GET /turnos/abiertos` | `FORZAR_CIERRE_TURNO` | — |
| `POST /turnos/:id/cierre-forzado` | `FORZAR_CIERRE_TURNO` | — |
| `GET /configuracion`, `PUT /configuracion` | `CONFIGURAR_PARAMETROS` | — |
| `GET /metodos-pago` | `CONSULTAR_TABLERO` o `CONFIGURAR_METODOS_PAGO` | — |
| `POST /metodos-pago`, `PUT /metodos-pago/:id` | `CONFIGURAR_METODOS_PAGO` | — |
| `GET /auditoria?usuarioId=&accion=&tipoEntidad=&entidadId=&desde=&hasta=&limite=&despuesDe=` | `CONSULTAR_AUDITORIA` | — |
| `POST /tickets/:id/reimpresion` | `REIMPRIMIR_COMPROBANTE` | — |
| `GET /tickets?numero=&desde=&hasta=&limite=` | `REIMPRIMIR_COMPROBANTE` o `CONSULTAR_REPORTES` | — |
| `GET /espejo` | `CONSULTAR_ESTADO_ESPEJO` | — |
| `POST /espejo/sincronizacion` | `SINCRONIZAR_ESPEJO` | — (una a la vez) |
| `GET /respaldos` | `CONSULTAR_ESTADO_RESPALDOS` | — |
| `POST /respaldos/copia` | `RESPALDAR` | — (una a la vez por destino) |

Todavía falta **el envío real a la impresora** (ADR-05, parte 2): USB o Bluetooth hacia la REDPOS RED-E803,
la impresora en Windows y reintentar los trabajos en `ERROR` o `PENDIENTE` (RF-56). Ver "Impresión".

`GET /tablero` devuelve cada habitación con su alquiler abierto, el estado temporal calculado con la hora del
servidor y `ahora` para corregir el reloj del POS (Planos §11.2 lo llamaba `/rooms/board`). Los avisos por
WebSocket de los Planos no se implementaron: el POS pide el tablero cada 15 s y recalcula el estado cada segundo
con el dominio (ver `apps/native/README.md`).

### Rangos, cierre forzado, configuración y métodos de pago

- **Rangos (CU-24):** alta y edición de combinaciones del catálogo fijo; el nombre es único. Editar un
  rango rige de inmediato para quienes lo tienen (RF-63). Quien edita no puede quitarse `users.manage`
  por esta vía (`SELF_LOCKOUT_FORBIDDEN`, decisión 19). No hay eliminación: el SRS no la pide.
- **Cierre forzado (CU-20, RF-43):** el Administrador lista los turnos abiertos (sin el esperado, RN-34)
  y cierra uno ajeno, contando el cajón o no. Queda `cierreForzado` y auditado como
  `TURNO_CIERRE_FORZADO`. El propio turno se cierra por la vía normal.
- **Configuración (CU-27):** se lee y se reemplaza completa, auditada con el valor previo. Los
  parámetros rigen para los alquileres que empiecen después (RN-43).
- **Métodos de pago (RF-54):** alta, edición y habilitación; uno deshabilitado ya no se acepta al cobrar.
  `afectaCaja` no se edita (decisión 20 de contracts). Se auditan como `CONFIGURACION_CAMBIADA` con
  `tipoEntidad` `METODO_PAGO`, porque §23.1 no trae una acción propia.

### Espejo en la nube (ADR-06, RF-60)

El servidor publica en Supabase un **resumen** para que la propietaria lo vea desde fuera del local
(la vista remota lee directo de Supabase, nunca de este servidor). Qué lleva y qué no: decisión 22 de contracts. Resumen:
ventas, anulados y ocupación por día de Lima, y arqueos de turnos cerrados; nunca clientes, tickets,
productos, auditoría ni el estado de las habitaciones en vivo (RN-45, RIE-08).

- **Solo sale, nunca entra** (RNF-SYNC-01): nada que llegue del espejo se escribe en la base local. El
  servidor solo guarda el estado de la sincronización (`EstadoEspejo`).
- **Cuándo:** 10 s después de arrancar y luego cada `ESPEJO_INTERVALO_MINUTOS` (30), más el botón
  "Sincronizar ahora" del Dashboard (`POST /espejo/sincronizacion`, auditado como `ESPEJO_SINCRONIZADO`).
  Una vuelta a la vez: si hay una en curso, la manual responde 409 `SINCRONIZACION_EN_CURSO`.
- **Qué publica cada vuelta:** hoy y ayer, más los días y turnos que cambiaron desde la última
  sincronización correcta (con 5 minutos de margen). Una anulación vuelve a publicar el día del cobro
  original y su turno; una hora adicional, el día en que ingresó el alquiler. La primera vez, o con
  `{ "completo": true }`, publica todo el historial. Cada fila se reemplaza (upsert), así que repetir no
  duplica nada.
- **Si falla** (sin internet, credenciales, tablas faltantes), el local sigue igual (RNF-SYNC-02): el
  error queda en `GET /espejo` y en el registro, y la siguiente vuelta vuelve a intentar lo mismo.
- **Credenciales:** entra con la cuenta `sincronizador`, que solo puede insertar y actualizar las tablas
  del resumen (row-level security). Nunca la clave secreta: daría acceso total al proyecto si se filtrara
  del equipo del local. Tablas, políticas y cuentas: `supabase/README.md`.
- **Sin las variables `ESPEJO_*`**, no hay espejo y el servidor funciona igual. Si están a medias o mal,
  el espejo queda apagado y `GET /espejo` dice qué falta (`problemaConfiguracion`); el servidor arranca
  igual.
- El equipo del local no debe suspenderse: la sincronización corre dentro del servidor.

### Respaldos (Planos §14.3, RNF-BKP-01)

Copias completas y restaurables de la base, distintas del espejo (que solo tiene totales). Frecuencia, destino,
retención, hora y cifrado los decidió la propietaria (decisión 23 de contracts). Configuración y restauración paso a
paso: `docs/RESPALDO_Y_RESTAURACION.md`.

| | Local | Reciente en la nube | Externa diaria |
|---|---|---|---|
| Cuándo | 10 s después de arrancar y cada 15 min (contando desde la última copia, también tras un reinicio) | Con cada copia local: es la misma foto, cifrada | A las 04:00 de Lima; si el servidor estaba apagado a esa hora, apenas enciende. Si falla, reintenta cada 15 min |
| Dónde | `RESPALDO_CARPETA_LOCAL` (por defecto `datos/respaldos/`) | `RESPALDO_CARPETA_EXTERNA`, que la propietaria sincroniza con la nube | La misma carpeta |
| Formato | `apurimeno-AAAAMMDDTHHMMSSZ.db`: una base SQLite lista para usar | `apurimeno-reciente-AAAAMMDDTHHMMSSZ.db.gz.cifrado` | `apurimeno-AAAAMMDDTHHMMSSZ.db.gz.cifrado`: gzip + X25519/AES-256-GCM |
| Retención | 24 horas | Las últimas 8 (2 horas) | 30 días |

- **Consistente sin detener nada:** `VACUUM INTO` toma una foto en una sola transacción de lectura (en WAL no
  bloquea a quien escribe) e incluye lo que todavía está en el WAL. La copia se verifica (`integrity_check` y
  tablas del sistema) antes de tomar su nombre final: un archivo con nombre de copia siempre está sano.
- **Cifrado de clave pública:** el servidor solo tiene la pública, que cifra pero no descifra. La privada está en
  el gestor de contraseñas de la propietaria y solo hace falta para restaurar. La foto sin cifrar de la copia
  externa se toma en la carpeta local y se borra al terminar: por la carpeta sincronizada solo pasa lo cifrado.
- **Retención:** solo borra archivos con nombre de copia; la más reciente nunca se borra, aunque sea vieja, para
  que la carpeta no quede vacía si las copias dejan de hacerse.
- **Si falla** (carpeta desconectada, sin permiso, disco lleno), el local sigue igual: el error queda en
  `GET /respaldos` y el Dashboard marca "Desactualizado" (locales: más de 30 min sin copia; externa: más de 1 h
  después de las 04:00 sin la copia del día). "Copiar ahora" (`POST /respaldos/copia`) se audita como
  `RESPALDO_MANUAL`.
- **Restaurar:** `pnpm restaurar` (lista), `pnpm restaurar ultima` o `pnpm restaurar <archivo>`, con el servidor
  detenido. Verifica la copia completa antes de tocar la base; la actual queda apartada en `reemplazada-…`, y
  aplica las migraciones que falten.
- **Claves:** `pnpm clave-respaldo` genera un par sin escribir nada en disco y muestra la privada una vez;
  `pnpm clave-respaldo --privada-en <archivo>` la escribe en un archivo nuevo sin mostrarla; `pnpm clave-respaldo
  publica` deriva la pública de la privada, para configurar otro equipo.

### Auditoría y reimpresión

- **Auditoría (CU-25, RF-46):** filtros combinables por usuario, acción, entidad y periodo `[desde, hasta)`.
  Del más reciente al más antiguo, hasta 200 por página (50 por defecto), y `siguiente` para pedir la
  siguiente página con `despuesDe`. Registros del mismo milisegundo se ordenan por id.
- **Reimpresión (CU-22, RF-44):** encola una copia (`esCopia`) y responde el contenido compuesto por
  `componerComprobante` del dominio: "COPIA" visible, sin datos del cliente (RN-38), con la leyenda de
  documento no tributario (RN-39), a 48 o 32 columnas según el papel configurado. La copia sale por la
  misma cola que los cobros (ver "Impresión"); sin `IMPRESORA_DISPOSITIVO`, queda `PENDIENTE`.

### Limpieza (CU-15 a CU-17)

Lo que usa `apps/cleaning` (`src/api.ts`): una lista y dos acciones que se envían solo con el id.
- `GET /habitaciones/pendientes-limpieza` devuelve **solo** las habitaciones en `PENDIENTE_LIMPIEZA`
  (RF-40). El filtro lo aplica el servidor.
- `POST /habitaciones/:id/lista` (`PENDIENTE_LIMPIEZA → LIBRE`) y `POST /habitaciones/:id/reporte-mantenimiento`
  (`PENDIENTE_LIMPIEZA → MANTENIMIENTO`) no llevan cuerpo. El reporte admite `{ "motivo": "..." }`
  opcional (RF-41: recomendado), que queda en la auditoría. Ambas responden la habitación actualizada.
- Sin `idempotency-key`: repetir la acción sobre una habitación que ya cambió responde 422
  `INVALID_STATE_TRANSITION` y no cambia nada. `apps/cleaning` quita la tarjeta solo cuando el servidor
  confirma; si falla (ese 422, un 403, 404 o sin red), avisa y recarga la lista.
- Si dos personas actúan a la vez sobre la misma habitación, solo una cambia el estado: la actualización
  exige que el estado siga siendo el leído.

### Administración

- **Habitaciones (CU-13, CU-14):** el alta queda `LIBRE`; editar cambia número, descripción y precio de
  lista, nunca el estado, y los alquileres abiertos conservan su precio (RN-44). Bloquear exige motivo y
  una habitación `LIBRE` (sin alquiler abierto); reactivar devuelve de `MANTENIMIENTO` a `LIBRE`.
- **Clientes (CU-09):** búsqueda parcial por documento o nombre (hasta 20 resultados). El cajero los
  registra al tomar un ingreso (operación `REGISTRAR_CLIENTE`, con `rentals.checkin`). El documento es
  único cuando existe (decisión 17 de contracts).
- **Precios especiales (CU-08):** el alta de una combinación que ya existe responde
  `CLIENT_ROOM_PRICE_ALREADY_EXISTS` (RF-16); se edita o elimina por cliente + habitación. Todo se audita.
- **Usuarios (CU-23):** alta, edición, desactivación (nunca eliminación) y asignación de rangos. La
  desactivación y el cambio de rangos rigen en la siguiente solicitud del usuario, aunque su token siga
  vigente (RF-63). Nadie puede desactivar su propia cuenta ni quitarse `users.manage`: responde 422
  `SELF_LOCKOUT_FORBIDDEN` (decisión 19); otro administrador sí puede. La contraseña (mínimo 8
  caracteres) nunca vuelve en una respuesta ni se audita.
  Cambiarla no invalida los tokens ya emitidos; desactivar la cuenta sí corta el acceso de inmediato.

### Movimientos manuales de caja (CU-18, RF-42)

Ingreso o retiro de efectivo en el turno abierto propio, con motivo y monto positivo. Entra en el
efectivo esperado del arqueo (RN-33). Es idempotente como un cobro: la clave se guarda en
`MovimientoCaja.claveIdempotencia`, y la misma clave usada por otro usuario responde 409.

### Anulación y códigos de autorización (CU-21, RN-46)

- Quien tiene `tickets.void` anula directamente. Un Cajero entra con `pos.access` (operación
  `ANULAR_TICKET_CON_CODIGO`) y debe enviar un código generado por un Administrador; Limpieza no puede
  entrar ni con código.
- El compensatorio se emite en el **turno abierto de quien anula**: la devolución sale de ese cajón.
  Un Administrador que anula también necesita su turno abierto.
- Efectos: anular un ingreso deja el alquiler `ANULADO` y la habitación `LIBRE` (exige anular antes las
  horas vigentes); anular una hora adicional recalcula la salida; anular una venta restituye el stock.
  El ingreso de un alquiler ya **cerrado** no se puede anular (`RENTAL_NOT_OPEN`): el cierre es
  definitivo (§20.2).
- El código tiene 6 dígitos de una fuente criptográfica y vence a los minutos configurados. Se guarda
  **solo su HMAC-SHA256** (`codigoHash`), con un secreto derivado de `JWT_SECRET`; el código en claro
  se muestra una única vez, al generarlo, y nunca se audita. En desarrollo, sin `JWT_SECRET` fijo, los
  códigos dejan de servir al reiniciar.
- Contra la fuerza bruta: tras **5 códigos incorrectos en 15 minutos**, el usuario queda bloqueado
  para anular con código hasta que pase la ventana. Cada intento fallido queda auditado.

### Reportes (§25)

El periodo es `[desde, hasta)` en UTC. La agregación es de `@apurimeno/domain` (`resumirVentas`,
`resumirArqueos`, `resumirOcupacion`); los días se cuentan en hora de Lima.
- **Ventas:** tickets emitidos en el periodo que siguen vigentes (cobros no anulados), por origen,
  método de pago, día, turno y producto.
- **Arqueos:** turnos cerrados en el periodo, con la suma de diferencias.
- **Ocupación:** alquileres ingresados en el periodo que no fueron anulados; horas vendidas e ingresos
  por habitación.

### Impresión (ADR-05)

**Parte 1, hecha y probada sin impresora:** `src/impresion/escpos.ts` convierte las líneas del comprobante
(`componerLineasComprobante` del dominio, a 48 o 32 columnas) en los bytes exactos para la impresora:
- `ESC @` (reinicio), `ESC t n` (página de códigos), negrita (`ESC E`) para el negocio y el total, y
  negrita a doble alto (`GS ! 0x01`, no cambia el ancho) para "COPIA" y "ANULADO"; al final `ESC d 4` y
  corte parcial `GS V 1`.
- **Tildes y "ñ":** página PC850 (`ESC t 2`) por defecto, que incluye las mayúsculas con tilde; WPC1252
  (`ESC t 16`) como alternativa. Los signos tipográficos se pasan a ASCII ("—" → "-"), otras letras con
  acento pierden el acento, lo demás sale como "?". **Los caracteres de control se descartan**: un nombre
  de producto no puede colar comandos a la impresora.
- Pruebas byte a byte (`test/impresion`): los bytes esperados (`*.hex`) los genera
  `generar_esperados.py` con los códecs cp850/cp1252 de Python, una implementación independiente. Si
  cambia el diseño del comprobante: `pnpm exec tsx test/impresion/volcar-casos.ts && python3
  test/impresion/generar_esperados.py`, y revisar el diff de los `.hex`.

**Por confirmar con la impresora real:** qué página de códigos imprime bien las tildes (`pnpm
prueba-impresora prueba.bin` genera una página con la misma línea en PC850 y WPC1252, el tamaño doble y
una regla de 48 columnas), que `GS V 1` corte, y cuántas líneas de avance hacen falta antes del corte.

**Contenido configurable (CU-27):** nombre del negocio, dato adicional (dirección o mensaje) y la leyenda
al pie (decisión 21 de contracts). La migración `leyenda_comprobante_configurable` completa las bases
existentes con la leyenda que antes estaba fija, y quita la frase repetida que dejaba la semilla anterior
como dato adicional.

**Conectado a los cobros:** el ingreso, la hora adicional y la venta crean su `TrabajoImpresion` original
en la misma transacción que el cobro, así ningún cobro queda sin comprobante; la reimpresión crea la copia.
Después de responder, `impresion/cola.ts` compone el comprobante, lo convierte con `escpos.ts` y lo pasa al
transporte, un envío a la vez. Si la impresora falla, el trabajo queda en `ERROR` y el cobro sigue firme
(RF-56); sin `IMPRESORA_DISPOSITIVO`, queda `PENDIENTE`. Los tickets compensatorios de una anulación no
se imprimen: CU-21 no lo pide.

**Parte 2, pendiente (con el hardware):** hoy el único transporte escribe los bytes en una ruta
(`transporteArchivo`, pensado para `/dev/usb/lp0`) y no se ha probado con la impresora. Falta probarlo con
la RED-E803, Bluetooth, la impresora en Windows y reintentar los trabajos en `ERROR` o `PENDIENTE`.

### Respuestas de error

Siempre `{ codigo, mensaje }` (`RespuestaError` en contracts):

| HTTP | `codigo` |
|---|---|
| 422 | Regla de negocio: `CodigoErrorNegocio` (`ROOM_NOT_AVAILABLE`, `OVERTIME_UNRESOLVED`, `SHIFT_NOT_OPEN`, …) |
| 400 | `VALIDACION`: el cuerpo no cumple el contrato |
| 401 | `NO_AUTENTICADO` |
| 403 | `PERMISO_DENEGADO` (queda auditado) |
| 404 | `NO_ENCONTRADO` |
| 409 | `CLAVE_IDEMPOTENCIA_REUTILIZADA` |
| 500 | `ERROR_INTERNO`: un defecto; se registra en el log |

## Lo que el dominio delegó al backend

1. **Un alquiler abierto por habitación (RN-27, T-15).** La base lo garantiza con un índice único
   parcial: `UNIQUE(habitacionId) WHERE estado = 'ABIERTO'`. Está declarado en el esquema con el preview
   `partialIndexes` de Prisma 7, así que la migración lo genera y Prisma lo conoce. Si dos cajeros
   ingresan a la vez, uno recibe `ROOM_NOT_AVAILABLE`. Lo mismo aplica a un turno abierto por usuario.
2. **Idempotencia de cobros (RF-59).** Cada cobro exige la cabecera `idempotency-key`, que se guarda en
   `Ticket.claveIdempotencia` (única). Un reintento con la misma clave devuelve el resultado original
   (HTTP 200, cabecera `idempotent-replayed: true`) sin cobrar de nuevo, aunque las dos solicitudes
   lleguen a la vez. Reutilizar una clave en otra operación responde 409.
3. **Permisos antes de cada ruta.** Un hook `onRequest` verifica el JWT, carga el usuario y sus rangos
   de la base (un cambio de rango rige en la siguiente solicitud, RF-63) y comprueba
   `puede(permisos, operacion)` de `@apurimeno/domain`. Toda ruta declara `config.operacion` o
   `config.publica`; si falta, el servidor no arranca. Los permisos condicionales (el ajuste puntual)
   se comprueban dentro de la ruta con `exigir()`.
4. **Huésped o público.** `RegistrarVentaEntrada.esHuesped` llega explícito desde el cajero en
   `POST /ventas`; el servidor no lo infiere de los alquileres (RES-02).

Además:
- **Auditoría (RN-42):** cada operación escribe su `RegistroAuditoria` en la misma transacción.
- **Autenticación (RN-40):** contraseñas con bcrypt (costo 12) y JWT de 12 horas. Un usuario
  desactivado pierde el acceso aunque su token no haya vencido. El login responde igual para un usuario
  inexistente que para una contraseña incorrecta.

## Esquema de base de datos

`prisma/schema.prisma` replica los tipos de `@apurimeno/contracts`: mismos nombres de modelo, de campo
y de enum. Las diferencias inevitables están documentadas al inicio del esquema:
- Las fechas son `DateTime` en la base y texto ISO en el contrato.
- Los objetos anidados son columnas `Json`, y las listas son tablas relacionadas.
- `Permiso` se guarda como texto, porque sus valores llevan punto.
- Algunas columnas existen solo en la base: `contrasenaHash`, `claveIdempotencia` y `posicion`.

`src/mapeo.ts` convierte en ambos sentidos y valida cada salida con su esquema de contracts.

## Pruebas

```bash
pnpm test
```

Son pruebas de integración contra SQLite real: cada suite usa un archivo temporal, le aplica las
migraciones del repo y la semilla, y ejercita la app por HTTP. El reloj del servidor se controla para
simular el paso del tiempo.
- `flujo-ingreso`: el flujo de punta a punta (turno, ingreso, hora adicional en sobretiempo, salida y
  arqueo) y los rechazos sin rastro.
- `concurrencia`: T-15 con solicitudes simultáneas, idempotencia (incluido el doble clic simultáneo),
  los índices parciales probados directamente contra la base, y el modo WAL.
- `autorizacion`: login, bcrypt, 401 y 403 con auditoría, cambio de rango en caliente, y rutas sin
  operación declarada.
- `tienda`: el servicio de venta con `esHuesped` explícito.
- `tienda-y-reportes`: catálogo, reposición, venta por HTTP y los tres reportes.
- `anulacion`: anulación de ingreso, hora adicional y venta; códigos de autorización (un solo uso,
  vencimiento, hash, límite de intentos).
- `limpieza-y-habitaciones`: la lista de limpieza (solo pendientes), marcar lista y reportar
  mantenimiento tal como los envía `apps/cleaning`, la carrera entre dos personas, y la administración
  de habitaciones.
- `rangos`, `cierre-forzado`, `configuracion` (con métodos de pago), `auditoria` y `reimpresion`.
- `cors`: la lista blanca de `CORS_ORIGINS` (sin comodines) y el preflight contra la API.
- `administracion`: clientes, precios especiales aplicados en la cotización, usuarios (desactivación y
  rangos en caliente) y movimientos de caja (arqueo e idempotencia).
