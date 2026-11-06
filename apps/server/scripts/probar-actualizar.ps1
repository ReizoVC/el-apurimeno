<#
.SYNOPSIS
  Prueba las decisiones de actualizar-produccion.ps1 con un repositorio git real y temporal, sin tocar el sistema.

.DESCRIPTION
  Usa las funciones reales del script (cargado con `.`), con git real contra un "origin" en una carpeta temporal. Solo
  reemplaza lo que toca algo fuera de esa carpeta: servicios, descargas, POS, msiexec, copia de la base, pnpm y la
  recompilación. No crea la tarea programada y no necesita administrador. Corre en segundos.

  La tarea programada, SSH, msiexec y la compilación real se comprueban con el ensayo de docs/ACTUALIZACION_REMOTA.md.
#>
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "actualizar-produccion.ps1")

$temporal = Join-Path $env:TEMP "apr-act-$PID"
$origen = Join-Path $temporal "origen.git"
$raiz = Join-Path $temporal "local"
$servidor = Join-Path $raiz "apps\server"
$carpetaActualizaciones = Join-Path $temporal "actualizaciones"
$baseCapacitacion = Join-Path $temporal "no-existe.db"

# --- Lo reemplazado: anota qué se llamó, en orden, y falla donde el caso lo pida ----------------------------------------
$script:llamadas = @()
$script:falla = @{}
$script:posAbierto = $false
$script:posInstalado = $null
$script:hashMalo = $false
function Anotar([string]$Que) { $script:llamadas += $Que }
function Comprobar-Entorno {}
function Existe-Servicio([string]$S) { return $S -ne "ApurimenoCapacitacion" }
function Detener-Servicio([string]$S) { Anotar "detener:$S" }
function Iniciar-Servicio([string]$S) { Anotar "iniciar:$S" }
function Tomar-Copia-Previa([string]$E) { Anotar "copia"; if ($script:falla.copia) { throw "falló la copia" }; return "copia.db" }
function Instalar-Dependencias { Anotar "install"; return -not $script:falla.install }
function Migrar-Bases {
  Anotar "migrar"
  if ($script:falla.migrar) { return "la base del local" }
  if ($script:falla.migrarCapacitacion) { return "la base de capacitación" }
  return $null
}
function Recompilar {
  Anotar "recompilar"
  if ($script:falla.compilar) { throw "Falló la compilación." }
  $script:ReemplazoEmpezado = $true
  if ($script:falla.reemplazo) { throw "El reemplazo terminó con errores." }
}
function Descargar-Archivo([string]$Url, [string]$Destino) {
  Anotar "descargar"
  if ($Destino.EndsWith(".sha256")) {
    $msi = $Destino.Substring(0, $Destino.Length - 7)
    $h = (Get-FileHash $msi -Algorithm SHA256).Hash
    if ($script:hashMalo) { $h = "0" * 64 }
    Set-Content $Destino "$h  x.msi"
  } else { Set-Content $Destino "msi de prueba" }
}
function Procesos-POS { if ($script:posAbierto) { return @(1) } else { return @() } }
function Cerrar-POS { Anotar "cerrar-pos" }
function Version-POS-Instalada { return $script:posInstalado }
function Instalar-MSI([string]$Msi) { Anotar "msi"; if ($script:falla.msi) { return 1603 }; return 0 }

