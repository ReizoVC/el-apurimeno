# Respaldo y restauración

Cómo se protege la base del local ante una falla, cómo se configura y cómo se restaura. Cumple Planos §14.3,
RNF-BKP-01 (copias periódicas, una fuera del equipo), RNF-BKP-02 (restauración probada y documentada) y RNF-REC-02
(perder como máximo 15 minutos de datos y volver a operar en 60 minutos). Las decisiones (frecuencia, destino,
retención, hora y cifrado) son de la propietaria: decisión 23 de `packages/contracts/README.md`. El detalle técnico
está en `apps/server/README.md`, sección "Respaldos".

## Qué se guarda y dónde

| | Copias locales | Copia externa |
|---|---|---|
| Cuándo | Cada 15 minutos, mientras el servidor está encendido | Una por día a las 04:00 de Lima; si el equipo estaba apagado a esa hora, apenas se enciende |
| Dónde | `apps/server/datos/respaldos/`, en el disco del equipo | La carpeta que se sincroniza con Google Drive u OneDrive (`RESPALDO_CARPETA_EXTERNA`) |
| Se guardan | Las de las últimas 24 horas | Las de los últimos 30 días |
| Formato | Una base SQLite lista para usar (`.db`) | Comprimida y cifrada (`.db.gz.cifrado`); solo se abre con la clave privada |
| Protege de | Una base dañada o borrada, un error grave de operación | La pérdida del equipo o de su disco (robo, incendio, falla de hardware) |

Cada copia es la base **completa**: habitaciones, alquileres, tickets, caja, clientes, usuarios, auditoría y
configuración. El espejo en la nube **no** es un respaldo: solo tiene totales.

> **Cuánto se puede perder.** Si falla la base pero el disco del equipo sigue sano, se restaura la copia local más
> reciente: se pierden como máximo 15 minutos. Si se pierde el equipo entero, sus copias locales se pierden con él
> y queda la copia externa más reciente, que es **de las 04:00 de ese día: se puede perder hasta un día de
> operación**. Ver "Prueba de restauración" al final.

## Configuración (una sola vez, en el equipo del local)

1. **Generar la clave de cifrado.** En `apps/server`: `pnpm clave-respaldo`. Muestra dos claves y no las guarda en
   ningún archivo:
   - la **privada** (`apr-privada-…`): se guarda en el gestor de contraseñas de la propietaria, con un nombre
     claro ("El Apurimeño: clave de respaldo"). **Sin ella no se puede abrir ninguna copia externa.** No va en el
     equipo, ni en la carpeta de las copias, ni en el repositorio;
   - la línea `RESPALDO_CLAVE_PUBLICA="apr-publica-…"`, que va en `apps/server/.env`. La pública solo sirve para
     cifrar: aunque alguien se lleve el equipo, no puede abrir las copias con ella.
2. **Elegir la carpeta sincronizada.** Crear, dentro de Google Drive u OneDrive del equipo, una carpeta solo para
   esto (p. ej. `OneDrive/Respaldos El Apurimeno`) y poner su ruta completa en `apps/server/.env`, con barras
   normales: `RESPALDO_CARPETA_EXTERNA="C:/Users/…/OneDrive/Respaldos El Apurimeno"`. El programa de Drive u
   OneDrive tiene que estar iniciado y con la sesión de la propietaria.
3. **Reiniciar el servidor** y abrir el Dashboard → **Respaldos**. En unos segundos deben aparecer una copia local
   y una externa. Con "Copiar ahora" se puede probar cada una.
4. **Comprobar desde fuera** que el archivo `.db.gz.cifrado` aparece en la web de Google Drive u OneDrive.

## Revisión de rutina

- En el Dashboard → **Respaldos**, cada tanto. Si alguna copia dice **Desactualizado** o muestra un error en rojo,
  hay que atenderlo ese día: la causa aparece en la pantalla (carpeta desconectada, sin espacio…).
- Una vez por semana, que en la web de Drive u OneDrive estén las copias de los últimos días.
- **Antes de actualizar el sistema** (RNF-DEPL-02): Dashboard → Respaldos → "Copiar ahora" en las copias locales.

## Restauración

La hace quien administra el sistema, con el servidor **detenido**. `pnpm restaurar` nunca borra la base actual: la
aparta en una carpeta `reemplazada-…` junto a ella, y verifica la copia completa antes de tocar nada.

### A. La base se dañó o se perdió, el equipo funciona

1. Detener el servidor (cerrar su ventana, o detener el servicio).
2. En `apps/server`: `pnpm restaurar`. Lista las copias disponibles, locales y externas, de la más reciente a la más
   antigua.
3. `pnpm restaurar ultima` (o `pnpm restaurar <ruta del archivo>` para una en particular) y escribir `RESTAURAR`
   para confirmar. Si la copia es la externa, pide la clave privada, que no se muestra al escribirla.
4. Al terminar muestra la hora de la copia, cuántos tickets tiene, el último, y los alquileres y turnos abiertos.
5. Encender el servidor (`pnpm start`).
6. En el Dashboard → Espejo en la nube → **"Re-sincronizar todo"**, para que la propietaria vea lo mismo que el
   local.
7. **Lo registrado después de la hora de la copia no está.** Ver "Después de restaurar".

### B. Se perdió el equipo (robo, incendio, disco dañado)

En el equipo nuevo:

1. Instalar Node 22.9 o posterior, pnpm y Git (ver `README.md` raíz), y Google Drive u OneDrive con la cuenta de
   la propietaria.
