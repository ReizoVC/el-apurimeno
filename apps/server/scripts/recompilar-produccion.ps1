<#
.SYNOPSIS
  Recompila el Dashboard y Limpieza sin dejar los servicios caídos mientras compila, y recién entonces los reemplaza.
  Es el paso que se corre cada vez que se actualiza el código en el PC del local. Ver docs/INSTALACION_LOCAL.md,
  sección 4, "Actualizar el código".

.DESCRIPTION
  Hay que correrlo en una PowerShell "Ejecutar como administrador", en el checkout de producción, después de
  `git pull`. Tres fases:

    1. Comprobaciones, sin tocar nada: el checkout está en `main` y sin cambios sin commit, los servicios existen,
       Next está instalado y ninguna base tiene migraciones pendientes (`prisma migrate status`, que solo lee y
       funciona con el servidor encendido). Si algo falla, se detiene aquí.
    2. Compilación, con los servicios funcionando: cada app se compila en `.next-nuevo` (CARPETA_COMPILACION, ver su
       next.config.ts), no en `.next`, que es la que están sirviendo. La salida completa va a un registro en
       apps/server/datos/logs. Solo el código de salida de la compilación decide si falló: los avisos que las
       herramientas escriben en la salida de errores (Browserslist, avisos de Node) no la detienen. Si una falla, los
       servicios no se tocaron y siguen sirviendo lo de antes.
    3. Reemplazo, solo si las dos compilaron: se detienen los servicios, `.next` pasa a `.next-anterior` y
       `.next-nuevo` a `.next` (un cambio de nombre en el mismo disco, instantáneo), se vuelven a iniciar y se comprueba
       que respondan. El servidor también se reinicia, para que corra el código nuevo. Si una app no responde con su
       build nuevo, vuelve sola al anterior.

  Por qué la compilación va por `cmd /c` y a un archivo: en Windows PowerShell 5.1, redirigir la salida de errores de
  un programa con $ErrorActionPreference = "Stop" convierte cualquier aviso en un error fatal. Así se cortó la
  compilación del 28/09/2026 con los servicios ya detenidos.

.PARAMETER SoloCompilar
  Solo las fases 1 y 2: deja `.next-nuevo` listo y no toca ningún servicio. No exige administrador ni `main`. Sirve
  para probar que el código compila, o para medir cuánto tarda, antes de la ventana de reemplazo.
#>
param(
  [switch]$SoloCompilar
)

$ErrorActionPreference = "Stop"
$servidor = Split-Path -Parent $PSScriptRoot   # apps/server
$apps = Split-Path -Parent $servidor           # apps
$raiz = Split-Path -Parent $apps
$logs = Join-Path $servidor "datos\logs"
$nssm = Join-Path $env:ProgramFiles "NSSM\nssm.exe"
$archivoEnv = Join-Path $servidor ".env"
$baseCapacitacion = Join-Path $servidor "datos\capacitacion\apurimeno-capacitacion.db"
New-Item -ItemType Directory -Force $logs | Out-Null

# Las apps que se compilan: servicio, carpeta en apps/ y puerto.
$pantallas = @(
  @{ Servicio = "ApurimenoDashboard"; Carpeta = "web"; Puerto = 3000; Titulo = "Dashboard" },
  @{ Servicio = "ApurimenoLimpieza"; Carpeta = "cleaning"; Puerto = 3002; Titulo = "Limpieza" }
)

# Corre un programa sin que PowerShell trate su salida de errores como un error: solo cuenta el código de salida.
function Correr([string]$Comando) {
  $ErrorActionPreference = "Continue"   # local a esta función
  $salida = cmd /c "$Comando 2>&1"
  return @{ Codigo = $LASTEXITCODE; Salida = ($salida -join "`n") }
}

function Existe-Servicio([string]$Servicio) {
  return (Correr "sc.exe query $Servicio").Codigo -eq 0
}

function Puerto-De([string]$Variable, [int]$PorDefecto) {
  if (Test-Path $archivoEnv) {
    $p = Select-String -Path $archivoEnv -Pattern "^\s*$Variable\s*=\s*`"?(\d+)" | Select-Object -First 1
    if ($p) { return [int]$p.Matches[0].Groups[1].Value }
  }
  return $PorDefecto
}

function Esperar-Respuesta([string]$Url) {
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    try { if ((Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 2).StatusCode -eq 200) { return $true } } catch {}
  }
  return $false
}