# --- Repositorio de prueba ------------------------------------------------------------------------------------------
function G([string]$Argumentos, [string]$En = $raiz) {
  $r = Correr "git -C `"$En`" -c user.name=prueba -c user.email=prueba@ejemplo.test $Argumentos"
  if ($r.Codigo -ne 0) { throw "git $Argumentos -> $($r.Salida)" }
  return $r.Salida.Trim()
}
function Publicar([string]$Etiqueta, [string]$Archivo, [switch]$SinFusionar) {
  $f = Join-Path $trabajo $Archivo
  New-Item -ItemType Directory -Force (Split-Path $f) | Out-Null
  Set-Content $f $Etiqueta
  G "add -A" $trabajo | Out-Null
  G "commit -m $Etiqueta" $trabajo | Out-Null
  G "tag -a $Etiqueta -m $Etiqueta" $trabajo | Out-Null
  G "push origin HEAD:$(if ($SinFusionar) { 'refs/heads/otra' } else { 'main' }) $Etiqueta" $trabajo | Out-Null
}
function Instalada { return G "rev-parse HEAD" }
function Etiquetada([string]$E) { return G "rev-list -n 1 $E" }

$fallas = 0
function Comprobar([string]$Que, [bool]$Ok) {
  Write-Host ("  [{0}] {1}" -f $(if ($Ok) { "OK" } else { "FALLA" }), $Que)
  if (-not $Ok) { $script:fallas++ }
}
# Corre una actualización con el caso limpio; devuelve el mensaje de error, o "" si terminó bien.
function Actualizar([string]$A, [hashtable]$Falla = @{}, [switch]$Cerrar) {
  $script:llamadas = @(); $script:falla = $Falla
  $script:Version = $A
  $script:CerrarPOS = [bool]$Cerrar
  try { Aplicar-Actualizacion 6>$null | Out-Null; return "" } catch { return $_.Exception.Message }
}
function Hizo([string]$Que) { return $script:llamadas -contains $Que }

try {
  New-Item -ItemType Directory -Force $temporal, $carpetaActualizaciones | Out-Null
  $trabajo = Join-Path $temporal "trabajo"
  Correr "git init --bare --initial-branch=main `"$origen`"" | Out-Null
  Correr "git clone `"$origen`" `"$trabajo`"" | Out-Null
  Publicar "v1.0.0" "inicio.txt"
  Correr "git clone --branch main `"$origen`" `"$raiz`"" | Out-Null

  Write-Host "Rápida, todo bien:"
  Publicar "v1.1.0" "apps/web/pagina.txt"
  $e = Actualizar "v1.1.0"
  Comprobar "termina sin error ($e)" ($e -eq "")
  Comprobar "copia antes de traer el código, recompila" ((($script:llamadas -join ",") -match "descargar,descargar,copia,recompilar,msi"))
  Comprobar "no detiene servicios por su cuenta ni instala dependencias" (-not (Hizo "install") -and -not ($script:llamadas -match "detener"))
  Comprobar "el checkout quedó en v1.1.0" ((Instalada) -eq (Etiquetada "v1.1.0"))

  Write-Host "Rápida, falla la compilación:"
  Publicar "v1.2.0" "apps/web/pagina.txt"
  $antes = Instalada
  $e = Actualizar "v1.2.0" @{ compilar = $true }
  Comprobar "informa el error y que volvió" ($e -match "Se volvió al código anterior")
  Comprobar "el checkout volvió al código anterior" ((Instalada) -eq $antes)
  Comprobar "no instaló el POS" (-not (Hizo "msi"))

  Write-Host "Rápida, falla el reemplazo:"
  $e = Actualizar "v1.2.0" @{ reemplazo = $true }
  Comprobar "informa el error" ($e -match "reemplazo")
  Comprobar "se queda en el código nuevo (los servicios ya lo cargaron)" ((Instalada) -eq (Etiquetada "v1.2.0"))

  Write-Host "Falla la copia de la base:"
  Publicar "v1.3.0" "apps/web/pagina.txt"
  $antes = Instalada
  $e = Actualizar "v1.3.0" @{ copia = $true }
  Comprobar "se detiene sin traer el código" (($e -match "copia") -and (Instalada) -eq $antes -and -not (Hizo "recompilar"))

  Write-Host "Completa, por dependencias:"
  Publicar "v2.0.0" "pnpm-lock.yaml"
  $e = Actualizar "v2.0.0"
  $orden = $script:llamadas -join ","
  Comprobar "termina sin error ($e)" ($e -eq "")
  Comprobar "detiene, copia, instala, migra y recompila, en ese orden" ($orden -match "detener:ApurimenoServidor,detener:ApurimenoDashboard,detener:ApurimenoLimpieza,copia,install,migrar,recompilar")

  Write-Host "Completa, por migraciones, falla la copia:"
  Publicar "v2.1.0" "apps/server/prisma/migrations/x/migration.sql"
  $antes = Instalada
  $e = Actualizar "v2.1.0" @{ copia = $true }
  Comprobar "informa, no trae el código y vuelve a iniciar los servicios" (($e -match "copia") -and (Instalada) -eq $antes -and (Hizo "iniciar:ApurimenoServidor"))

  Write-Host "Completa, por migraciones, falla pnpm install:"
  $e = Actualizar "v2.1.0" @{ install = $true }
  Comprobar "informa y vuelve al código anterior" (($e -match "pnpm install") -and (Instalada) -eq $antes)
  Comprobar "vuelve a iniciar los servicios" (Hizo "iniciar:ApurimenoServidor")
  Comprobar "no migró" (-not (Hizo "migrar"))

  Write-Host "Completa, fallan las migraciones:"
  $e = Actualizar "v2.1.0" @{ migrar = $true }
  Comprobar "avisa que quedan detenidos" ($e -match "QUEDAN DETENIDOS")
  Comprobar "NO inicia los servicios ni recompila" (-not ($script:llamadas -match "iniciar") -and -not (Hizo "recompilar"))
  G "reset --hard $antes" | Out-Null

  Write-Host "Completa, fallan solo las migraciones de capacitación:"
  $e = Actualizar "v2.1.0" @{ migrarCapacitacion = $true }
  Comprobar "avisa, sin decir que el local quedó detenido" (($e -match "capacitación") -and -not ($e -match "QUEDAN DETENIDOS"))
  Comprobar "el local se recompila y arranca" ((Hizo "recompilar") -and (Instalada) -eq (Etiquetada "v2.1.0"))
  Comprobar "recompilar sabe que debe omitirla" ($script:OmitirCapacitacion -eq $true)
  G "reset --hard $antes" | Out-Null

  Write-Host "Completa, falla la compilación después de migrar:"
  $e = Actualizar "v2.1.0" @{ compilar = $true }
  Comprobar "inicia los servicios y se queda en el código nuevo (la base ya migró)" ((Hizo "iniciar:ApurimenoServidor") -and (Instalada) -eq (Etiquetada "v2.1.0"))
  Comprobar "lo informa" ($e -match "código nuevo")

  Write-Host "Versiones que no se instalan:"
  $antes = Instalada
  Comprobar "una anterior a la instalada" ((Actualizar "v1.0.0") -match "no es posterior")
  Comprobar "una que no existe" ((Actualizar "v9.9.9") -match "No existe")
  Comprobar "un texto que no es una versión" ((Actualizar "main") -match "inválida")
  Publicar "v3.0.0" "rama.txt" -SinFusionar
  Comprobar "una etiqueta fuera de main" ((Actualizar "v3.0.0") -match "no está en main")
  $script:posInstalado = "2.1.0"
  Comprobar "la instalada, con el POS al día, sin hacer nada" ((Actualizar "v2.1.0") -eq "" -and $script:llamadas.Count -eq 0)
  $script:posInstalado = $null
  Comprobar "ninguna movió el checkout" ((Instalada) -eq $antes)
  G "reset --hard HEAD~1" $trabajo | Out-Null

  Write-Host "POS:"
  Publicar "v3.1.0" "apps/web/pagina.txt"
  $antes = Instalada
  $script:hashMalo = $true
  $e = Actualizar "v3.1.0"
  $script:hashMalo = $false
  Comprobar "SHA-256 distinto: no toca nada" (($e -match "SHA-256") -and -not (Hizo "copia") -and (Instalada) -eq $antes)
  $script:posAbierto = $true
  $e = Actualizar "v3.1.0"
  Comprobar "POS abierto: se niega sin tocar nada" (($e -match "POS está abierto") -and -not (Hizo "copia") -and (Instalada) -eq $antes)
  $e = Actualizar "v3.1.0" -Cerrar
  $orden = $script:llamadas -join ","
  Comprobar "POS abierto con -CerrarPOS: lo cierra justo antes de instalar" (($e -eq "") -and ($orden -match "recompilar,cerrar-pos,msi"))
  $script:posAbierto = $false

  Publicar "v3.2.0" "apps/web/pagina.txt"
  $e = Actualizar "v3.2.0" @{ msi = $true }
  Comprobar "falla msiexec: lo informa, servicios en la versión nueva" (($e -match "msiexec 1603") -and (Instalada) -eq (Etiquetada "v3.2.0"))
  $e = Actualizar "v3.2.0"
  Comprobar "repetir la versión instala solo el POS" (($e -eq "") -and (Hizo "msi") -and -not (Hizo "copia") -and -not (Hizo "recompilar"))

  Publicar "v3.3.0" "apps/web/pagina.txt"
  $script:posInstalado = "3.3.0"
  $e = Actualizar "v3.3.0"
  Comprobar "POS ya en esa versión: no lo descarga ni instala" (($e -eq "") -and -not (Hizo "descargar") -and -not (Hizo "msi"))
  $script:posInstalado = $null

  Write-Host "Sin versión indicada:"
  Publicar "v3.10.0" "apps/web/pagina.txt"
  G "fetch origin main --tags" | Out-Null
  Comprobar "toma la mayor por número, no por orden de texto" ((Ultima-Version) -eq "v3.10.0")
} finally {
  # Solo la carpeta temporal que creó esta prueba.
  Remove-Item -Recurse -Force $temporal -ErrorAction SilentlyContinue
}

if ($fallas -gt 0) { Write-Host "PRUEBA FALLIDA: $fallas comprobaciones fallaron."; exit 1 }
Write-Host "PRUEBA SUPERADA."