2. `git clone` del repositorio y, en la raíz, `pnpm install`.
3. Copiar `apps/server/.env.example` a `apps/server/.env` y completarlo (`JWT_SECRET` nuevo, `ESPEJO_*`,
   `IMPRESORA_*`, y `RESPALDO_CARPETA_EXTERNA` y `RESPALDO_CLAVE_PUBLICA` como en "Configuración"). Si no se tiene
   la pública, sale de la privada: `pnpm clave-respaldo publica`.
4. Esperar a que Drive u OneDrive baje la carpeta de respaldos (o descargar el `.db.gz.cifrado` más reciente desde
   la web).
5. En `apps/server`: `pnpm restaurar ultima` (o `pnpm restaurar <archivo descargado>`), escribir `RESTAURAR` y la
   clave privada.
6. `pnpm start`, y seguir con los pasos 6 y 7 del caso A. Después, instalar el POS y configurar la red como en la
   instalación original.

### Después de restaurar

- Todo lo registrado entre la hora de la copia y la falla **no está en el sistema**: hay que volver a cargarlo a
  partir del cuaderno y de los comprobantes impresos.
- **Los números de ticket se reutilizan:** el sistema sigue numerando desde el último ticket de la copia, así que
  los comprobantes impresos después de la copia tienen números que se volverán a emitir. Conviene anotar el último
  número que quedó en la copia (lo muestra `pnpm restaurar`) al archivar esos comprobantes.
- Los alquileres y turnos que estaban abiertos a la hora de la copia vuelven a estar abiertos.
- La base reemplazada queda en `apps/server/datos/reemplazada-…`: no se borra sola. Puede servir para recuperar
  algo a mano; se borra cuando ya no haga falta.

## Si se pierde la clave privada

Las copias externas hechas con esa clave **ya no se pueden abrir**. Hay que generar un par nuevo
(`pnpm clave-respaldo`), guardar la privada, reemplazar `RESPALDO_CLAVE_PUBLICA` en `apps/server/.env`, reiniciar el
servidor y hacer una copia externa con "Copiar ahora". Las copias locales no están cifradas y no dependen de la
clave.

## Prueba de restauración (RNF-BKP-02)

Hecha el 26/09/2026 en Windows 11, con el servidor real (`pnpm start`), una base de prueba recién sembrada y el
**ritmo real** de copias (cada 15 minutos, sin acelerar el reloj). Durante 38 minutos se registró un ingreso cada 30
segundos por la API (76 cobros, cada uno con su salida y limpieza). Luego se simuló la falla **matando el proceso
del servidor a la fuerza**, sin cierre ordenado, y se restauró en los dos escenarios.

**Copias hechas:** locales a las 08:37:45, 08:52:45 y 09:07:45 (hora de Lima), separadas por **15,00 minutos**
exactos; la externa cifrada, a las 08:37:45 (al encender, porque no había copia del día).

| | A. Base perdida, disco sano | B. Equipo perdido ("PC nuevo") |
|---|---|---|
| Qué se hizo | Se borraron `apurimeno.db`, `-wal` y `-shm`; `pnpm restaurar ultima` | `git clone` en otra carpeta, `pnpm install`, `pnpm restaurar ultima` desde la copia externa cifrada, con la clave privada |
| Copia usada | Local de las 09:07:45 | Externa de las 08:37:45 |
| Falla | 09:15:38 | 09:15:38 |
| **Datos perdidos (RPO)** | **7,9 min** (15 cobros); todo lo anterior a la copia estaba, nada posterior | 37,9 min (75 cobros): en operación real, hasta **24 h** |
| Restaurar | 3,8 s | clonar 1,4 s + instalar 209,5 s + restaurar 3,8 s |
| **Volver a atender (RTO técnico)** | **5,9 s** desde que empieza la restauración | **3 min 37 s** desde el clon |
| Después | El turno abierto seguía abierto y se cobró un ingreso nuevo sin problema | El servidor atendió con los datos de la copia |

Además, con una base de **273 MB** (más de lo que el negocio junta en años): copia local 2,1 s, copia externa
cifrada 4,5 s (queda en 24 MB), restaurar desde la local 1,6 s y desde la externa 1,7 s.

**Qué se puede afirmar:**

- **RPO ≤ 15 min, si el disco del equipo sigue sano (A).** Las copias salen cada 15 minutos exactos, contando desde
  la última también tras un reinicio, así que lo máximo que se pierde es lo registrado en los 15 minutos anteriores a
  la falla. Solo se supera si las copias dejaron de hacerse, y eso el Dashboard lo marca "Desactualizado" a los 30
  minutos.
- **RPO de hasta 24 horas si se pierde el equipo (B).** Con la copia externa diaria, lo que se puede recuperar es la
  copia de las 04:00. Para que el objetivo de 15 minutos valga también ante la pérdida del equipo, las copias de
  cada 15 minutos tendrían que salir del equipo. Es una decisión pendiente de la propietaria (`docs/ESTADO_ACTUAL.md`).
- **RTO ≤ 60 min.** La parte automática tarda segundos (A) o menos de 4 minutos (B). El resto es trabajo manual que
  esta prueba no cronometró: en A, darse cuenta, detener el servidor y correr el comando (minutos). En B, instalar
  Node, pnpm, Git y Drive u OneDrive en un equipo nuevo, esperar la descarga de la copia y volver a configurar la red
  y el POS. Eso es lo que hay que ensayar una vez con el equipo real antes de producción, para confirmar que entra en
  la hora.
