<#
.SYNOPSIS
  Actualiza el PC del local a una versión publicada (etiqueta vX.Y.Z): servidor, Dashboard, Limpieza y POS. Pensado para
  correrlo por SSH desde otro equipo. Ver docs/ACTUALIZACION_REMOTA.md.

.DESCRIPTION
  Uso, en el checkout de producción y como administrador:

    actualizar-produccion.ps1 -Comprobar [-Version vX.Y.Z]    Dice qué haría. No cambia nada.
    actualizar-produccion.ps1 [-Version vX.Y.Z] [-CerrarPOS]  Actualiza. Sin -Version, a la última publicada.
    actualizar-produccion.ps1 -Estado                         Versión instalada y resultado de la última actualización.
    actualizar-produccion.ps1 -RegistrarTarea                 Deja lista la tarea para el botón del Dashboard. Una vez.

  Por qué una tarea programada: al cortarse la conexión SSH, Windows mata lo que esa sesión lanzó, y al detenerse el
  servidor mataría lo que él lanzó. Una actualización cortada a la mitad deja el local sin cobrar. Por eso esta orden solo
  comprueba y lanza la tarea ApurimenoActualizacion (sin horario: solo corre cuando se la lanza), y muestra su registro.
  Si se corta la conexión, la tarea sigue; al volver a conectarse, -Estado dice cómo terminó.

  La tarea siempre es la misma y lee qué hacer de datos\actualizaciones\orden.json. Lo escriben esta orden o el servidor,
  cuando alguien pulsa "Actualizar" en el Dashboard (decisión 30 de contracts).

  Qué hace la tarea (-Aplicar):
    1. Comprobaciones, sin tocar nada: checkout en main sin cambios; la versión está en origin/main y es posterior a la
       instalada; su manifiesto tiene una firma válida (pnpm verificar-version, con el código ya instalado) y es de ese
       commit; el instalador del POS se descarga y coincide con el SHA-256 firmado; el POS está cerrado.
    2. Según lo que traiga la versión, con una copia de la base antes de traer el código (pnpm copia-previa; si falla, no
       sigue):
       - Rápida (sin dependencias ni migraciones): copia, trae el código y corre recompilar-produccion.ps1, que compila
         con los servicios funcionando. Si la compilación falla, vuelve al código anterior: el local ni se enteró.
       - Completa (pnpm-lock.yaml, migraciones o esquema): detiene los servicios, copia, trae el código, instala, migra y
         recompila. Con los servicios detenidos desde el principio: la interrupción dura minutos.
    3. Instala el POS en silencio. El cajero tiene que volver a abrirlo. Repetir la orden con el código al día instala
       solo el POS, si faltó.

  Si fallan las migraciones del local, los servicios quedan DETENIDOS a propósito: con una base a medio migrar se podrían
  registrar cobros mal. Se arregla por SSH, con la copia del paso 2 (docs/ACTUALIZACION_REMOTA.md, "Si algo sale mal"). Si
  fallan solo las de capacitación, el local sigue funcionando y queda detenido ApurimenoCapacitacion.

  Cargado con `.` solo define funciones: así lo usa probar-actualizar.ps1.

.PARAMETER CerrarPOS
  Cierra el POS si está abierto, en vez de negarse a seguir. Lo que el cajero estuviera escribiendo se pierde.

.PARAMETER SinPOS
  No descarga ni instala el POS. Para ensayar en un equipo sin el POS instalado.

.PARAMETER SinFirma
  No exige el manifiesto firmado. Solo para ensayar contra un "origin" local, que no publica nada en GitHub.
#>
param(
  [string]$Version = "",
  [switch]$Comprobar,
  [switch]$Estado,
  [switch]$Aplicar,
  [switch]$RegistrarTarea,
  [switch]$CerrarPOS,
  [switch]$SinPOS,
  [switch]$SinFirma
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "recompilar-produccion.ps1")   # solo define funciones y variables ($raiz, Correr, ...)

