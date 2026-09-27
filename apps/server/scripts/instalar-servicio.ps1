<#
.SYNOPSIS
  Instala el servidor de El Apurimeño como servicio de Windows con NSSM: arranca solo al encender el equipo y se
  reinicia solo si se cae. Ver apps/server/README.md, "Servicio de Windows".

.DESCRIPTION
  Hay que correrlo en una PowerShell "Ejecutar como administrador" (crear un servicio lo exige). Pasos:
    1. Descarga NSSM 2.24-101 (la versión recomendada para Windows 10 y 11) del sitio oficial, verifica su SHA-256
       y deja nssm.exe en C:\Program Files\NSSM. Si ya está, no lo descarga de nuevo.
    2. Crea (o actualiza) el servicio: un solo proceso node.exe con tsx, en apps/server, leyendo apps/server/.env
       como `pnpm start`. Arranque automático; si el proceso termina, NSSM lo vuelve a lanzar a los 5 s (vuelve a
       responder en unos 7 s); registro en datos/logs, rotado al arrancar el servicio.
    3. Lo inicia y comprueba que responde en /health.
  Se puede volver a correr: actualiza la configuración del servicio existente.

.PARAMETER Produccion
  Arranca con NODE_ENV=production (en el PC del local). Exige JWT_SECRET en apps/server/.env, y el servidor solo
  acepta los orígenes de CORS_ORIGINS además del POS.

.PARAMETER Desinstalar
  Detiene y elimina el servicio. No toca la base ni las copias.
#>
param(
  [string]$Nombre = "ApurimenoServidor",
  [switch]$Produccion,
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
  $nssmDir = Join-Path $env:ProgramFiles "NSSM"
  $nssm = Join-Path $nssmDir "nssm.exe"

  if ($Desinstalar) {
    if (Test-Path $nssm) { & $nssm stop $Nombre confirm | Out-Null; & $nssm remove $Nombre confirm }
    Write-Host "Servicio $Nombre eliminado. La base y las copias no se tocaron."
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

  # 2. El servicio: lo mismo que `pnpm start`, pero en un solo proceso (node --import tsx) y sin pasar por pnpm. El
  #    lanzador de tsx deja dos procesos node: matar solo el hijo lo dejaría huérfano con el puerto tomado.
  $node = (Get-Command node -ErrorAction Stop).Source
  $tsx = Join-Path $servidor "node_modules\tsx"
  if (-not (Test-Path $tsx)) { throw "No se encontró ${tsx}: corra 'pnpm install' en la raíz del repositorio." }
  $env_ = Join-Path $servidor ".env"
  if ($Produccion) {
    $jwt = if (Test-Path $env_) { Select-String -Path $env_ -Pattern '^\s*JWT_SECRET\s*=\s*"?([^"\s]{32,})' } else { $null }
    if (-not $jwt) { throw "En producción, apps/server/.env necesita JWT_SECRET de al menos 32 caracteres." }
  }
  $logs = Join-Path $servidor "datos\logs"
  New-Item -ItemType Directory -Force $logs | Out-Null
  $log = Join-Path $logs "servidor.log"

  sc.exe query $Nombre | Out-Null
  $existe = $LASTEXITCODE -eq 0
  if ($existe) { & $nssm stop $Nombre | Out-Null } else { & $nssm install $Nombre $node | Out-Null }
  $ajustes = @(
    @("Application", $node),
    @("AppParameters", "--import tsx --env-file-if-exists=.env src/index.ts"),
    @("AppDirectory", $servidor),
    @("DisplayName", "El Apurimeño - servidor local"),
    @("Description", "API local del POS, el Dashboard y la app de limpieza; hace los respaldos y sincroniza el espejo."),
    @("Start", "SERVICE_AUTO_START"),
    @("AppExit", "Default", "Restart"),
    @("AppRestartDelay", "5000"),
    @("AppThrottle", "10000"),
    @("AppStopMethodConsole", "15000"),
    @("AppStdout", $log),
    @("AppStderr", $log),
    @("AppRotateFiles", "1"),
    # Rotación al arrancar, NO en línea: con AppRotateOnline 1, cuando el proceso muere NSSM queda esperando el hilo
    # que lee su salida y nunca ejecuta el reinicio (comprobado matando el proceso con taskkill /F).
    @("AppRotateOnline", "0"),
    @("AppRotateBytes", "10485760")
  )
  foreach ($a in $ajustes) { & $nssm set $Nombre @a | Out-Null; if ($LASTEXITCODE -ne 0) { throw "nssm set $($a -join ' ') falló." } }
  if ($Produccion) { & $nssm set $Nombre AppEnvironmentExtra "NODE_ENV=production" | Out-Null }
  else { & $nssm reset $Nombre AppEnvironmentExtra | Out-Null }
  # El servidor lo relanza NSSM. Si el propio NSSM terminara, Windows reintenta el servicio.
  sc.exe failure $Nombre reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null
  sc.exe failureflag $Nombre 1 | Out-Null

  # 3. Arrancar y comprobar.
  & $nssm start $Nombre | Out-Null
  $puerto = 3001
  if (Test-Path $env_) {
    $p = Select-String -Path $env_ -Pattern '^\s*PORT\s*=\s*"?(\d+)' | Select-Object -First 1
    if ($p) { $puerto = [int]$p.Matches[0].Groups[1].Value }
  }
  $ok = $false
  for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
    Start-Sleep -Seconds 1
    try { $ok = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$puerto/health" -TimeoutSec 2).StatusCode -eq 200 } catch {}
  }
  & $nssm status $Nombre
  if (-not $ok) { throw "El servicio no respondió en http://127.0.0.1:$puerto/health: revise $log" }
  Write-Host "Listo: el servicio $Nombre responde en el puerto $puerto y arrancará solo al encender el equipo."
} finally {
  if ($Registro) { Stop-Transcript | Out-Null }
}
