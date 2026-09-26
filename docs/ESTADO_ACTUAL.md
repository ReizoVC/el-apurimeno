# Estado actual del proyecto

Al 26/09/2026. Resume qué está hecho y probado, qué falta para que el sistema reemplace el cuaderno de papel, y qué
decisiones esperan a la propietaria. El detalle técnico de cada parte está en el README de su carpeta.

**En una línea:** el MVP de software está completo salvo la **impresión real** (parte 2, con la impresora). Lo que
falta es sobre todo puesta en marcha: Supabase de producción, instalación en el PC del local, datos reales y el piloto
con el cuaderno.

## Integrado y en curso

Los PR #12 (pantalla del espejo), #13 (`apps/owner`, `aal2`, `@apurimeno/formato`) y #14 (revisión y este documento)
ya están en `main`. En la rama `claude/apps-owner`, sobre `main`: respaldos (local, externo cifrado y restauración) y la
pantalla de productos e inventario.

## Completo y probado

| Parte | Qué hace | Cómo se probó |
|---|---|---|
| `packages/contracts` | Tipos y esquemas de todo el sistema; 24 decisiones de interpretación del SRS documentadas | 43 pruebas |
| `packages/domain` | Reglas de negocio: tiempos y cortesía, precios (lista, especial, ajuste), horas adicionales, caja y arqueo, tienda y stock, anulaciones, permisos, reportes, comprobante, resumen del espejo, horarios y retención de respaldos | 235 pruebas, incluida la tabla de casos del SRS |
| `packages/formato` | Dinero y fechas de Lima, compartidos por todas las pantallas | 8 pruebas |
| `apps/server` | API local: sesiones y permisos, turnos, ingresos, horas adicionales, salidas, tienda, anulación con código de autorización, limpieza, administración, configuración, auditoría, reportes, idempotencia de cobros, cola de impresión (parte 1) y sincronización con el espejo, respaldos y restauración | 180 pruebas contra SQLite real; pruebas de concurrencia |
| `apps/native` (POS) | Tablero por piso con estado en vivo, ingreso, hora adicional, salida, anulación guiada, tienda con lector de código de barras, turno con arqueo ciego | De punta a punta en el navegador contra el servidor real. El ejecutable de Tauri se compiló en Linux; en este PC Windows falta el compilador de C++ (ver "Instalación") |
| `apps/web` (Dashboard) | Vista del día, reportes, habitaciones, clientes y precios especiales, productos e inventario, usuarios y rangos, configuración, métodos de pago, auditoría, turnos abiertos y cierre forzado, códigos de anulación, reimpresión, espejo en la nube, respaldos | De punta a punta como administrador contra el servidor real, con cifras calculadas a mano |
| `apps/cleaning` | Lista de habitaciones por limpiar, marcar lista, reportar mantenimiento | Contra el servidor real |
| Espejo en la nube | El servidor publica cada 30 min ventas, anulados, ocupación por día y arqueos por turno; nunca clientes, tickets ni el estado en vivo | Contra el proyecto `apurimeno-prueba`: primera sincronización, cambios, anulación de días anteriores, sin internet y vuelta, re-sincronización completa |
| `apps/owner` | Resumen remoto para la propietaria: contraseña + TOTP obligatorio, franja "Datos al…", Hoy/Ayer/7 días/Mes, ventas, arqueos y ocupación | De punta a punta en Chrome de celular contra `apurimeno-prueba`, servida con las cabeceras reales de Cloudflare Pages; cifras iguales a lo publicado |
| Respaldos | Copia local consistente cada 15 min (24 h), externa diaria a las 04:00 comprimida y cifrada con clave pública (30 días), `pnpm restaurar` y pantalla con "Desactualizado" | Pruebas contra SQLite real; en Chrome contra el servidor real; restauración de punta a punta con el servidor real y copias reales cada 15 min, en el mismo equipo y en un "PC nuevo" (`docs/RESPALDO_Y_RESTAURACION.md`) |
| `supabase/` | Tablas, row-level security (lectoras solo leen con TOTP; el servidor solo escribe), procedimiento de cuentas | Matriz de permisos en PGlite; la primera migración también aplicada y verificada en `apurimeno-prueba` |

`pnpm check-types`, `pnpm lint` y `pnpm test` pasan en todo el monorepo (466 pruebas). Todas las apps compilan.

## Qué falta para reemplazar el cuaderno

### Software

