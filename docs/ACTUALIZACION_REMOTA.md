# Actualización remota del PC del local

Cómo mandar una versión nueva al PC del local sin ir hasta allá: servidor, Dashboard, Limpieza y POS.

**Cómo funciona:** se publica una versión desde el equipo de desarrollo (etiqueta `vX.Y.Z` en GitHub, con el instalador del POS), y se ordena instalarla por SSH a través de una red privada (Tailscale). El router no abre ningún puerto.

```text
Equipo de desarrollo                         PC del local
pnpm publicar-version  --> GitHub <--------  git fetch, descarga del POS
ssh apurimeno ... ---- red privada Tailscale --> actualizar-produccion.ps1 --> tarea programada
```

## 1. Preparar el PC del local (una sola vez)

Se hace con el PC delante, como parte de la instalación (`docs/INSTALACION_LOCAL.md`). Los comandos, en PowerShell como administrador.

1. **Tailscale.** Instalarlo desde [tailscale.com/download](https://tailscale.com/download) en el PC del local y en el equipo de desarrollo, con la misma cuenta, y en el panel de Tailscale:
   - desactivar "Key expiry" para el PC del local, para que no se desconecte solo a los meses;
   - cambiarle el nombre a `apurimeno`;
   - revisar que el plan elegido cubra el uso en un negocio;
   - activar la verificación en dos pasos de la cuenta: quien entra a esa cuenta llega a la red del PC.

2. **OpenSSH, solo por Tailscale.**

   ```powershell
   Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
   Set-Service sshd -StartupType Automatic
   Start-Service sshd
   # Al instalarse, OpenSSH crea una regla que abre el puerto 22 en todas las redes. Se reemplaza por una solo para Tailscale.
   Disable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP'
   New-NetFirewallRule -Name 'ApurimenoSshTailscale' -DisplayName 'El Apurimeño - SSH por Tailscale' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22 -RemoteAddress 100.64.0.0/10
   ```

3. **Entrar solo con clave, sin contraseña.** En el equipo de desarrollo, si no hay una clave: `ssh-keygen -t ed25519`. La parte **pública** (`.pub`) se copia en el PC del local. Para una cuenta administradora, Windows la lee de este archivo, no de la carpeta del usuario:

   ```powershell
   Add-Content C:\ProgramData\ssh\administrators_authorized_keys '<contenido del .pub>'
   icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F'
   ```

   En `C:\ProgramData\ssh\sshd_config`, dejar `PasswordAuthentication no` (sin `#`) y reiniciar: `Restart-Service sshd`.

   La clave privada da control de administrador sobre el PC: protegerla con una frase de paso y no copiarla a ningún otro lado.

4. **Comprobar desde el equipo de desarrollo.** Agregar a `~/.ssh/config`:

   ```text
   Host apurimeno
     HostName apurimeno
     User <usuario administrador del PC del local>
     ServerAliveInterval 30
   ```

   Probar: `ssh apurimeno hostname`. Y con otra red, por ejemplo los datos del celular.

5. **Que el equipo no se suspenda** ya está en la instalación: si se suspende, Tailscale tampoco llega.

6. **Aviso de versiones nuevas.** En el equipo de desarrollo, una sola vez, con un archivo **fuera del repositorio**:

   ```bash
   pnpm clave-actualizacion --privada-en <archivo>
   ```

   Guardar una copia de la clave privada en el gestor de contraseñas y dejar `ACTUALIZACION_CLAVE_PRIVADA_ARCHIVO` con la ruta de ese archivo en las variables de entorno de tu usuario. La línea `ACTUALIZACION_CLAVE_PUBLICA` que muestra el comando va en `apps/server/.env` del PC del local, y hay que reiniciar `ApurimenoServidor`. Sin ella, el Dashboard no anuncia nada.

   Si se pierde la clave privada: generar otra y cambiar la pública en el PC del local, por SSH o estando allá.

## 2. Publicar una versión

1. En el PR de la versión, subir `version` en `apps/native/src-tauri/tauri.conf.json`. Es el número de la versión; Windows solo reemplaza el POS si es mayor.
2. Integrado el PR, en un worktree o clon en el último commit de `origin/main` (con Visual Studio y Rust):

   ```bash
   pnpm publicar-version --notas "Qué cambia, en palabras del personal"
   ```

   Compila el MSI, firma su manifiesto y crea la etiqueta y la publicación de GitHub con el instalador, su SHA-256 y el manifiesto firmado. La nota es lo que lee el personal en el aviso; el máximo es 500 caracteres. El repositorio es público: el instalador también. No debe llevar secretos (no los lleva: el POS solo trae la dirección de su servidor).

**El aviso.** El servidor del local revisa GitHub al arrancar y cada 6 horas. Quien tenga el permiso `system.update` ve en el Dashboard la versión, la nota y si la actualización es rápida o completa. Lo que no tenga una firma válida no se ofrece y muestra una alerta roja. Por ahora solo avisa: **la instalación sigue siendo por SSH, y el actualizador todavía no comprueba la firma.**

Si la publicación se corta y hay que repetirla, y dice que hay cambios sin commit: Tauri reescribe `apps/native/src-tauri/Cargo.toml` con otros finales de línea al compilar. Se restaura con `git checkout -- apps/native/src-tauri/Cargo.toml`.

Si cambia un programa que el PC no tiene o una variable obligatoria de `.env`, escribirlo en la descripción de la versión: el actualizador no los toca.

## 3. Instalar la versión en el local

Elegir un horario de baja ocupación. Primero, sin cambiar nada (solo descarga y verifica el instalador):

```bash
ssh apurimeno "powershell -NoProfile -ExecutionPolicy Bypass -File C:\ElApurimeno\apps\server\scripts\actualizar-produccion.ps1 -Comprobar"
```

Dice a qué versión iría, y qué tipo de actualización es:

| Tipo | Cuándo | Interrupción |
| --- | --- | --- |
| Rápida | Sin dependencias ni migraciones | Cerca de 1 minuto sin cobros, al final |
| Completa | Cambian `pnpm-lock.yaml`, migraciones o el esquema | Varios minutos sin cobros, toda la actualización |

Para instalar, lo mismo sin `-Comprobar`. Sin `-Version` instala la última; con `-Version v1.2.3`, esa.

```bash
ssh apurimeno "powershell -NoProfile -ExecutionPolicy Bypass -File C:\ElApurimeno\apps\server\scripts\actualizar-produccion.ps1"
```

Si el POS está abierto, se niega sin tocar nada: hay que pedir al cajero que lo cierre, o agregar `-CerrarPOS` (se pierde lo que esté escribiendo). **Después de la actualización, el POS no se vuelve a abrir solo:** hay que avisarle al cajero.

Si se corta la conexión, la actualización sigue sola. Para ver cómo terminó:

```bash
ssh apurimeno "powershell -NoProfile -ExecutionPolicy Bypass -File C:\ElApurimeno\apps\server\scripts\actualizar-produccion.ps1 -Estado"
```

El registro completo queda en `apps\server\datos\actualizaciones\ultima.log`. El de la compilación, en `apps\server\datos\logs`.

## Si algo sale mal

| Qué falló | Cómo queda | Qué hacer |
| --- | --- | --- |
| Comprobaciones, descarga o SHA-256 del POS | Nada cambió | Corregir y repetir |
| Copia de la base | Código anterior y servicios funcionando (en la completa, se vuelven a iniciar) | Corregir y repetir |
| Compilación (rápida) | Servicios sin tocar y código anterior | Corregir en una versión nueva |
| Una app no responde con su build nuevo | Esa app volvió sola a su build anterior; el servidor sigue con el código nuevo | Revisar `.next-fallido` y publicar una versión con la corrección |
| `pnpm install` (completa) | Código anterior y servicios iniciados | Revisar que respondan. Si `better-sqlite3` quedó sin binario, ver `CLAUDE.md`, "Windows" |
| **Migraciones del local** | **Servicios DETENIDOS a propósito** | Ver abajo |
| Migraciones solo de capacitación | El local funciona en la versión nueva; `ApurimenoCapacitacion` detenido | Con una versión corregida: `pnpm preparar-capacitacion` e iniciar el servicio. El personal no puede practicar mientras tanto |
| Compilación después de migrar | Servidor con el código nuevo y pantallas con su build anterior | Comprobar que funcione y publicar la corrección |
| Instalación del POS | Servicios actualizados, POS con su versión anterior | Ver `datos\actualizaciones\pos-instalacion.log` y volver a correr la versión. Un POS viejo puede no entenderse con el servidor nuevo |

**Volver atrás.** El actualizador no instala una versión anterior: la base puede tener migraciones que el código viejo no conoce. Si una versión salió mal, se publica otra con el cambio revertido.

**Si fallan las migraciones,** por SSH, en `C:\ElApurimeno\apps\server` y con los servicios detenidos:

1. Ver qué pasó: `pnpm exec prisma migrate status`.
2. Restaurar la copia tomada con los servicios ya detenidos, en la carpeta `antes-de-actualizar`, junto a la base (se guardan las últimas 5). Tiene todos los cobros y va sin cifrar, así que no pide la clave privada:

   ```powershell
   pnpm restaurar <ruta de la copia>
   ```

   La base vuelve a la copia, pero el comando termina con error mientras el código siga trayendo la migración que falla: la vuelve a intentar y queda marcada como fallida.
3. Quitarle esa marca a la base: `pnpm exec prisma migrate resolve --rolled-back <nombre de la migración>`.
4. Publicar una versión con la migración corregida o quitada, e instalarla con la orden de siempre. Al terminar, los servicios vuelven a iniciarse. Si la migración no llegó a cambiar nada, el paso 2 se puede omitir.

Ensayado el 05/11/2026, con una migración que falla por SQL inválido. Una migración que falle a la mitad deja la base cambiada: ahí el paso 2 es obligatorio.

## Ensayo antes de usarlo de verdad

`apps/server/scripts/probar-actualizar.ps1` prueba las decisiones con un git real y temporal, sin tocar el sistema.

**Ensayado el 05/11/2026 en el equipo de desarrollo,** con los cuatro servicios reales apuntando a un clon y un "origin" local, lanzado desde una consola de administrador (sin SSH) y con `-SinPOS`:

| Caso | Resultado |
| --- | --- |
| Rápida | Correcta: 114 s en total, 46 s de interrupción |
| Rápida con error de compilación | Volvió al código anterior; servicios sin tocar |
| Cortar la orden a la mitad | La tarea siguió sola y terminó bien; `-Estado` responde |
| Completa con migración | Correcta: 130 s en total, con los servicios detenidos desde el principio; migró las dos bases, y la copia tiene lo último registrado |
| Migración mala del local | Servicios detenidos; recuperado con los pasos de arriba y una versión corregida |
| Migración mala solo de capacitación | El local en la versión nueva; capacitación detenida |
| POS, por separado | `msiexec` en una tarea `S4U` reemplazó la 0.1.0 por la 0.2.0, sin duplicarla; el POS abre, entra y carga sus pantallas contra el servidor real, y el actualizador lo detecta |

**Falta, porque necesita el PC del local:**

- [ ] La conexión por Tailscale y SSH, desde otra red.
- [ ] Lanzar la orden por SSH: que la tarea programada arranque y encuentre `git` y `pnpm`.
- [ ] Cortar la conexión SSH de verdad a la mitad.
- [ ] Una versión publicada en GitHub: la descarga real del instalador y `pnpm publicar-version` sin `--solo-compilar`.
- [ ] Con esa versión: el POS abierto, con y sin `-CerrarPOS`.
- [ ] Con esa versión y la clave real: que el Dashboard del local la anuncie.

## Seguridad

- **Quién puede actualizar:** quien tenga la clave SSH y acceso a la cuenta de Tailscale. Quien puede publicar en GitHub no puede instalar nada por sí solo: la orden siempre sale de una sesión SSH.
- **Clave de versiones:** la privada solo está en el equipo de quien publica y en su gestor de contraseñas. Quien entre a la cuenta de GitHub no puede firmar, así que el Dashboard no anunciaría su versión.
- **Qué se instala:** solo etiquetas `vX.Y.Z` que estén en `origin/main` y sean posteriores a la instalada.
- **El SHA-256 del POS detecta una descarga dañada,** no un ataque: se publica en el mismo lugar que el MSI. El MSI no está firmado, y `msiexec` en modo silencioso no lo pide.
- **`.env` y claves:** no se tocan ni se muestran. La clave privada de respaldo sigue sin estar en el PC.
