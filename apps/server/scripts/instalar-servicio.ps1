<#
.SYNOPSIS
  Instala el servidor de El Apurimeño como servicio de Windows con NSSM: arranca solo al encender el equipo y se
  reinicia solo si se cae. Con -Produccion instala también el Dashboard y la app de Limpieza. Ver
  apps/server/README.md, "Servicio de Windows", y docs/INSTALACION_LOCAL.md.

.DESCRIPTION
  Hay que correrlo en una PowerShell "Ejecutar como administrador" (crear un servicio lo exige). Pasos:
    1. Descarga NSSM 2.24-101 (la versión recomendada para Windows 10 y 11) del sitio oficial, verifica su SHA-256
       y deja nssm.exe en C:\Program Files\NSSM. Si ya está, no lo descarga de nuevo.
    2. Crea (o actualiza) el servicio del servidor: un solo proceso node.exe con tsx, en apps/server, leyendo
       apps/server/.env como `pnpm start`. Arranque automático; si el proceso termina, NSSM lo vuelve a lanzar a los
       5 s (vuelve a responder en unos 7 s). El registro lo escribe el propio servidor en datos/logs/servidor.log y lo
       rota cada 10 MB mientras corre; NSSM guarda en datos/logs/servicio.log solo lo que salga por la consola (un
       error al arrancar, un fallo sin capturar).
    3. Con -Produccion o -Pantallas, crea (o actualiza) ApurimenoDashboard (puerto 3000) y ApurimenoLimpieza
       (puerto 3002): `next start` sobre el build de producción de cada app, un solo proceso node.exe, con el mismo
       arranque automático y la misma recuperación. Exige el build hecho antes (`pnpm --filter web build` y
       `pnpm --filter cleaning build`).
    4. Inicia los servicios y comprueba que responden.
  Se puede volver a correr: actualiza la configuración de los servicios existentes.

.PARAMETER Produccion
  Para el PC del local: el servidor arranca con NODE_ENV=production (exige JWT_SECRET en apps/server/.env, y solo
  acepta los orígenes de CORS_ORIGINS además del POS) y se instalan también el Dashboard y Limpieza.

.PARAMETER Pantallas
  Instala el Dashboard y Limpieza sin pasar el servidor a producción (para probarlos en un equipo de desarrollo).

.PARAMETER Desinstalar
  Detiene y elimina los servicios que existan (servidor, Dashboard y Limpieza). No toca la base ni las copias.
#>
param(
  [string]$Nombre = "ApurimenoServidor",
  [switch]$Produccion,
  [switch]$Pantallas,
  [switch]$Desinstalar,
  [string]$Registro
)