1. **Impresión parte 2** (el domingo, con la impresora conectada): enviar los bytes a la REDPOS RED-E803 por USB
   (y Bluetooth), en Windows; elegir la página de códigos que imprime bien las tildes (`pnpm prueba-impresora`);
   confirmar el corte y el avance de papel; reintentar trabajos en `ERROR`/`PENDIENTE` (RF-56). La parte 1
   (contenido y bytes ESC/POS, cola conectada a cada cobro) está hecha.

### Puesta en marcha

2. **Verificar en `apurimeno-prueba` que la migración `20260926090000_lector_requiere_aal2.sql` rige**: la
   propietaria ya la aplicó; falta correr la verificación (una lectora sin TOTP verificado no lee nada) con una
   cuenta lectora cuyas credenciales Supabase acepte. Las que se usaron el 26/09 fueron rechazadas
   (`invalid_credentials`).
3. **Proyecto de Supabase de producción**, siguiendo `supabase/README.md`: aplicar las dos migraciones en orden,
   cerrar el registro público, verificar que TOTP esté habilitado, crear la cuenta del servidor (contraseña
   larga) y las de la propietaria y su hija.
4. **Publicar `apps/owner` en Cloudflare Pages** con las credenciales de producción (pasos exactos en
   `apps/owner/README.md`).
5. **Instalación en el PC del local:**
   - Node 22.9 o posterior, el servidor con su `.env` de producción (`JWT_SECRET` propio, base en una carpeta
     fija, `ESPEJO_*` del proyecto de producción, `IMPRESORA_*`).
   - Que el servidor arranque solo al encender el equipo (servicio de Windows o tarea programada): hoy se
     inicia a mano con `pnpm start`.
   - Que el equipo no se suspenda (la sincronización y la impresión corren en el servidor).
   - IP fija en la red del local y `CORS_ORIGINS` con las direcciones del Dashboard y de la app de limpieza.
   - El instalador del POS (Tauri) compilado en un equipo con Visual Studio "Desarrollo para el escritorio con
     C++".
   - Respaldos: la clave pública y la carpeta sincronizada en `apps/server/.env`, y comprobar en el Dashboard que
     salen las dos copias (`docs/RESPALDO_Y_RESTAURACION.md`, "Configuración").
6. **Datos reales:** habitaciones y precios (la semilla trae 17 de ejemplo), métodos de pago, productos (desde el
   Dashboard → Productos), las cuentas del personal con sus rangos, y el nombre, la dirección y la leyenda del
   comprobante.
7. **Piloto en paralelo con el cuaderno** (E4 de los Planos): 1 a 2 semanas usando ambos, con capacitación al
   personal, comparando cada cierre de turno con el cuaderno antes de dejarlo.

## Decisiones que necesitan tu respuesta

| Tema | Cómo está hoy | Qué hace falta decidir |
|---|---|---|
| Transferencia bancaria (P-04) | Creada pero desactivada | ¿Se activa desde el inicio? Se cambia en el Dashboard, sin código |
| Número de operación de Yape/Plin (P-05) | Opcional | ¿Obligatorio? Se cambia en el Dashboard, sin código |
| Vigencia del código de anulación (RF-65) | 5 minutos | ¿Está bien? Configurable en el Dashboard |
| Exportar reportes a hoja de cálculo (PEND-06) | No existe (recomendación del SRS para el MVP) | ¿Hace falta para el piloto o queda para la Fase 2? |
| Pérdida de datos si se pierde el equipo | La copia externa es diaria (04:00): si se pierde el equipo entero, se puede perder hasta un día de operación. El objetivo de 15 minutos (RNF-REC-02) solo se cumple si el disco sigue sano | ¿Se acepta, o las copias de cada 15 min también van cifradas a la carpeta sincronizada (o a un segundo disco)? |
| Arranque del servidor en el PC | A mano | ¿Servicio de Windows o tarea programada? ¿Quién enciende el equipo? |
| Logotipo en el comprobante | Sin logotipo | La RED-E803 lo soporta; ¿se quiere? Se decide con la impresora conectada |
| Piloto | Sin fecha | Fechas, quién lleva el cuaderno en paralelo y quién compara los cierres |

Ya resueltas y registradas (no requieren nada): respaldos (destino, retención, hora, cifrado y aviso; decisión 23), comentario obligatorio con cualquier diferencia de arqueo
(decisión 15), leyenda del comprobante editable (21), `afectaCaja` inmutable (20), nadie se quita su propio
acceso (19), contenido del espejo y lectura con TOTP (22), dos cuentas lectoras (propietaria e hija), Cloudflare
Pages para la vista remota.

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
