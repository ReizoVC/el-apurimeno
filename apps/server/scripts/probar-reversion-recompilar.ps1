<#
.SYNOPSIS
  Prueba la vuelta atrás de recompilar-produccion.ps1: si una app no responde con su build nuevo, el script la
  devuelve a su build anterior, la deja funcionando y lo informa, sin tocar la otra app.

.DESCRIPTION
  Usa las funciones reales de recompilar-produccion.ps1 (cargado con `.`: no corre nada). Solo reemplaza
  Iniciar-Servicio y Detener-Servicio: en vez de servicios de Windows, levantan `next start` de cada app en los puertos
  3100 (Dashboard) y 3102 (Limpieza) y los detienen por el PID exacto que lanzaron. El cambio de carpetas, la espera de
  respuesta y la vuelta atrás son los del script.

  Simulación: el build nuevo de Limpieza es bueno; al del Dashboard se le quita BUILD_ID después de compilarlo, así que
  `next start` no arranca con él (un build que compiló pero no responde).

  Se corre en un clon o worktree de desarrollo, nunca en el checkout de producción: se niega si ApurimenoDashboard o
  ApurimenoLimpieza sirven desde esta misma carpeta. No necesita administrador. Tarda unos 2 minutos (dos
  compilaciones y la espera de 40 s del Dashboard que no responde).
#>
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "recompilar-produccion.ps1")   # solo define funciones y variables ($apps, Correr, ...)

# Nunca en la carpeta de los servicios reales: cambiaría el build que están sirviendo.
foreach ($s in "ApurimenoDashboard", "ApurimenoLimpieza") {
  $dir = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$s\Parameters" -ErrorAction SilentlyContinue).AppDirectory
  if ($dir -and ((Split-Path -Parent $dir) -eq $apps)) {
    throw "$s sirve desde ${dir}: esta prueba no se corre en el checkout de producción."
  }
}

$pruebas = @(
  @{ Servicio = "PruebaDashboard"; Carpeta = "web"; Puerto = 3100; Titulo = "Dashboard" },
  @{ Servicio = "PruebaLimpieza"; Carpeta = "cleaning"; Puerto = 3102; Titulo = "Limpieza" }
)
foreach ($p in $pruebas) {
  if (Get-NetTCPConnection -LocalPort $p.Puerto -State Listen -ErrorAction SilentlyContinue) { throw "El puerto $($p.Puerto) está ocupado." }
}

