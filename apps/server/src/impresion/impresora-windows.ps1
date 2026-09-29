<#
.SYNOPSIS
  Habla con la impresora de comprobantes en Windows. Lo lanza el servidor (src/impresion/transporte.ts), un proceso
  por comprobante; a mano solo se usa -Accion listar, a través de `pnpm buscar-impresora`.

.DESCRIPTION
  Tres formas de llegar a la impresora (IMPRESORA_DISPOSITIVO, ver apps/server/README.md, "Impresión"):
  - puerto: un puerto COM. Bluetooth (perfil de puerto serie) y las impresoras USB que se instalan como puerto serie.
  - usb:    la impresora USB directa, sin controlador de impresora (el de clase USB de Windows, usbprint).
  - cola:   una impresora instalada en Windows, en modo RAW. Pide su controlador y no informa papel ni tapa.

  Protocolo con el servidor, una línea JSON por mensaje en la salida estándar:
  1. Abre el dispositivo y responde {"evento":"abierto",...} con el estado de la impresora (DLE EOT 1 a 4, o lo
     que informe la cola de Windows), o {"evento":"error","mensaje":...} y termina.
  2. Espera una línea en la entrada estándar: "ENVIAR <bytes en base64>" o "CANCELAR". El servidor decide con el
     estado si se imprime: este script no interpreta los bits.
  3. Responde {"evento":"enviado"} o {"evento":"error",...} y termina, cerrando el dispositivo.

  Todas las esperas tienen plazo: un dispositivo que no responde no deja el proceso colgado. Además, el servidor
  termina este proceso (por su PID) si no responde a tiempo.
