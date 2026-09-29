# Estado actual del proyecto

Al 27/09/2026. Resume qué está hecho y probado, qué falta para que el sistema reemplace el cuaderno de papel, y qué
decisiones esperan a la propietaria. El detalle técnico de cada parte está en el README de su carpeta.

**En una línea:** el MVP de software está completo salvo la **impresión real** (parte 2, con la impresora). Los tres
servicios de Windows y el respaldo externo quedaron probados en el equipo de desarrollo. Para instalar en el local
solo falta: **impresión parte 2**, el **proyecto de Supabase de producción** y la **instalación con `-Produccion` en el
equipo del local**. Después vienen los datos reales y el piloto con el cuaderno.

## Integrado

Todo está en `main`, hasta el PR #21 inclusive: pantalla del espejo (#12), `apps/owner` con `aal2` y
`@apurimeno/formato` (#13), revisión y este documento (#14), respaldos (local, externo cifrado y restauración) con la
pantalla de productos e inventario (#15), correcciones de la auditoría (#16), el servidor como servicio de Windows
(#17), su registro que rota por tamaño (#18), el Dashboard y Limpieza como servicios, la carpeta de respaldo
sincronizada por Drive y el rechazo de copias a medio escribir al restaurar (#19), la actualización de este documento
(#20) y la decisión sobre el espacio en Google Drive (#21). No quedan ramas con trabajo sin integrar.

## Completo y probado

| Parte | Qué hace | Cómo se probó |
|---|---|---|
| `packages/contracts` | Tipos y esquemas de todo el sistema; 25 decisiones de interpretación del SRS documentadas | 45 pruebas |
| `packages/domain` | Reglas de negocio: tiempos y cortesía, precios (lista, especial, ajuste), horas adicionales, caja y arqueo, tienda y stock, anulaciones, permisos, reportes, comprobante, resumen del espejo, horarios y retención de respaldos, intentos de cierre de turno | 243 pruebas, incluida la tabla de casos del SRS |
| `packages/formato` | Dinero y fechas de Lima, compartidos por todas las pantallas | 8 pruebas |
| `apps/server` | API local: sesiones y permisos, turnos, ingresos, horas adicionales, salidas, tienda, anulación con código de autorización, limpieza, administración, configuración, auditoría, reportes, idempotencia de cobros, cola de impresión (parte 1) y sincronización con el espejo, respaldos (con la ventana de 2 horas) y restauración, intentos de cierre de turno, reglas de `.gitignore`, registro que rota por tamaño | 244 pruebas contra SQLite real; pruebas de concurrencia |
| `apps/native` (POS) | Tablero por piso con estado en vivo, ingreso, hora adicional, salida, anulación guiada, tienda con lector de código de barras, turno con arqueo ciego (con código de autorización tras 3 intentos con diferencia) | De punta a punta en el navegador contra el servidor real. El ejecutable de Tauri y sus instaladores (MSI y NSIS) compilan en este PC Windows con `pnpm --filter native tauri build`; falta abrir la ventana a mano para confirmarla (la sesión de Claude Code no puede abrir ventanas de escritorio) |
| `apps/web` (Dashboard) | Vista del día, reportes, habitaciones, clientes y precios especiales, productos e inventario, usuarios y rangos, configuración, métodos de pago, auditoría, turnos abiertos y cierre forzado, códigos de anulación, reimpresión, espejo en la nube, respaldos | De punta a punta como administrador contra el servidor real, con cifras calculadas a mano |
| `apps/cleaning` | Lista de habitaciones por limpiar, marcar lista, reportar mantenimiento | Contra el servidor real |
| Espejo en la nube | El servidor publica cada 30 min ventas, anulados, ocupación por día y arqueos por turno; nunca clientes, tickets ni el estado en vivo | Contra el proyecto `apurimeno-prueba`: primera sincronización, cambios, anulación de días anteriores, sin internet y vuelta, re-sincronización completa |
| `apps/owner` | Resumen remoto para la propietaria: contraseña + TOTP obligatorio, franja "Datos al…", Hoy/Ayer/7 días/Mes, ventas, arqueos y ocupación | De punta a punta en Chrome de celular contra `apurimeno-prueba`, servida con las cabeceras reales de Cloudflare Pages; cifras iguales a lo publicado |
| Respaldos | Copia local consistente cada 15 min (24 h), externa diaria a las 04:00 comprimida y cifrada con clave pública (30 días), `pnpm restaurar` y pantalla con "Desactualizado" | Pruebas contra SQLite real; en Chrome contra el servidor real; restauración de punta a punta con el servidor real y copias reales cada 15 min, en el mismo equipo y en un "PC nuevo" (`docs/RESPALDO_Y_RESTAURACION.md`) |
| Servicios de Windows | `ApurimenoServidor` (3001), `ApurimenoDashboard` (3000) y `ApurimenoLimpieza` (3002) con NSSM: arrancan solos al encender el equipo y se relanzan si se caen; un solo instalador con `-Produccion` (`docs/INSTALACION_LOCAL.md`) | En el equipo de desarrollo, 26 y 27/09: `taskkill /F` de cada uno, vuelven solos en 6,5 a 7 s; el registro del servidor rota a 10 MB sin reiniciarlo; tras un reinicio del PC (27/09, 00:10) los tres arrancaron solos y respondieron en 3001, 3000 y 3002 |
| Respaldo externo en Drive | Las copias cifradas (recientes cada 15 min y diaria) van a `C:\RespaldosApurimeno`, carpeta física que Google Drive para escritorio sube desde "Mi computadora" (el servicio no puede escribir en `G:\Mi unidad`) | En el equipo de desarrollo, 26/09: 9 ciclos seguidos sin error, 8 recientes guardadas, Dashboard → Respaldos sin rojo y los archivos visibles en la web de Drive, en "Computadoras" |
| Entorno de capacitación | Segunda instancia del servidor (`ApurimenoCapacitacion`, puerto 3011) con base propia, sin espejo ni copias en Drive; cuentas `capacitacion.admin`, `.cajero1` y `.cajero2`; POS, Dashboard y Limpieza se conectan a ella por el usuario del login y muestran el banner "MODO CAPACITACIÓN"; comprobantes con `*** CAPACITACIÓN ***`; `pnpm reiniciar-capacitacion` (`docs/INSTALACION_LOCAL.md`, sección 9) | En el equipo de desarrollo, 27/09: servicio instalado sin tocar los otros tres; las tres cuentas desde el POS, todo contra 3011; ingreso, salida, limpieza y reimpresión con la marca (salida a archivo); la base de producción quedó igual; reinicio con el servicio funcionando. Falta la impresión física |
| `supabase/` | Tablas, row-level security (lectoras solo leen con TOTP; el servidor solo escribe), procedimiento de cuentas | Matriz de permisos en PGlite; las dos migraciones aplicadas en `apurimeno-prueba` y verificadas el 26/09 con la cuenta lectora: con solo la contraseña, con un autenticador sin verificar, o con TOTP registrado pero sin el código en la sesión, no lee nada (ni por la API directa) ni puede escribir; con el código (aal2) lee el resumen |

**Entorno de capacitación, migraciones:** `pnpm reiniciar-capacitacion` no aplica migraciones (el servicio tiene la
base abierta y `prisma migrate deploy` la necesita en exclusiva). Si el esquema cambió, antes de reiniciar hay que
detener el servicio `ApurimenoCapacitacion` (como administrador), correr `pnpm preparar-capacitacion` y volver a
iniciarlo. El reinicio detecta las migraciones pendientes y se niega a correr mientras falten.

`pnpm check-types`, `pnpm lint` (ahora también servidor, dominio, contratos y formato) y `pnpm test` pasan en todo el monorepo (540 pruebas). Todas las apps compilan (27/09: web, cleaning y native con el entorno de capacitación).

## Qué falta para reemplazar el cuaderno

### Software

1. **Impresión parte 2** (el domingo, con la impresora conectada): enviar los bytes a la REDPOS RED-E803 por USB
   (y Bluetooth), en Windows; elegir la página de códigos que imprime bien las tildes (`pnpm prueba-impresora`);
   confirmar el corte y el avance de papel; reintentar trabajos en `ERROR`/`PENDIENTE` (RF-56). La parte 1
   (contenido y bytes ESC/POS, cola conectada a cada cobro) está hecha.

### Puesta en marcha

2. **Proyecto de Supabase de producción**, siguiendo `supabase/README.md`: aplicar las dos migraciones en orden,
   cerrar el registro público, verificar que TOTP esté habilitado, crear la cuenta del servidor (contraseña
   larga) y las de la propietaria y su hija.
3. **Publicar `apps/owner` en Cloudflare Pages** con las credenciales de producción (pasos exactos en
   `apps/owner/README.md`).
4. **Instalación con `-Produccion` en el equipo del local**, siguiendo `docs/INSTALACION_LOCAL.md` (los servicios y
   el respaldo externo ya se probaron en el equipo de desarrollo; falta repetirlo allí):
   - Node 22.9 o posterior, el servidor con su `.env` de producción (`JWT_SECRET` propio, base en una carpeta
     fija, `ESPEJO_*` del proyecto de producción, `IMPRESORA_*`).
   - Compilar el Dashboard y Limpieza y correr `apps/server/scripts/instalar-servicio.ps1 -Produccion`: deja los
     tres servicios. Comprobar `taskkill /F` y un reinicio del equipo, como en el de desarrollo.
   - La carpeta de respaldo física agregada en Drive → "Mi computadora", no `G:\Mi unidad`.
   - Que el equipo no se suspenda (la sincronización y la impresión corren en el servidor).
   - IP fija en la red del local y `CORS_ORIGINS` con las direcciones del Dashboard y de la app de limpieza.
   - El instalador del POS (Tauri) compilado en un equipo con Visual Studio "Desarrollo para el escritorio con
     C++".
   - Respaldos: la clave pública y la carpeta sincronizada en `apps/server/.env`, y comprobar en el Dashboard que
     salen las dos copias (`docs/RESPALDO_Y_RESTAURACION.md`, "Configuración").
5. **Datos reales:** habitaciones y precios (la semilla trae 17 de ejemplo), métodos de pago, productos (desde el
   Dashboard → Productos), las cuentas del personal con sus rangos, y el nombre, la dirección y la leyenda del
   comprobante.
6. **Piloto en paralelo con el cuaderno** (E4 de los Planos): 1 a 2 semanas usando ambos, con capacitación al
   personal, comparando cada cierre de turno con el cuaderno antes de dejarlo.

## Decisiones que necesitan tu respuesta

| Tema | Cómo está hoy | Qué hace falta decidir |
|---|---|---|
| Transferencia bancaria (P-04) | Creada pero desactivada | ¿Se activa desde el inicio? Se cambia en el Dashboard, sin código |
| Vigencia del código de anulación (RF-65) | 5 minutos | ¿Está bien? Configurable en el Dashboard |
| Exportar reportes a hoja de cálculo (PEND-06) | No existe (recomendación del SRS para el MVP) | ¿Hace falta para el piloto o queda para la Fase 2? |
| Encendido del equipo | El servidor, el Dashboard y Limpieza arrancan solos como servicios de Windows (NSSM) | ¿Quién enciende el equipo cada día, o queda siempre encendido? |
| Logotipo en el comprobante | Sin logotipo | La RED-E803 lo soporta; ¿se quiere? Se decide con la impresora conectada |
| Piloto | Sin fecha | Fechas, quién lleva el cuaderno en paralelo y quién compara los cierres |

Ya resueltas y registradas (no requieren nada): número de operación obligatorio para Yape y Plin (P-05; en la
semilla, y se cambia en el Dashboard), respaldos (destino, retención, hora, cifrado, aviso y la ventana de 2
horas en la nube; decisión 23), comentario obligatorio con cualquier diferencia de arqueo
(decisión 15), leyenda del comprobante editable (21), `afectaCaja` inmutable (20), nadie se quita su propio
acceso (19), contenido del espejo y lectura con TOTP (22), dos cuentas lectoras (propietaria e hija), Cloudflare
Pages para la vista remota.

## Fuera del MVP por decisión de la propietaria

### Espacio en Google Drive: la papelera acumula las copias recientes borradas

Cada 15 minutos el servidor deja una copia reciente cifrada en la carpeta sincronizada y borra la más vieja (se
guardan 8). Drive manda cada archivo borrado a su papelera, donde sigue ocupando espacio de la cuenta durante 30 días:
unas 96 copias por día, casi 2.900 en la papelera a la vez.

**Análisis del 27/09/2026.**

**Cómo se midió:** simulación de 30 días de operación contra la API real, con las copias cifradas tal como las hace el
servidor. La base no se depura, así que la copia crece en línea recta:

| Volumen supuesto por día | La copia crece | Copia a 6 / 12 meses | Papelera + copias a 6 / 12 meses | Se llenan los 15 GB gratuitos |
| --- | --- | --- | --- | --- |
| Bajo: 20 alquileres, 15 ventas | 26 KB/día | 4,8 / 9,6 MB | 12,9 / 27 GB | a los ~7 meses |
| Medio: 40 alquileres, 30 ventas | 50 KB/día | 9,0 / 18,1 MB | 24 / 51 GB | a los ~4 meses |
| Alto: 80 alquileres, 60 ventas | 96 KB/día | 17,6 / 35,2 MB | 47 / 99 GB | a los ~2,3 meses |

**Lo que hace grave que se llene:**

- **Correo:** los 15 GB se comparten con Gmail y Google Fotos de la misma cuenta, y con la cuenta llena Gmail deja de
  recibir correos.
- **Aviso en verde:** si Drive deja de subir, el servidor sigue escribiendo bien en la carpeta local y el Dashboard
  no lo nota.

**Opciones propuestas.** La "pérdida máxima" es la de perder el equipo; si solo se daña la base, las copias locales
siguen cada 15 minutos en todas:

1. **Recientes en la nube cada 1 h o cada 2 h (las locales siguen cada 15 min):** la papelera baja 4 u 8 veces
   (volumen medio a 12 meses: 13,7 o 7,4 GB). La pérdida máxima sube a ~1 h o ~2 h.
2. **Diaria completa más, cada 15 min, solo los cambios desde la diaria:** la papelera queda por debajo de 0,2 GB y
   la pérdida máxima sigue en ~15 min. Es el trabajo más grande: cambia el formato de las copias y la restauración.
3. **Aviso en el Dashboard cuando baje el espacio de Drive:** exige conectar el servidor a la cuenta de Google con
   un permiso guardado en el PC. Solo avisa, no evita que se llene.
4. **Una cuenta de Google solo para respaldos, o un plan de pago de Google One:** aísla el correo de la propietaria.
   Sola no evita que se llene.
5. **Vaciar la papelera a mano:** no se recomienda como única medida.

**Decisión:** queda fuera del MVP y se retoma **a los 2 o 3 meses de operación**, con el volumen real del local.
La propuesta elegida para entonces es la **opción 2**: una copia diaria completa más, cada 15 minutos, solo los
cambios desde esa diaria. Mientras tanto:

- **Cuenta de Google solo para los respaldos**, distinta de la personal de la propietaria. Así, si se llena, no
  afecta su correo.
- **Revisión del espacio de esa cuenta una vez al mes**, en drive.google.com → Almacenamiento, incluida la
  papelera.

Pasos en `docs/INSTALACION_LOCAL.md`, sección 5.

## Decisiones tomadas en la última etapa, para revisar

Tomadas sin revisión porque no bloqueaban nada; cada una está explicada en el README correspondiente:

- **`@apurimeno/formato`:** un solo paquete para dinero y fechas de Lima (antes había copias en el Dashboard, el
  POS y el dominio). Las fechas cortas se arman a mano porque el formato de es-PE cambia entre versiones.
- **Lectura con TOTP exigida por la base**, no solo por la app (`aal2` en las políticas), y `espejo_mi_rol()` para
  rechazar la cuenta del servidor en la vista remota.
- **La sesión de la propietaria queda guardada en el celular**; "Salir" la cierra y desactivar la cuenta corta el
  acceso a los datos de inmediato.
- **CSP con hashes** en vez de permitir scripts en línea; `_headers` se genera en cada compilación.
- **Despliegue por `wrangler` desde el PC** en vez de conectar el repositorio a Cloudflare: menos piezas y sin
  depender de cómo Cloudflare compila un monorepo pnpm.
- **Sin fuentes descargadas** en la vista remota.
- **`better-sqlite3` fijado en la 12** para que el servidor instale y corra en Windows con Node 22.
- **Respaldos:** la copia más reciente nunca se borra por retención; si la externa falla, se reintenta cada 15 min;
  "Desactualizado" a los 30 min sin copia local y 1 h después de las 04:00 sin la externa del día (decisión 23).
- **Productos inactivos:** `GET /productos?incluirInactivos=true` (solo `inventory.manage`), para poder reactivarlos
  desde el Dashboard (decisión 24).
- **`apps/store-catalog` sin tocar**: sigue siendo maqueta, como se indicó.

## Observaciones de las pruebas

- Una base de prueba apuntada al espejo **reemplaza** los días reales con los suyos (pasó en las pruebas con
  `apurimeno-prueba`, sin consecuencias). En producción, solo el servidor del local debe tener las credenciales
  del espejo. Advertido en `supabase/README.md` y `CLAUDE.md`.
- Las cuentas de prueba no están en el repositorio. La prueba de la vista remota da de alta un autenticador y lo
  quita al terminar: la cuenta lectora de prueba quedó sin autenticadores.
