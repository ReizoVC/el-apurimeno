# Guía de actualización remota

Cómo instalar una versión nueva en la mini PC del local sin ir hasta allá. Esta guía es para el uso normal. Los detalles técnicos y los casos difíciles están en [ACTUALIZACION_REMOTA.md](ACTUALIZACION_REMOTA.md).

**Importante:** todavía no se ha probado con una versión publicada en GitHub, ni el botón ni SSH en la mini PC. Antes de usarla con el local abierto, hay que hacer el [ensayo de la mini PC](#ensayo-con-la-mini-pc).

## Cómo funciona

1. Publicas la versión en GitHub desde tu PC, firmada con tu clave de versiones.
2. El servidor del local la ve (revisa cada 6 horas) y el Dashboard la anuncia con el botón "Actualizar".
3. Alguien con el permiso "Ver e instalar las versiones nuevas del sistema" pulsa el botón. O tú la ordenas por SSH.
4. La mini PC comprueba la firma, descarga la versión, copia la base de datos y se actualiza sola.

Lo que no tenga tu firma no se anuncia ni se instala, aunque alguien entre a la cuenta de GitHub. El router no abre ningún puerto. Si se corta la conexión a la mitad, la actualización sigue sola.

## Antes de la primera vez

Se hace una sola vez, con la mini PC delante. Los comandos están en [ACTUALIZACION_REMOTA.md, sección 1](ACTUALIZACION_REMOTA.md#1-preparar-el-pc-del-local-una-sola-vez).

- [ ] Tailscale instalado en la mini PC y en tu PC, con la misma cuenta.
- [ ] La mini PC se llama `apurimeno` en Tailscale y tiene desactivado "Key expiry".
- [ ] Verificación en dos pasos activada en la cuenta de Tailscale.
- [ ] Servidor SSH activo en la mini PC, solo por Tailscale y solo con clave.
- [ ] La clave de versiones: la privada en tu gestor de contraseñas y en un archivo fuera del repositorio; la pública en `apps/server/.env` de la mini PC.
- [ ] La tarea del botón registrada en la mini PC (`actualizar-produccion.ps1 -RegistrarTarea`).
- [ ] Desde tu PC, este comando responde con el nombre de la mini PC:

```bash
ssh apurimeno hostname
```

## Instalar una actualización

### 1. Sube el número de versión

En el PR del cambio, sube `version` en `apps/native/src-tauri/tauri.conf.json`, por ejemplo de `0.2.0` a `0.3.0`. Después integra el PR.

### 2. Publica la versión

En un worktree o clon en el último commit de `main`, en tu PC (necesita Visual Studio y Rust):

```bash
pnpm publicar-version --notas "Qué cambia, en palabras del personal"
```

La nota es lo que lee el personal en el aviso, hasta 500 caracteres. Termina con `Publicada vX.Y.Z`. El repositorio es público, así que el instalador del POS también lo es.

### 3. Instálala desde el Dashboard (lo habitual)

Elige un horario tranquilo. En el Dashboard del local aparece arriba "Hay una versión nueva del sistema", con la nota. Si no quieres esperar la revisión de cada 6 horas, reinicia `ApurimenoServidor`: revisa a los 30 segundos de arrancar.

1. Pulsa **Actualizar**. El aviso dice cuánto tiempo no se podrá cobrar.
2. Pulsa **Actualizar ahora**. Queda en la auditoría.
3. La página muestra "Actualizando el sistema…". El POS se cierra solo y el sistema deja de responder un rato: es normal. No cierres la página.
4. Al terminar, dice "El sistema se actualizó". Pide al cajero que **vuelva a abrir el POS**: no se abre solo.

Si algo falla, el aviso se pone rojo con el motivo y el botón vuelve a aparecer para reintentar. Si tarda más de 20 minutos, la página lo avisa: revisa por SSH con `-Estado` (abajo).

### 3, por SSH (si el botón no sirve)

Primero, sin cambiar nada (comprueba la firma, y descarga y verifica el instalador del POS):

```bash
ssh apurimeno "powershell -NoProfile -ExecutionPolicy Bypass -File C:\ElApurimeno\apps\server\scripts\actualizar-produccion.ps1 -Comprobar"
```

Te dice a qué versión iría y de qué tipo es la actualización:

| Tipo | Cuándo | Sin cobros |
|---|---|---|
| Rápida | Cambios normales de código | Cerca de 1 minuto, al final |
| Completa | Cambian dependencias o la base de datos | Toda la actualización, varios minutos |

Pide al cajero que **cierre el POS**: si está abierto, la actualización se niega a empezar y no toca nada. Después:

```bash
ssh apurimeno "powershell -NoProfile -ExecutionPolicy Bypass -File C:\ElApurimeno\apps\server\scripts\actualizar-produccion.ps1"
```

Si no puedes pedir que cierren el POS, agrega `-CerrarPOS` al final, dentro de las comillas. Lo cierra a la fuerza y se pierde lo que el cajero estuviera escribiendo.

Debe terminar con `Listo: el local quedó en vX.Y.Z`. Avisa al cajero que vuelva a abrir el POS.

### 4. Comprueba

Si se cortó la conexión, o quieres revisar cómo terminó una actualización (también una lanzada con el botón):

```bash
ssh apurimeno "powershell -NoProfile -ExecutionPolicy Bypass -File C:\ElApurimeno\apps\server\scripts\actualizar-produccion.ps1 -Estado"
```

Los Dashboards y la app de Limpieza que estaban abiertos piden "Recargar": hay que pulsarlo para usar la versión nueva.

## Si algo sale mal

| Qué ves | Cómo queda el local | Qué hacer |
|---|---|---|
| Alerta roja de firma en el Dashboard, o "no pasó la verificación de firma" | Nada cambió | Si no publicaste esa versión, revisa el acceso a la cuenta de GitHub |
| "No se pudo lanzar la actualización" | Nada cambió | Registra la tarea con `-RegistrarTarea` en la mini PC, o actualiza por SSH |
| Error antes de empezar (descarga, sin internet, cambios en la mini PC) | Nada cambió | Corrige la causa y repite |
| Falló la compilación, en una rápida | Sigue funcionando con la versión anterior | Corrige en una versión nueva |
| Falló la instalación del POS | Servidor y pantallas actualizados, POS en la versión anterior | Repite: solo instala el POS |
| `QUEDAN DETENIDOS` | **Sin servicio, a propósito** | Sigue el [procedimiento de migraciones](ACTUALIZACION_REMOTA.md#si-algo-sale-mal) cuanto antes |
| Fallaron las migraciones de capacitación | El local funciona; solo la práctica queda detenida | Corrige en una versión nueva |

**No se puede volver a una versión anterior.** Si una versión salió mal, publica otra con el cambio revertido.

Si no llegas a la mini PC por SSH, revisa primero que esté encendida y con internet, y que Tailscale esté activo en tu PC.

## Ensayo con la mini PC

Antes de usarla con el local abierto, con una versión publicada de verdad en GitHub:

- [ ] Desde otra red (por ejemplo, los datos del celular), `ssh apurimeno hostname` responde.
- [ ] El Dashboard del local anuncia la versión, y `-Comprobar` termina sin error.
- [ ] El botón "Actualizar" instala una rápida y una completa, con el POS abierto, y al final pide volver a abrirlo.
- [ ] Por SSH, al cortar la conexión a la mitad, la actualización sigue y `-Estado` lo muestra.
- [ ] Por SSH, con el POS abierto se niega a empezar, y con `-CerrarPOS` lo cierra.

## Cuida estos accesos

- La **clave SSH** de tu PC y tu **cuenta de Tailscale** dan control de administrador sobre la mini PC. Protege la clave con una frase de paso y no la copies a otros equipos.
- La **clave privada de versiones** decide qué se puede instalar. Va solo en tu gestor de contraseñas y en un archivo fuera del repositorio, nunca en la mini PC.
- El **permiso para instalar** solo deja instalar la última versión firmada, en el momento que se elija. Dalo solo a quien pueda decidir cuándo el local deja de cobrar unos minutos.