#>
param(
  [ValidateSet('listar', 'enviar')] [string] $Accion = 'enviar',
  [ValidateSet('puerto', 'usb', 'cola')] [string] $Tipo = 'puerto',
  [string] $Valor = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

function Responder($objeto) {
  [Console]::Out.WriteLine(($objeto | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}

# Plazos, en milisegundos.
$PLAZO_RESPUESTA_ESTADO = 500
$PLAZO_ESCRITURA = 20000

# Interfaz de dispositivo de las impresoras USB (GUID_DEVINTERFACE_USBPRINT).
$GUID_USBPRINT = '{28d78fad-5a12-11d1-ae5b-0000f81e2d61}'

# Rutas de las impresoras USB conectadas ahora, sin SetupAPI: Windows registra cada interfaz en DeviceClasses, y
# "Linked = 1" indica que el dispositivo está presente.
function Buscar-Usb {
  $clave = "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceClasses\$GUID_USBPRINT"
  if (-not (Test-Path $clave)) { return @() }
  $rutas = @()
  foreach ($sub in Get-ChildItem $clave) {
    $control = Join-Path $sub.PSPath '#\Control'
    if ((Test-Path $control) -and ((Get-ItemProperty $control -ErrorAction SilentlyContinue).Linked -eq 1)) {
      # "##?#USB#VID_...#{guid}" es la ruta "\\?\USB#VID_...#{guid}" con otro prefijo.
      $rutas += '\\?\' + $sub.PSChildName.Substring(4)
    }
  }
  return $rutas
}

$CODIGO_WINDOWS = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

public static class ImpresoraApurimeno {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern SafeFileHandle CreateFileW(string nombre, uint acceso, uint compartir, IntPtr seguridad, uint disposicion, uint banderas, IntPtr plantilla);

  // GENERIC_READ | GENERIC_WRITE, compartida, OPEN_EXISTING, E/S superpuesta (para poder esperar con plazo).
  public static FileStream AbrirUsb(string ruta) {
    SafeFileHandle h = CreateFileW(ruta, 0xC0000000, 3, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero);
    if (h.IsInvalid) throw new IOException("No se pudo abrir la impresora USB (error de Windows " + Marshal.GetLastWin32Error() + ").");
    return new FileStream(h, FileAccess.ReadWrite, 1, true);
  }

  // Un byte con plazo, o -1. usbprint puede completar una lectura sin datos: se vuelve a pedir hasta el plazo.
  public static int LeerByte(FileStream s, int plazoMs) {
    var reloj = System.Diagnostics.Stopwatch.StartNew();
    var b = new byte[1];
    while (reloj.ElapsedMilliseconds < plazoMs) {
      Task<int> t = s.ReadAsync(b, 0, 1);
      int resto = (int)Math.Max(1, plazoMs - reloj.ElapsedMilliseconds);
      if (!t.Wait(resto)) return -1;
      if (t.Result == 1) return b[0];
      System.Threading.Thread.Sleep(20);
    }
    return -1;
  }

  public static void Escribir(FileStream s, byte[] datos, int plazoMs) {
    if (!s.WriteAsync(datos, 0, datos.Length).Wait(plazoMs)) throw new IOException("La impresora no recibió los datos a tiempo.");
  }

  // Cola de Windows en modo RAW (winspool): los bytes ESC/POS llegan tal cual, sin pasar por el controlador.
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class InfoDocumento { public string pDocName; public string pOutputFile; public string pDatatype; }

  [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool OpenPrinterW(string nombre, out IntPtr h, IntPtr predeterminados);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool StartDocPrinterW(IntPtr h, int nivel, [In] InfoDocumento info);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] datos, int cantidad, out int escritos);

  public static void EnviarACola(string impresora, byte[] datos) {
    IntPtr h;
    if (!OpenPrinterW(impresora, out h, IntPtr.Zero)) throw new IOException("No se pudo abrir la impresora de Windows (error " + Marshal.GetLastWin32Error() + ").");
    try {
      var info = new InfoDocumento { pDocName = "Comprobante", pDatatype = "RAW" };
      if (!StartDocPrinterW(h, 1, info)) throw new IOException("La cola de Windows rechazó el trabajo (error " + Marshal.GetLastWin32Error() + ").");
      try {
        StartPagePrinter(h);
        int escritos;
        if (!WritePrinter(h, datos, datos.Length, out escritos) || escritos != datos.Length) {
          throw new IOException("La cola de Windows no recibió todos los datos (error " + Marshal.GetLastWin32Error() + ").");
        }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@

# DLE EOT 1 a 4. Si la impresora no contesta la primera, no tiene canal de vuelta: estado desconocido (null) y se
# imprime igual; el servidor solo detiene la impresión ante un problema informado.
function Leer-Estado([scriptblock] $escribir, [scriptblock] $leer) {
  $bytes = @()
  foreach ($n in 1..4) {
    & $escribir ([byte[]](0x10, 0x04, $n))
    $b = & $leer $PLAZO_RESPUESTA_ESTADO
    if ($b -lt 0) { return $null }
    $bytes += [int]$b
  }
  return , $bytes
}

if ($Accion -eq 'listar') {
  $puertos = @(Get-CimInstance Win32_PnPEntity -Filter "Name LIKE '%(COM%'" | ForEach-Object {
      if ($_.Name -match '\((COM\d+)\)') { @{ puerto = $Matches[1]; nombre = $_.Name } }
    })
  $usb = @(Buscar-Usb | ForEach-Object { @{ ruta = $_ } })
  $colas = @(Get-CimInstance Win32_Printer | ForEach-Object { @{ nombre = $_.Name; puerto = $_.PortName; controlador = $_.DriverName } })
  Responder @{ evento = 'lista'; puertos = $puertos; usb = $usb; colas = $colas }
  exit 0
}

$serie = $null
$flujo = $null
try {
  switch ($Tipo) {
    'puerto' {
      # La velocidad no importa en Bluetooth ni en USB (puerto virtual); sin control de flujo por hardware.
      $serie = New-Object System.IO.Ports.SerialPort $Valor, 9600, ([System.IO.Ports.Parity]::None), 8, ([System.IO.Ports.StopBits]::One)
      $serie.WriteTimeout = $PLAZO_ESCRITURA
      $serie.DtrEnable = $true
      $serie.RtsEnable = $true
      $serie.Open()
      $serie.DiscardInBuffer()
      $estado = Leer-Estado { param($d) $serie.Write($d, 0, $d.Length) } {
        param($ms)
        $serie.ReadTimeout = $ms
        try { $serie.ReadByte() } catch [System.TimeoutException] { -1 }
      }
      Responder @{ evento = 'abierto'; tipo = 'puerto'; estado = $estado }
    }
    'usb' {
      $rutas = @(Buscar-Usb)
      if ($Valor -ne '') { $rutas = @($rutas | Where-Object { $_.ToUpper().Contains($Valor.ToUpper()) }) }
      if ($rutas.Count -eq 0) { throw 'No hay ninguna impresora USB conectada.' }
      if ($rutas.Count -gt 1) { throw ('Hay más de una impresora USB conectada; indique cuál (usb:VID_xxxx&PID_xxxx): ' + ($rutas -join ', ')) }
      Add-Type -TypeDefinition $CODIGO_WINDOWS
      $flujo = [ImpresoraApurimeno]::AbrirUsb($rutas[0])
      $estado = Leer-Estado { param($d) [ImpresoraApurimeno]::Escribir($flujo, $d, $PLAZO_ESCRITURA) } {
        param($ms)
        [ImpresoraApurimeno]::LeerByte($flujo, $ms)
      }
      Responder @{ evento = 'abierto'; tipo = 'puerto'; estado = $estado }
    }
    'cola' {
      $impresora = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $Valor } | Select-Object -First 1
      if ($null -eq $impresora) { throw "No existe la impresora de Windows '$Valor'." }
      Add-Type -TypeDefinition $CODIGO_WINDOWS
      Responder @{
        evento = 'abierto'; tipo = 'cola'
        sinConexion = [bool]$impresora.WorkOffline
        estadoImpresora = $impresora.PrinterStatus
        errorDetectado = $impresora.DetectedErrorState
      }
    }
  }
}
catch {
  Responder @{ evento = 'error'; mensaje = $_.Exception.Message }
  if ($null -ne $serie) { $serie.Dispose() }
  if ($null -ne $flujo) { $flujo.Dispose() }
  exit 1
}

$codigoSalida = 0
try {
  $orden = [Console]::In.ReadLine()
  if ($null -ne $orden -and $orden.StartsWith('ENVIAR ')) {
    $datos = [Convert]::FromBase64String($orden.Substring(7))
    switch ($Tipo) {
      'puerto' {
        $serie.Write($datos, 0, $datos.Length)
        # Cerrar el puerto puede descartar lo que el controlador todavía no mandó: se espera a que salga todo.
        $reloj = [System.Diagnostics.Stopwatch]::StartNew()
        while ($serie.BytesToWrite -gt 0) {
          if ($reloj.ElapsedMilliseconds -gt $PLAZO_ESCRITURA) { throw 'La impresora no recibió los datos a tiempo.' }
          Start-Sleep -Milliseconds 50
        }
        Start-Sleep -Milliseconds 200
      }
      'usb' { [ImpresoraApurimeno]::Escribir($flujo, $datos, $PLAZO_ESCRITURA) }
      'cola' { [ImpresoraApurimeno]::EnviarACola($Valor, $datos) }
    }
    Responder @{ evento = 'enviado' }
  }
}
catch {
  Responder @{ evento = 'error'; mensaje = $_.Exception.Message }
  $codigoSalida = 1
}
finally {
  if ($null -ne $serie) { $serie.Dispose() }
  if ($null -ne $flujo) { $flujo.Dispose() }
}
exit $codigoSalida