# --- Los "servicios" de la prueba: next start, detenido por su PID (y los de sus hijos) --------------------------------
$script:procesos = @{}
function Iniciar-Servicio([string]$Servicio) {
  $p = $pruebas | Where-Object { $_.Servicio -eq $Servicio }
  $node = (Get-Command node).Source
  $proc = Start-Process -FilePath $node -ArgumentList "node_modules\next\dist\bin\next", "start", "--port", $p.Puerto `
    -WorkingDirectory (Join-Path $apps $p.Carpeta) -PassThru -WindowStyle Hidden
  $script:procesos[$Servicio] = $proc.Id
}
function Detener-Servicio([string]$Servicio) {
  $id = $script:procesos[$Servicio]
  if (-not $id) { return }
  $ids = @($id)
  for ($i = 0; $i -lt $ids.Count; $i++) {
    $ids += @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($ids[$i])" | ForEach-Object { $_.ProcessId })
  }
  foreach ($x in $ids) { Stop-Process -Id $x -Force -ErrorAction SilentlyContinue }
  $script:procesos.Remove($Servicio)
  Start-Sleep -Seconds 1
}

$fallas = 0
function Comprobar([string]$Que, [bool]$Ok) {
  Write-Host ("  [{0}] {1}" -f $(if ($Ok) { "OK" } else { "FALLA" }), $Que)
  if (-not $Ok) { $script:fallas++ }
}
function Marca([string]$Carpeta) {
  $f = Join-Path $Carpeta "MARCA-PRUEBA.txt"
  if (Test-Path $f) { return (Get-Content $f -Raw).Trim() } else { return $null }
}
function Responde([int]$Puerto) {
  try { return (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Puerto/" -TimeoutSec 5).StatusCode -eq 200 } catch { return $false }
}

try {
  # --- Preparación: build anterior en .next (marcado) y build nuevo en .next-nuevo -------------------------------------
  foreach ($p in $pruebas) {
    $dir = Join-Path $apps $p.Carpeta
    foreach ($resto in ".next-anterior", ".next-fallido", ".next-nuevo") {
      if (Test-Path (Join-Path $dir $resto)) { Remove-Item -Recurse -Force (Join-Path $dir $resto) }
    }
    if (-not (Test-Path (Join-Path $dir ".next\BUILD_ID"))) {
      Write-Host "Compilando el build anterior de $($p.Titulo) en .next..."
      if ((Correr "cd /d `"$raiz`" && pnpm --filter $($p.Carpeta) build").Codigo -ne 0) { throw "No compiló $($p.Titulo)." }
    }
    Set-Content (Join-Path $dir ".next\MARCA-PRUEBA.txt") "anterior"
    Write-Host "Compilando el build nuevo de $($p.Titulo) en .next-nuevo..."
    $env:CARPETA_COMPILACION = ".next-nuevo"
    $r = Correr "cd /d `"$raiz`" && pnpm --filter $($p.Carpeta) build"
    $env:CARPETA_COMPILACION = $null
    if ($r.Codigo -ne 0) { throw "No compiló el build nuevo de $($p.Titulo)." }
    Set-Content (Join-Path $dir ".next-nuevo\MARCA-PRUEBA.txt") "nuevo"
  }
  # El build nuevo del Dashboard compiló, pero no va a arrancar.
  Remove-Item (Join-Path $apps "web\.next-nuevo\BUILD_ID")

  # --- Antes: los dos "servicios" funcionando con el build anterior ----------------------------------------------------
  Write-Host "Iniciando los servicios de prueba con el build anterior..."
  foreach ($p in $pruebas) { Iniciar-Servicio $p.Servicio }
  foreach ($p in $pruebas) { Comprobar "antes: $($p.Titulo) responde con el build anterior" (Esperar-Respuesta "http://127.0.0.1:$($p.Puerto)/") }

  # --- El reemplazo real del script -----------------------------------------------------------------------------------
  Write-Host "Corriendo Reemplazar-Builds (el del script)..."
  $resultado = Reemplazar-Builds $pruebas @()
  Write-Host "Mensajes del script:"
  $resultado.Errores | ForEach-Object { Write-Host "  ERROR: $_" }
  Write-Host ("Interrupción: {0:N0} s" -f $resultado.Ventana)

  # --- Comprobaciones ---------------------------------------------------------------------------------------------------
  $web = Join-Path $apps "web"
  $cleaning = Join-Path $apps "cleaning"
  Write-Host "Dashboard (build nuevo que no responde):"
  Comprobar "detectó que no respondía y volvió atrás solo el Dashboard" (($resultado.Revertidas -join ",") -eq "Dashboard")
  Comprobar ".next es el build anterior" ((Marca (Join-Path $web ".next")) -eq "anterior")
  Comprobar "el build nuevo quedó aparte en .next-fallido" ((Marca (Join-Path $web ".next-fallido")) -eq "nuevo")
  Comprobar "no quedó nada a medio camino (.next-nuevo y .next-anterior no existen)" (-not (Test-Path (Join-Path $web ".next-nuevo")) -and -not (Test-Path (Join-Path $web ".next-anterior")))
  Comprobar "el servicio está corriendo con el build anterior y responde (puerto 3100)" ((Responde 3100) -and $script:procesos.ContainsKey("PruebaDashboard"))
  Comprobar "el mensaje dice qué pasó y que el anterior responde" (($resultado.Errores -join " ") -match "Dashboard no respondió con el build nuevo; se volvió al anterior, que responde")
  Write-Host "Limpieza (build nuevo bueno):"
  Comprobar ".next es el build nuevo" ((Marca (Join-Path $cleaning ".next")) -eq "nuevo")
  Comprobar "el anterior quedó en .next-anterior" ((Marca (Join-Path $cleaning ".next-anterior")) -eq "anterior")
  Comprobar "responde con el build nuevo (puerto 3102)" (Responde 3102)
  Comprobar "un solo error informado (el del Dashboard)" ($resultado.Errores.Count -eq 1)
} finally {
  foreach ($s in @($script:procesos.Keys)) { Detener-Servicio $s }
  foreach ($p in $pruebas) {
    $dir = Join-Path $apps $p.Carpeta
    foreach ($c in ".next", ".next-anterior", ".next-fallido", ".next-nuevo") {
      $m = Join-Path $dir "$c\MARCA-PRUEBA.txt"
      if (Test-Path $m) { Remove-Item $m }
    }
  }
}

if ($fallas -gt 0) { Write-Host "PRUEBA FALLIDA: $fallas comprobaciones fallaron."; exit 1 }
Write-Host "PRUEBA SUPERADA: la vuelta atrás funciona."