$repositorioGitHub = "ReizoVC/el-apurimeno"
$tarea = "ApurimenoActualizacion"
$carpetaActualizaciones = Join-Path $servidor "datos\actualizaciones"
$archivoEstado = Join-Path $carpetaActualizaciones "estado.json"
$archivoOrden = Join-Path $carpetaActualizaciones "orden.json"
$registroActualizacion = Join-Path $carpetaActualizaciones "ultima.log"

# Lo que obliga a una actualización completa: necesita los servicios detenidos.
$rutasCompleta = @("pnpm-lock.yaml", "apps/server/prisma/migrations/", "apps/server/prisma/schema.prisma")

function Git([string]$Argumentos) {
  $r = Correr "git -C `"$raiz`" $Argumentos"
  if ($r.Codigo -ne 0) { throw "git $Argumentos falló: $($r.Salida)" }
  return $r.Salida.Trim()
}
function Git-Ok([string]$Argumentos) { return (Correr "git -C `"$raiz`" $Argumentos").Codigo -eq 0 }

function Ultima-Version {
  $etiquetas = (Git "tag --list v*.*.* --merged origin/main --sort=-v:refname") -split "`n" | Where-Object { $_ -match "^v\d+\.\d+\.\d+$" }
  return @($etiquetas)[0]
}

function Tipo-De-Actualizacion([string]$Destino) {
  $cambiados = (Git "diff --name-only HEAD $Destino") -split "`n"
  foreach ($c in $cambiados) {
    foreach ($r in $rutasCompleta) { if ($c.StartsWith($r)) { return "completa" } }
  }
  return "rapida"
}

# --- Lo que la prueba reemplaza: todo lo que toca algo fuera del checkout ----------------------------------------------
function Comprobar-Entorno {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { throw "Hace falta una sesión de administrador." }
  if (-not (Test-Path $nssm)) { throw "No se encontró NSSM en ${nssm}." }
  foreach ($s in "ApurimenoServidor", "ApurimenoDashboard", "ApurimenoLimpieza") {
    if (-not (Existe-Servicio $s)) { throw "No existe el servicio ${s}: instálelo antes con instalar-servicio.ps1." }
  }
}
# Comprueba la firma con el código ya instalado, no con el que se va a instalar. Devuelve commit, sha256 y nombre.
function Verificar-Firma([string]$Destino) {
  $r = Correr "cd /d `"$servidor`" && pnpm --silent verificar-version $Destino"
  if ($r.Codigo -ne 0) { throw "La versión $Destino no pasó la verificación de firma: $($r.Salida) No se tocó nada." }
  # Correr mezcla la salida de errores: Node puede escribir ahí un aviso. El resultado es la última línea JSON.
  $linea = @(($r.Salida -split "`n") | Where-Object { $_.TrimStart().StartsWith("{") }) | Select-Object -Last 1
  if (-not $linea) { throw "La verificación de firma de $Destino no devolvió un resultado: $($r.Salida) No se tocó nada." }
  return $linea | ConvertFrom-Json
}
function Descargar-Archivo([string]$Url, [string]$Destino) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $ProgressPreference = "SilentlyContinue"
  Invoke-WebRequest -UseBasicParsing $Url -OutFile $Destino -TimeoutSec 600
}
function Procesos-POS {
  return @(Get-Process -Name "native" -ErrorAction SilentlyContinue | Where-Object { $_.Path -match "Apurime" })
}
function Cerrar-POS { Procesos-POS | ForEach-Object { Stop-Process -Id $_.Id -Force } }
function Version-POS-Instalada {
  $claves = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  $p = Get-ItemProperty $claves -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match "^El Apurime" } | Select-Object -First 1
  if ($p) { return $p.DisplayVersion } else { return $null }
}
function Instalar-MSI([string]$Msi) {
  $log = Join-Path $carpetaActualizaciones "pos-instalacion.log"
  $p = Start-Process msiexec.exe -ArgumentList "/i", "`"$Msi`"", "/qn", "/norestart", "/l*v", "`"$log`"" -Wait -PassThru
  return $p.ExitCode
}
function Tomar-Copia-Previa([string]$Etiqueta) {
  $r = Correr "cd /d `"$servidor`" && pnpm --silent copia-previa $Etiqueta"
  if ($r.Codigo -ne 0) { throw "No se pudo copiar la base; no se tocó nada: $($r.Salida)" }
  return $r.Salida.Trim()
}
function Instalar-Dependencias { return (Correr "cd /d `"$raiz`" && pnpm install --frozen-lockfile").Codigo -eq 0 }
function Migrar-Bases {
  if ((Correr "cd /d `"$servidor`" && pnpm exec prisma migrate deploy").Codigo -ne 0) { return "la base del local" }
  if (Test-Path $baseCapacitacion) {
    $anterior = $env:DATABASE_URL
    $env:DATABASE_URL = "file:" + $baseCapacitacion.Replace("\", "/")
    $r = Correr "cd /d `"$servidor`" && pnpm exec prisma migrate deploy"
    $env:DATABASE_URL = $anterior
    if ($r.Codigo -ne 0) { return "la base de capacitación" }
  }
  return $null
}
# Vuelve a cargar recompilar-produccion.ps1 ya con el código nuevo, para compilar con la versión que se está instalando.
function Recompilar {
  . (Join-Path $raiz "apps\server\scripts\recompilar-produccion.ps1")
  Principal
}
function Servicios-Del-Local {
  $lista = @("ApurimenoServidor", "ApurimenoDashboard", "ApurimenoLimpieza")
  if (Existe-Servicio "ApurimenoCapacitacion") { $lista += "ApurimenoCapacitacion" }
  return $lista
}

# --- Comprobaciones: nada de esto cambia el sistema --------------------------------------------------------------------
function Preparar-Plan {
  Comprobar-Entorno
  $rama = Git "rev-parse --abbrev-ref HEAD"
  $cambios = Git "status --porcelain"
  if ($rama -ne "main" -or $cambios -ne "") { throw "El checkout no está en main sin cambios (rama $rama). No se tocó nada." }

  Git "fetch origin main --tags" | Out-Null
  $destino = $Version
  if ($destino -eq "") {
    $destino = Ultima-Version
    if (-not $destino) { throw "No hay ninguna versión publicada." }
  }
  if ($destino -notmatch "^v\d+\.\d+\.\d+$") { throw "Versión inválida: '$destino'. Debe ser como v1.2.3." }
  if (-not (Git-Ok "rev-parse --verify --quiet refs/tags/$destino")) { throw "No existe la versión $destino." }
  if (-not (Git-Ok "merge-base --is-ancestor $destino origin/main")) { throw "La versión $destino no está en main: no se instala." }

  $actual = Git "rev-parse HEAD"
  $commit = Git "rev-list -n 1 $destino"   # no rev-parse con ^{commit}: cmd se come el ^
  $alDia = $actual -eq $commit
  if (-not $alDia -and -not (Git-Ok "merge-base --is-ancestor HEAD $destino")) {
    throw "La versión $destino no es posterior a la instalada ($(Git 'rev-parse --short HEAD')). Para volver atrás, publique una versión nueva que revierta el cambio."
  }
  # Lo que dice el manifiesto firmado manda sobre lo que diga la etiqueta: alguien con acceso a GitHub puede moverla.
  $firma = $null
  if (-not $SinFirma) {
    $firma = Verificar-Firma $destino
    if ($firma.commit -ne $commit) {
      throw "La etiqueta $destino apunta a $commit, pero la versión firmada es de $($firma.commit): no se instala. No se tocó nada."
    }
  }
  if ($alDia) { return @{ Destino = $destino; AlDia = $true; Firma = $firma } }
  return @{ Destino = $destino; AlDia = $false; Anterior = $actual; Tipo = (Tipo-De-Actualizacion $destino); Firma = $firma }
}

# Descarga y verifica el instalador antes de tocar nada. Devuelve su ruta, o $null si el POS ya está en esa versión.
function Preparar-POS([string]$Destino, $Firma) {
  if ($SinPOS) { return $null }
  $numero = $Destino.TrimStart("v")
  if ((Version-POS-Instalada) -eq $numero) { return $null }
  if ((Procesos-POS).Count -gt 0 -and -not $CerrarPOS) {
    throw "El POS está abierto: pida al cajero que lo cierre, o use -CerrarPOS (se pierde lo que esté escribiendo). No se tocó nada."
  }
  $carpeta = Join-Path $carpetaActualizaciones $Destino
  New-Item -ItemType Directory -Force $carpeta | Out-Null
  $nombre = "ElApurimeno-POS-$numero.msi"
  $msi = Join-Path $carpeta $nombre
  $base = "https://github.com/$repositorioGitHub/releases/download/$Destino"
  try {
    Descargar-Archivo "$base/$nombre" $msi
    # Sin firma, el .sha256 solo detecta una descarga dañada: se publica en el mismo lugar que el MSI.
    if (-not $Firma) { Descargar-Archivo "$base/$nombre.sha256" "$msi.sha256" }
  } catch {
    throw "No se pudo descargar el instalador del POS de $Destino ($($_.Exception.Message)). No se tocó nada."
  }
  $esperado = if ($Firma) { $Firma.sha256 } else { ((Get-Content "$msi.sha256" -Raw).Trim() -split "\s+")[0] }
  if ((Get-FileHash $msi -Algorithm SHA256).Hash -ne $esperado) {
    Remove-Item $msi -Force
    throw "El instalador del POS no coincide con su SHA-256: no se usa. No se tocó nada."
  }
  return $msi
}

# --- La actualización. Lanza si falla; lo que queda funcionando lo dice el mensaje. --------------------------------------
function Aplicar-Actualizacion {
  $plan = Preparar-Plan
  # Con el código al día, el POS puede faltar: una instalación anterior pudo fallar solo en ese paso.
  $msi = Preparar-POS $plan.Destino $plan.Firma
  if ($plan.AlDia -and -not $msi) { Write-Host "Ya está en $($plan.Destino). No hay nada que hacer."; return }

  $script:ReemplazoEmpezado = $false
  $script:OmitirCapacitacion = $false
  if ($plan.AlDia) {
    Write-Host "El código ya está en $($plan.Destino): solo falta el POS."
  } elseif ($plan.Tipo -eq "rapida") {
    Write-Host "Actualización rápida a $($plan.Destino). Copiando la base..."
    Write-Host "  Copia: $(Tomar-Copia-Previa $plan.Destino)"
    Git "merge --ff-only $($plan.Destino)" | Out-Null
    try {
      Recompilar
    } catch {
      if ($script:ReemplazoEmpezado) { throw }
      # Los servicios no se tocaron: siguen con el código anterior, y el checkout vuelve a coincidir con ellos.
      Git "reset --hard $($plan.Anterior)" | Out-Null
      throw "$($_.Exception.Message) Se volvió al código anterior."
    }
  } else {
    $servicios = Servicios-Del-Local
    Write-Host "Deteniendo los servicios (empieza la interrupción; dura toda la actualización)..."
    foreach ($s in $servicios) { Detener-Servicio $s }

    # Con los servicios detenidos: la copia tiene todos los cobros, y es la que se restaura si fallan las migraciones.
    try {
      Write-Host "  Copia: $(Tomar-Copia-Previa $plan.Destino)"
    } catch {
      foreach ($s in $servicios) { Iniciar-Servicio $s }
      throw
    }

    Git "merge --ff-only $($plan.Destino)" | Out-Null
    Write-Host "Instalando dependencias..."
    if (-not (Instalar-Dependencias)) {
      Git "reset --hard $($plan.Anterior)" | Out-Null
      $reinstalo = Instalar-Dependencias
      foreach ($s in $servicios) { Iniciar-Servicio $s }
      throw "Falló pnpm install. Se volvió al código anterior y se iniciaron los servicios$(if (-not $reinstalo) { ', pero tampoco se pudieron reinstalar sus dependencias: revise si responden' })."
    }
    Write-Host "Aplicando migraciones..."
    $fallo = Migrar-Bases
    if ($fallo -eq "la base del local") {
      throw "Fallaron las migraciones de $fallo. LOS SERVICIOS QUEDAN DETENIDOS a propósito: vea 'Si algo sale mal' en docs/ACTUALIZACION_REMOTA.md."
    }
    # La base de práctica no detiene al local: sigue sin ApurimenoCapacitacion, que se queda detenido.
    $script:OmitirCapacitacion = [bool]$fallo
    try {
      Recompilar
    } catch {
      if ($script:ReemplazoEmpezado) { throw }
      # La base ya migró: no se puede volver al código anterior. El servidor arranca con el nuevo y las pantallas con su
      # build anterior, para no dejar el local sin servicio.
      foreach ($s in $servicios) { if (-not ($script:OmitirCapacitacion -and $s -eq "ApurimenoCapacitacion")) { Iniciar-Servicio $s } }
      throw "$($_.Exception.Message) El servidor arrancó con el código nuevo y las pantallas con su build anterior: revise que funcionen."
    }
  }

  if ($msi) {
    if ($CerrarPOS) { Cerrar-POS }
    Write-Host "Instalando el POS..."
    $codigo = Instalar-MSI $msi
    if ($codigo -ne 0 -and $codigo -ne 3010) {
      throw "Los servicios quedaron en $($plan.Destino), pero el POS no se pudo instalar (msiexec $codigo): sigue con su versión anterior. Registro: $carpetaActualizaciones\pos-instalacion.log"
    }
    Write-Host "  POS instalado$(if ($codigo -eq 3010) { '; Windows pide reiniciar el equipo para terminar' }). El cajero tiene que volver a abrirlo."
  }
  if ($script:OmitirCapacitacion) {
    throw "El local quedó en $($plan.Destino) y funcionando, pero fallaron las migraciones de la base de capacitación: ApurimenoCapacitacion queda detenido. Vea 'Si algo sale mal' en docs/ACTUALIZACION_REMOTA.md."
  }
  Write-Host "Listo: el local quedó en $($plan.Destino)."
}

# --- Estado y tarea programada ---------------------------------------------------------------------------------------
function Guardar-Estado([string]$Resultado, [string]$Destino, [string]$Mensaje = "") {
  New-Item -ItemType Directory -Force $carpetaActualizaciones | Out-Null
  @{ resultado = $Resultado; version = $Destino; mensaje = $Mensaje; hora = (Get-Date).ToString("s") } | ConvertTo-Json | Set-Content $archivoEstado -Encoding UTF8
}
function Leer-Estado {
  if (Test-Path $archivoEstado) { return Get-Content $archivoEstado -Raw -Encoding UTF8 | ConvertFrom-Json }
  return $null
}
function Tarea-Corriendo {
  $t = Get-ScheduledTask -TaskName $tarea -ErrorAction SilentlyContinue
  return ($t -and $t.State -in "Running", "Queued")
}

function Mostrar-Estado {
  Write-Host "Versión instalada: $((Correr "git -C `"$raiz`" describe --tags --always").Salida.Trim())"
  $posInstalado = Version-POS-Instalada
  Write-Host "POS instalado: $(if ($posInstalado) { $posInstalado } else { 'no' })"
  $e = Leer-Estado
  if (-not $e) { Write-Host "Todavía no se actualizó con este script."; return }
  $resultado = $e.resultado
  if ($resultado -eq "en-curso" -and -not (Tarea-Corriendo)) { $resultado = "CORTADA (la tarea ya no corre: ¿se apagó el equipo?). Revise los servicios y el registro." }
  Write-Host "Última actualización: $($e.version), $resultado, $($e.hora)"
  if ($e.mensaje) { Write-Host "  $($e.mensaje)" }
  Write-Host "Registro: $registroActualizacion"
}

