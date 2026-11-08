# Guía de actualización remota

Cómo instalar una versión nueva en la mini PC del local desde tu casa, sin ir hasta allá. Esta guía es para el uso normal. Los detalles técnicos y los casos difíciles están en [ACTUALIZACION_REMOTA.md](ACTUALIZACION_REMOTA.md).

**Importante:** todavía no se ha probado por SSH ni con una versión publicada en GitHub. Antes de usarla con el local abierto, hay que hacer el [ensayo de la mini PC](#ensayo-con-la-mini-pc).

## Cómo funciona

1. Publicas la versión en GitHub desde tu PC.
2. Le ordenas a la mini PC que la instale, por una conexión privada (Tailscale y SSH).
3. La mini PC descarga la versión, copia la base de datos y se actualiza sola.

El router no abre ningún puerto. Si se corta tu internet a la mitad, la actualización sigue sola.

## Antes de la primera vez

Se hace una sola vez, con la mini PC delante. Los comandos están en [ACTUALIZACION_REMOTA.md, sección 1](ACTUALIZACION_REMOTA.md#1-preparar-el-pc-del-local-una-sola-vez).

- [ ] Tailscale instalado en la mini PC y en tu PC, con la misma cuenta.
- [ ] La mini PC se llama `apurimeno` en Tailscale y tiene desactivado "Key expiry".
- [ ] Verificación en dos pasos activada en la cuenta de Tailscale.
- [ ] Servidor SSH activo en la mini PC, solo por Tailscale y solo con clave.
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
pnpm publicar-version
```

Termina con `Publicada vX.Y.Z`. El repositorio es público, así que el instalador del POS también lo es.

### 3. Revisa qué haría

Este comando no instala nada; solo descarga y verifica el instalador del POS:

```bash
ssh apurimeno "powershell -NoProfile -ExecutionPolicy Bypass -File C:\ElApurimeno\apps\server\scripts\actualizar-produccion.ps1 -Comprobar"
```

Te dice a qué versión iría y de qué tipo es la actualización:

| Tipo | Cuándo | Sin cobros |
|---|---|---|
| Rápida | Cambios normales de código | Cerca de 1 minuto, al final |
| Completa | Cambian dependencias o la base de datos | Toda la actualización, varios minutos |

### 4. Avisa en el local

Elige un horario tranquilo y pide al cajero que **cierre el POS**. Si está abierto, la actualización se niega a empezar y no toca nada.

### 5. Instala

```bash
ssh apurimeno "powershell -NoProfile -ExecutionPolicy Bypass -File C:\ElApurimeno\apps\server\scripts\actualizar-produccion.ps1"
```

Si no puedes pedir que cierren el POS, agrega `-CerrarPOS` al final, dentro de las comillas. Lo cierra a la fuerza y se pierde lo que el cajero estuviera escribiendo.

### 6. Comprueba

Debe terminar con `Listo: el local quedó en vX.Y.Z`. Si se cortó la conexión, o quieres revisar cómo terminó:

```bash
ssh apurimeno "powershell -NoProfile -ExecutionPolicy Bypass -File C:\ElApurimeno\apps\server\scripts\actualizar-produccion.ps1 -Estado"
```

Después, avisa al cajero que **vuelva a abrir el POS**: no se abre solo.

## Si algo sale mal

| Qué ves | Cómo queda el local | Qué hacer |
|---|---|---|
| Error antes de empezar (POS abierto, descarga, cambios en la mini PC) | Nada cambió | Corrige la causa y repite |
| Falló la compilación, en una rápida | Sigue funcionando con la versión anterior | Corrige en una versión nueva |
| Falló la instalación del POS | Servidor y pantallas actualizados, POS en la versión anterior | Repite la misma orden: solo instala el POS |
| `QUEDAN DETENIDOS` | **Sin servicio, a propósito** | Sigue el [procedimiento de migraciones](ACTUALIZACION_REMOTA.md#si-algo-sale-mal) cuanto antes |
| Fallaron las migraciones de capacitación | El local funciona; solo la práctica queda detenida | Corrige en una versión nueva |

**No se puede volver a una versión anterior.** Si una versión salió mal, publica otra con el cambio revertido.

Si no llegas a la mini PC por SSH, revisa primero que esté encendida y con internet, y que Tailscale esté activo en tu PC.

## Ensayo con la mini PC

Antes de usarla con el local abierto, comprueba desde tu PC, con otra red (por ejemplo, los datos del celular):

- [ ] `ssh apurimeno hostname` responde.
- [ ] `-Comprobar` termina sin error.
- [ ] Una actualización rápida y una completa terminan bien.
- [ ] Al cortar la conexión a la mitad, la actualización sigue y `-Estado` lo muestra.
- [ ] Una versión publicada de verdad en GitHub se descarga e instala el POS.
- [ ] Con el POS abierto se niega a empezar, y con `-CerrarPOS` lo cierra.

## Cuida estos accesos

- La **clave SSH** de tu PC y tu **cuenta de Tailscale** dan control de administrador sobre la mini PC. Protege la clave con una frase de paso y no la copies a otros equipos.
- El instalador del POS no está firmado. Su SHA-256 detecta una descarga dañada, no un ataque.