$ErrorActionPreference = "Stop"
if ($Registro) { Start-Transcript -Path $Registro -Append | Out-Null }
try {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { throw "Hace falta una PowerShell abierta como administrador (clic derecho > Ejecutar como administrador)." }

  $servidor = Split-Path -Parent $PSScriptRoot   # apps/server
  $apps = Split-Path -Parent $servidor           # apps
  $nssmDir = Join-Path $env:ProgramFiles "NSSM"
  $nssm = Join-Path $nssmDir "nssm.exe"

  # Las apps web: servicio, carpeta en apps/, puerto y nombre del filtro de pnpm para compilarla.
  # No se llama $pantallas: PowerShell no distingue mayúsculas y pisaría el parámetro -Pantallas.
  $appsWeb = @(
    @{ Servicio = "ApurimenoDashboard"; Carpeta = "web"; Puerto = 3000; Titulo = "Dashboard"
       Descripcion = "Dashboard de administración (next start, puerto 3000)." },
    @{ Servicio = "ApurimenoLimpieza"; Carpeta = "cleaning"; Puerto = 3002; Titulo = "Limpieza"
       Descripcion = "App de limpieza para los celulares (next start, puerto 3002)." }
  )

  if ($Desinstalar) {
    if (Test-Path $nssm) {
      foreach ($s in @($Nombre) + ($appsWeb | ForEach-Object { $_.Servicio })) {
        sc.exe query $s | Out-Null
        if ($LASTEXITCODE -eq 0) { & $nssm stop $s confirm | Out-Null; & $nssm remove $s confirm; Write-Host "Servicio $s eliminado." }
      }
    }
    Write-Host "La base y las copias no se tocaron."
    return
  }

  # 1. NSSM, del sitio oficial y con el hash verificado.
  if (-not (Test-Path $nssm)) {
    $url = "https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip"
    $sha256 = "99F5045FFFBFFB745D67FE3A065A953C4A3D9C253B868892D9B685B0EE7D07B8"
    $zip = Join-Path $env:TEMP "nssm-2.24-101.zip"
    Write-Host "Descargando NSSM de $url"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
    $hash = (Get-FileHash -Algorithm SHA256 $zip).Hash
    if ($hash -ne $sha256) { Remove-Item $zip -Force; throw "El SHA-256 de NSSM no coincide ($hash): no se instala." }
    $tmp = Join-Path $env:TEMP "nssm-2.24-101"
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    New-Item -ItemType Directory -Force $nssmDir | Out-Null
    Copy-Item (Get-ChildItem $tmp -Recurse -Filter nssm.exe | Where-Object { $_.Directory.Name -eq "win64" } | Select-Object -First 1).FullName $nssm
    Remove-Item $zip, $tmp -Recurse -Force
    Write-Host "NSSM instalado en $nssm"
  }

  $node = (Get-Command node -ErrorAction Stop).Source
  $logs = Join-Path $servidor "datos\logs"
  New-Item -ItemType Directory -Force $logs | Out-Null

  # Crea o actualiza un servicio de NSSM que corre node.exe con $Parametros en $Carpeta. La recuperación es la misma
  # para los tres: comprobada con el servidor (taskkill /F y reinicio del equipo).
  function Configurar-Servicio($Servicio, $Parametros, $Carpeta, $Titulo, $Descripcion, $Consola, $Entorno) {
    sc.exe query $Servicio | Out-Null
    if ($LASTEXITCODE -eq 0) { & $nssm stop $Servicio | Out-Null } else { & $nssm install $Servicio $node | Out-Null }
    $ajustes = @(
      @("Application", $node),
      @("AppParameters", $Parametros),
      @("AppDirectory", $Carpeta),
      @("DisplayName", "El Apurimeño - $Titulo"),
      @("Description", $Descripcion),
      @("Start", "SERVICE_AUTO_START"),
      @("AppExit", "Default", "Restart"),
      @("AppRestartDelay", "5000"),
      @("AppThrottle", "10000"),
      @("AppStopMethodConsole", "15000"),
      @("AppStdout", $Consola),
      @("AppStderr", $Consola),
      # Sin rotación de NSSM. La "en línea" (AppRotateOnline 1), la única que rota por tamaño mientras el proceso
      # corre, impide el reinicio: al morir el proceso NSSM queda esperando el hilo que lee su salida y nunca lo
      # relanza (comprobado con taskkill /F). La de arranque dejaba un archivo nuevo en cada inicio, aunque estuviera
      # vacío. servidor.log lo rota el propio servidor; los demás solo reciben lo que salga por la consola, y se agrega.
      @("AppRotateFiles", "0"),
      @("AppStdoutCreationDisposition", "4"),
      @("AppStderrCreationDisposition", "4")
    )
    foreach ($a in $ajustes) { & $nssm set $Servicio @a | Out-Null; if ($LASTEXITCODE -ne 0) { throw "nssm set $Servicio $($a -join ' ') falló." } }
    foreach ($r in "AppRotateOnline", "AppRotateBytes") { & $nssm reset $Servicio $r | Out-Null }   # de instalaciones previas
    & $nssm set $Servicio AppEnvironmentExtra @Entorno | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "nssm set $Servicio AppEnvironmentExtra falló." }
    # NSSM relanza el proceso. Si el propio NSSM terminara, Windows reintenta el servicio.
    sc.exe failure $Servicio reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null
    sc.exe failureflag $Servicio 1 | Out-Null
  }

  function Esperar-Respuesta($Url, $Servicio, $Consola) {
    $ok = $false
    for ($i = 0; $i -lt 40 -and -not $ok; $i++) {
      Start-Sleep -Seconds 1
      try { $ok = (Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 2).StatusCode -eq 200 } catch {}
    }
    & $nssm status $Servicio
    if (-not $ok) { throw "El servicio $Servicio no respondió en ${Url}: revise $Consola" }
  }

  # 2. El servidor: lo mismo que `pnpm start`, pero en un solo proceso (node --import tsx) y sin pasar por pnpm. El
  #    lanzador de tsx deja dos procesos node: matar solo el hijo lo dejaría huérfano con el puerto tomado.
  $tsx = Join-Path $servidor "node_modules\tsx"
  if (-not (Test-Path $tsx)) { throw "No se encontró ${tsx}: corra 'pnpm install' en la raíz del repositorio." }
  $env_ = Join-Path $servidor ".env"
  if ($Produccion) {
    $jwt = if (Test-Path $env_) { Select-String -Path $env_ -Pattern '^\s*JWT_SECRET\s*=\s*"?([^"\s]{32,})' } else { $null }
    if (-not $jwt) { throw "En producción, apps/server/.env necesita JWT_SECRET de al menos 32 caracteres." }
  }
  # Las apps web se comprueban antes de tocar nada: sin su build, `next start` no arranca.
  $conPantallas = $Produccion -or $Pantallas
  if ($conPantallas) {
    foreach ($p in $appsWeb) {
      $dir = Join-Path $apps $p.Carpeta
      if (-not (Test-Path (Join-Path $dir ".next\BUILD_ID"))) { throw "Falta el build de $($p.Titulo): corra 'pnpm --filter $($p.Carpeta) build' en la raíz." }
      if (-not (Test-Path (Join-Path $dir "node_modules\next\dist\bin\next"))) { throw "No se encontró Next.js en ${dir}: corra 'pnpm install' en la raíz." }
    }
  }

  # Ojo: PowerShell no distingue mayúsculas en los nombres de variables; $registro pisaría el parámetro -Registro.
  $logServidor = Join-Path $logs "servidor.log"   # lo escribe y rota el servidor (src/registro.ts)
  $log = Join-Path $logs "servicio.log"           # la consola del proceso, capturada por NSSM
  $entorno = @("REGISTRO_ARCHIVO=$logServidor")
  if ($Produccion) { $entorno += "NODE_ENV=production" }
  Configurar-Servicio $Nombre "--import tsx --env-file-if-exists=.env src/index.ts" $servidor "servidor local" `
    "API local del POS, el Dashboard y la app de limpieza; hace los respaldos y sincroniza el espejo." $log $entorno

  # 3. Dashboard y Limpieza: node.exe con el binario de Next (un solo proceso, el que escucha el puerto).
  if ($conPantallas) {
    foreach ($p in $appsWeb) {
      $dir = Join-Path $apps $p.Carpeta
      Configurar-Servicio $p.Servicio "node_modules\next\dist\bin\next start --hostname 0.0.0.0 --port $($p.Puerto)" $dir `
        $p.Titulo $p.Descripcion (Join-Path $logs "$($p.Carpeta).log") @("NODE_ENV=production")
    }
  }

  # 4. Arrancar y comprobar.
  & $nssm start $Nombre | Out-Null
  $puerto = 3001
  if (Test-Path $env_) {
    $pp = Select-String -Path $env_ -Pattern '^\s*PORT\s*=\s*"?(\d+)' | Select-Object -First 1
    if ($pp) { $puerto = [int]$pp.Matches[0].Groups[1].Value }
  }
  Esperar-Respuesta "http://127.0.0.1:$puerto/health" $Nombre "$log y $logServidor"
  Write-Host "Listo: el servicio $Nombre responde en el puerto $puerto y arrancará solo al encender el equipo."
  if ($conPantallas) {
    foreach ($p in $appsWeb) {
      & $nssm start $p.Servicio | Out-Null
      Esperar-Respuesta "http://127.0.0.1:$($p.Puerto)/" $p.Servicio (Join-Path $logs "$($p.Carpeta).log")
      Write-Host "Listo: $($p.Titulo) ($($p.Servicio)) responde en el puerto $($p.Puerto)."
    }
  }
} finally {
  if ($Registro) { Stop-Transcript | Out-Null }
}