# La tarea no lleva parámetros: siempre lee la orden. Corre con la cuenta que la registra, que debe ser de administrador.
function Registrar-Tarea {
  Comprobar-Entorno
  $argumentos = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Aplicar"
  $accion = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argumentos -WorkingDirectory $raiz
  # S4U: corre como este mismo usuario, sin guardar su contraseña y sin depender de que la sesión siga abierta.
  $cuenta = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $principal = New-ScheduledTaskPrincipal -UserId $cuenta -LogonType S4U -RunLevel Highest
  $ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  Register-ScheduledTask -TaskName $tarea -Action $accion -Principal $principal -Settings $ajustes -Force | Out-Null
  New-Item -ItemType Directory -Force $carpetaActualizaciones | Out-Null
}

function Escribir-Orden {
  New-Item -ItemType Directory -Force $carpetaActualizaciones | Out-Null
  @{ version = $Version; cerrarPOS = [bool]$CerrarPOS; sinPOS = [bool]$SinPOS; sinFirma = [bool]$SinFirma } | ConvertTo-Json | Set-Content $archivoOrden -Encoding UTF8
}
# La orden vale una sola vez: se borra al leerla. Sin orden, la tarea no hace nada.
function Cargar-Orden {
  if (-not (Test-Path $archivoOrden)) { throw "La tarea corrió sin una orden en $archivoOrden. No se tocó nada." }
  $o = Get-Content $archivoOrden -Raw -Encoding UTF8 | ConvertFrom-Json
  Remove-Item $archivoOrden -Force
  $script:Version = [string]$o.version
  $script:CerrarPOS = [bool]$o.cerrarPOS
  $script:SinPOS = [bool]$o.sinPOS
  $script:SinFirma = [bool]$o.sinFirma
}