# ---------------------------------------------------------------------------------------------------------------------
# 1. Comprobaciones: nada de esto cambia nada.
# ---------------------------------------------------------------------------------------------------------------------
if (-not $SoloCompilar) {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { throw "Hace falta una PowerShell abierta como administrador (o -SoloCompilar para solo compilar)." }
  if (-not (Test-Path $nssm)) { throw "No se encontró NSSM en ${nssm}: los servicios se instalan con instalar-servicio.ps1." }
  foreach ($s in @("ApurimenoServidor") + ($pantallas | ForEach-Object { $_.Servicio })) {
    if (-not (Existe-Servicio $s)) { throw "No existe el servicio ${s}: instálelo antes con instalar-servicio.ps1." }
  }
  # CLAUDE.md, "Flujo de trabajo": el checkout de producción está en main y sin cambios sin commit.
  $rama = (Correr "git -C `"$raiz`" rev-parse --abbrev-ref HEAD").Salida.Trim()
  $cambios = (Correr "git -C `"$raiz`" status --porcelain").Salida.Trim()
  if ($rama -ne "main" -or $cambios -ne "") {
    throw "El checkout no está en main sin cambios (rama $rama). No se tocó nada."
  }
}
foreach ($p in $pantallas) {
  $next = Join-Path $apps "$($p.Carpeta)\node_modules\next\dist\bin\next"
  if (-not (Test-Path $next)) { throw "No se encontró Next.js en apps\$($p.Carpeta): corra 'pnpm install' en la raíz." }
}

# El servidor se reinicia con el código nuevo: si faltan migraciones, arrancaría con la base vieja. No se migra aquí
# (hace falta la copia previa y el procedimiento completo); solo se comprueba.
$bases = @(@{ Nombre = "la base del local"; Entorno = $null })
if (Test-Path $baseCapacitacion) {
  $bases += @{ Nombre = "la base de capacitación"; Entorno = "file:" + $baseCapacitacion.Replace("\", "/") }
}
$pendientes = @()
foreach ($b in $bases) {
  $anterior = $env:DATABASE_URL
  if ($b.Entorno) { $env:DATABASE_URL = $b.Entorno }
  $r = Correr "cd /d `"$servidor`" && pnpm exec prisma migrate status"
  $env:DATABASE_URL = $anterior
  if ($r.Codigo -ne 0) { $pendientes += $b.Nombre }
}
if ($pendientes.Count -gt 0) {
  $texto = "Migraciones pendientes o no comprobables en: $($pendientes -join ', ')."
  if (-not $SoloCompilar) {
    throw "$texto No se tocó nada. Use el procedimiento completo (docs/INSTALACION_LOCAL.md, sección 4, 'Actualizar el sistema')."
  }
  Write-Warning "$texto (con -SoloCompilar solo se avisa)."
}

# ---------------------------------------------------------------------------------------------------------------------
# 2. Compilación en .next-nuevo, con los servicios funcionando.
# ---------------------------------------------------------------------------------------------------------------------
$tiempos = @{}
foreach ($p in $pantallas) {
  $dir = Join-Path $apps $p.Carpeta
  $nuevo = Join-Path $dir ".next-nuevo"
  $registro = Join-Path $logs "compilacion-$($p.Carpeta).log"
  if (Test-Path $nuevo) { Remove-Item -Recurse -Force $nuevo }   # restos de una corrida anterior
  Write-Host "Compilando $($p.Titulo) en .next-nuevo (los servicios siguen funcionando)..."
  $env:CARPETA_COMPILACION = ".next-nuevo"
  $inicio = Get-Date
  # cmd /c y la salida al archivo: PowerShell no ve la salida de errores, solo el código de salida.
  $r = Correr "cd /d `"$raiz`" && pnpm --filter $($p.Carpeta) build > `"$registro`""
  $env:CARPETA_COMPILACION = $null
  $tiempos[$p.Titulo] = ((Get-Date) - $inicio).TotalSeconds
  if ($r.Codigo -ne 0 -or -not (Test-Path (Join-Path $nuevo "BUILD_ID"))) {
    Write-Host "---- últimas líneas de $registro ----"
    Get-Content $registro -Tail 25 | ForEach-Object { Write-Host "  $_" }
    if (Test-Path $nuevo) { Remove-Item -Recurse -Force $nuevo }
    throw "Falló la compilación de $($p.Titulo) (código $($r.Codigo)). Los servicios no se tocaron: siguen sirviendo lo de antes. Registro completo: $registro"
  }
  Write-Host ("  {0} compilado en {1:N0} s (registro: {2})" -f $p.Titulo, $tiempos[$p.Titulo], $registro)
}

if (-not $SoloCompilar) {
  # Next no debe haber cambiado archivos versionados (p. ej. tsconfig.json); si lo hizo, se para antes del reemplazo.
  $cambios = (Correr "git -C `"$raiz`" status --porcelain").Salida.Trim()
  if ($cambios -ne "") { throw "La compilación cambió archivos versionados; no se reemplazó nada:`n$cambios" }
}

if ($SoloCompilar) {
  Write-Host "Listo: .next-nuevo compilado en las dos apps. No se tocó ningún servicio."
  return
}

# ---------------------------------------------------------------------------------------------------------------------
# 3. Reemplazo: la única parte con los servicios detenidos.
# ---------------------------------------------------------------------------------------------------------------------
$servidores = @(@{ Servicio = "ApurimenoServidor"; Url = "http://127.0.0.1:$(Puerto-De 'PORT' 3001)/health" })
if (Existe-Servicio "ApurimenoCapacitacion") {
  # Corre el mismo código del servidor: también se reinicia.
  $servidores += @{ Servicio = "ApurimenoCapacitacion"; Url = "http://127.0.0.1:$(Puerto-De 'CAPACITACION_PORT' 3011)/health" }
}
$inicioVentana = Get-Date
Write-Host "Deteniendo los servicios (empieza la interrupción)..."
foreach ($s in ($pantallas | ForEach-Object { $_.Servicio }) + ($servidores | ForEach-Object { $_.Servicio })) {
  Correr "`"$nssm`" stop $s" | Out-Null
}

$cambiadas = @()
try {
  foreach ($p in $pantallas) {
    $dir = Join-Path $apps $p.Carpeta
    $anteriorDir = Join-Path $dir ".next-anterior"
    if (Test-Path $anteriorDir) { Remove-Item -Recurse -Force $anteriorDir }
    if (Test-Path (Join-Path $dir ".next")) { Rename-Item (Join-Path $dir ".next") ".next-anterior" }
    Rename-Item (Join-Path $dir ".next-nuevo") ".next"
    $cambiadas += $p
  }
} catch {
  # Un archivo bloqueado impidió el cambio: se deja cada app como estaba (también la que quedó a mitad) y se vuelve a
  # iniciar todo.
  foreach ($p in $pantallas) {
    $dir = Join-Path $apps $p.Carpeta
    if ($cambiadas -contains $p) { Rename-Item (Join-Path $dir ".next") ".next-nuevo" }
    if (-not (Test-Path (Join-Path $dir ".next")) -and (Test-Path (Join-Path $dir ".next-anterior"))) {
      Rename-Item (Join-Path $dir ".next-anterior") ".next"
    }
  }
  foreach ($s in ($servidores | ForEach-Object { $_.Servicio }) + ($pantallas | ForEach-Object { $_.Servicio })) {
    Correr "`"$nssm`" start $s" | Out-Null
  }
  throw "No se pudo cambiar el build ($($_.Exception.Message)). Se volvió a iniciar todo con los builds anteriores."
}

$errores = @()
foreach ($s in $servidores) {
  Correr "`"$nssm`" start $($s.Servicio)" | Out-Null
  if (-not (Esperar-Respuesta $s.Url)) {
    $errores += "$($s.Servicio) no responde en $($s.Url): revise apps\server\datos\logs (servicio.log y servidor.log)."
  }
}
foreach ($p in $pantallas) {
  Correr "`"$nssm`" start $($p.Servicio)" | Out-Null
  if (-not (Esperar-Respuesta "http://127.0.0.1:$($p.Puerto)/")) {
    # El build nuevo no arranca: se vuelve al anterior.
    $dir = Join-Path $apps $p.Carpeta
    Correr "`"$nssm`" stop $($p.Servicio)" | Out-Null
    $fallido = Join-Path $dir ".next-fallido"
    if (Test-Path $fallido) { Remove-Item -Recurse -Force $fallido }
    Rename-Item (Join-Path $dir ".next") ".next-fallido"
    Rename-Item (Join-Path $dir ".next-anterior") ".next"
    Correr "`"$nssm`" start $($p.Servicio)" | Out-Null
    $volvio = Esperar-Respuesta "http://127.0.0.1:$($p.Puerto)/"
    $errores += "$($p.Titulo) no respondió con el build nuevo; se volvió al anterior ($(if ($volvio) { 'responde' } else { 'TAMPOCO responde' })). El nuevo quedó en $fallido."
  }
}
$ventana = ((Get-Date) - $inicioVentana).TotalSeconds

Write-Host ("Compilación: Dashboard {0:N0} s, Limpieza {1:N0} s (con los servicios funcionando)." -f $tiempos["Dashboard"], $tiempos["Limpieza"])
Write-Host ("Interrupción de los servicios: {0:N0} s." -f $ventana)
if ($errores.Count -gt 0) {
  $errores | ForEach-Object { Write-Host "ERROR: $_" }
  throw "El reemplazo terminó con errores (arriba)."
}
Write-Host "Listo: los servicios responden con el código nuevo. El build anterior quedó en .next-anterior de cada app."