function Lanzar-Tarea {
  if (Tarea-Corriendo) { throw "Ya hay una actualización corriendo: vea su avance con -Estado." }
  Registrar-Tarea
  Escribir-Orden
  Guardar-Estado "en-curso" $(if ($Version) { $Version } else { "última" })
  Remove-Item $registroActualizacion -Force -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $tarea
  Write-Host "Actualización lanzada. Si se corta la conexión, sigue sola: al volver, use -Estado."

  # Muestra el registro mientras avanza. Solo mirar: cortar esto no detiene la tarea.
  $mostradas = 0
  do {
    Start-Sleep -Seconds 2
    $sigue = Tarea-Corriendo
    if (Test-Path $registroActualizacion) {
      $lineas = @(Get-Content $registroActualizacion -Encoding UTF8)
      $lineas | Select-Object -Skip $mostradas | ForEach-Object { Write-Host $_ }
      $mostradas = $lineas.Count
    }
  } while ($sigue)
  $e = Leer-Estado
  if ($e.resultado -eq "en-curso") {
    Write-Host "ERROR: la tarea terminó sin dejar resultado (código $((Get-ScheduledTaskInfo -TaskName $tarea).LastTaskResult)). No llegó a empezar o se cortó."
  }
  if ($e.resultado -ne "ok") { exit 1 }
}

# Lo que corre dentro de la tarea.
function Correr-Tarea {
  New-Item -ItemType Directory -Force $carpetaActualizaciones | Out-Null
  Start-Transcript -Path $registroActualizacion -Force | Out-Null
  $destino = "última"
  try {
    Cargar-Orden
    if ($Version) { $destino = $Version }
    Aplicar-Actualizacion
    Guardar-Estado "ok" $destino
  } catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    Guardar-Estado "error" $destino $_.Exception.Message
    Stop-Transcript | Out-Null
    exit 1
  }
  Stop-Transcript | Out-Null
}

if ($MyInvocation.InvocationName -ne ".") {
  if ($Estado) { Mostrar-Estado }
  elseif ($Aplicar) { Correr-Tarea }
  elseif ($RegistrarTarea) { Registrar-Tarea; Write-Host "Tarea $tarea registrada con la cuenta $([Security.Principal.WindowsIdentity]::GetCurrent().Name)." }
  elseif ($Comprobar) {
    $plan = Preparar-Plan
    if ($plan.AlDia) { Write-Host "El código ya está en $($plan.Destino)." }
    else {
      Write-Host "Se actualizaría a $($plan.Destino): actualización $($plan.Tipo)."
      if ($plan.Tipo -eq "rapida") { Write-Host "  Interrupción: cerca de 1 minuto, al final." }
      else { Write-Host "  Interrupción: varios minutos, TODA la actualización. El POS no puede cobrar mientras tanto." }
    }
    $msi = Preparar-POS $plan.Destino $plan.Firma
    Write-Host "  POS: $(if ($msi) { 'instalador descargado y verificado; se instalaría' } else { 'no hace falta instalarlo' })."
  }
  else { Lanzar-Tarea }
}
