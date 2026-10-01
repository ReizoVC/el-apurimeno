import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { setTimeout as dormir } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  FallaImpresora,
  causaDeError,
  causaSegunColaWindows,
  causaSegunEstado,
  type EstadoColaWindows,
  type RespuestaEstado,
} from "./estado.js";

/**
 * Cómo llegan los bytes a la impresora (ADR-05). `enviar` rechaza con `FallaImpresora` (con su causa) si la
 * impresora informa un problema o no se puede abrir; `comprobar` hace lo mismo sin imprimir nada.
 */
export interface TransporteImpresora {
  readonly descripcion: string;
  enviar(bytes: Uint8Array): Promise<void>;
  comprobar(): Promise<void>;
}

/**
 * Escribe los bytes al final de un archivo o dispositivo. En Linux, una impresora USB aparece como
 * `/dev/usb/lp0` y acepta ESC/POS escrito directamente. Con un archivo normal sirve para inspeccionar lo que
 * se habría impreso (`pnpm vista-impresion`). No lee el estado de la impresora: `comprobar` no revisa nada.
 */
export function transporteArchivo(ruta: string): TransporteImpresora {
  return {
    descripcion: `archivo ${ruta}`,
    enviar: (bytes) => appendFile(ruta, bytes),
    comprobar: () => Promise.resolve(),
  };
}

// --- Dispositivos con estado: puerto COM, USB directo y cola de Windows ---

/**
 * Lo que informa el dispositivo al abrirlo. `puerto` (COM o USB directo): los cuatro bytes de DLE EOT, o null si la
 * impresora no contesta (sin canal de vuelta; se imprime igual). `cola`: lo que informa la cola de Windows.
 */
export type InformeApertura = { tipo: "puerto"; estado: RespuestaEstado | null } | ({ tipo: "cola" } & EstadoColaWindows);

/** Una sesión con el dispositivo: se abre, informa, y envía o se cierra sin enviar. */
export interface ConexionImpresora {
  abrir(): Promise<InformeApertura>;
  enviar(bytes: Uint8Array): Promise<void>;
  cerrar(): void;
}

export function causaSegunInforme(informe: InformeApertura) {
  return informe.tipo === "puerto" ? (informe.estado === null ? null : causaSegunEstado(informe.estado)) : causaSegunColaWindows(informe);
}

const mensajeDe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Transporte sobre una conexión con estado: antes de cada comprobante abre el dispositivo y lee su estado; si hay
 * un problema, no envía nada y rechaza con su causa. Después de enviar no vuelve a preguntar: si el papel se acaba
 * a mitad del comprobante, la impresora lo termina sola al cambiar el rollo, y reintentarlo lo imprimiría dos veces.
 */
export function transporteConEstado(descripcion: string, conectar: () => ConexionImpresora): TransporteImpresora {
  const abrirYRevisar = async (): Promise<ConexionImpresora> => {
    const conexion = conectar();
    let informe: InformeApertura;
    try {
      informe = await conexion.abrir();
    } catch (error) {
      conexion.cerrar();
      throw new FallaImpresora("PRINTER_DISCONNECTED", `No se pudo abrir ${descripcion}: ${mensajeDe(error)}`);
    }
    const causa = causaSegunInforme(informe);
    if (causa !== null) {
      conexion.cerrar();
      throw new FallaImpresora(causa, `${descripcion} informa ${causa}: ${JSON.stringify(informe)}`);
    }
    return conexion;
  };
  return {
    descripcion,
    comprobar: async () => (await abrirYRevisar()).cerrar(),
    async enviar(bytes) {
      const conexion = await abrirYRevisar();
      try {
        await conexion.enviar(bytes);
      } catch (error) {
        throw error instanceof FallaImpresora ? error : new FallaImpresora("PRINTER_DISCONNECTED", `Falló el envío a ${descripcion}: ${mensajeDe(error)}`);
      } finally {
        conexion.cerrar();
      }
    },
  };
}

/** Plazos de la conversación con el ayudante de Windows, en milisegundos. */
export interface PlazosAyudante {
  /** Arrancar PowerShell, abrir el dispositivo (Bluetooth tarda en conectar) y leer el estado. */
  abrir: number;
  /** Enviar el comprobante (el logotipo son unos 5,5 KB). */
  enviar: number;
}
export const PLAZOS_AYUDANTE: PlazosAyudante = { abrir: 20_000, enviar: 30_000 };

export const AYUDANTE_WINDOWS = fileURLToPath(new URL("./impresora-windows.ps1", import.meta.url));

/** Cómo se lanza el ayudante; las pruebas lo reemplazan por un programa de Node que simula al dispositivo. */
export interface LanzadorAyudante {
  comando: string;
  argumentos: readonly string[];
}

export const lanzadorPowerShell = (argumentos: readonly string[]): LanzadorAyudante => ({
  comando: "powershell.exe",
  argumentos: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", AYUDANTE_WINDOWS, ...argumentos],
});

type MensajeAyudante =
  | ({ evento: "abierto" } & InformeApertura)
  | { evento: "enviado" }
  | { evento: "error"; mensaje: string }
  | ({ evento: "lista" } & DispositivosWindows);

interface SesionAyudante {
  leer(plazoMs: number): Promise<MensajeAyudante>;
  escribir(linea: string): void;
  cerrar(): void;
}

/** Lanza el ayudante y lee sus respuestas, una línea JSON cada una, con plazo. */
function sesionAyudante(lanzador: LanzadorAyudante): SesionAyudante {
  const hijo = spawn(lanzador.comando, [...lanzador.argumentos], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const lineas: string[] = [];
  let esperando: ((linea: string | null) => void) | null = null;
  let terminado = false;
  let errores = "";
  const entregar = (linea: string | null) => {
    const r = esperando;
    esperando = null;
    r?.(linea);
  };
  createInterface({ input: hijo.stdout }).on("line", (linea) => (esperando === null ? lineas.push(linea) : entregar(linea)));
  hijo.stderr.on("data", (d: Buffer) => (errores = (errores + d.toString("utf8")).slice(-2000)));
  hijo.stdin.on("error", () => undefined); // el ayudante ya terminó: lo informa `leer`
  const fin = () => {
    terminado = true;
    entregar(null);
  };
  hijo.on("close", fin);
  hijo.on("error", (error) => {
    errores = error.message;
    fin();
  });

  const leer = (plazoMs: number) =>
    new Promise<MensajeAyudante>((resolver, rechazar) => {
      const siguiente = lineas.shift();
      const procesar = (linea: string | null) => {
        clearTimeout(reloj);
        if (linea === null) return rechazar(new Error(`El ayudante terminó sin responder. ${errores.trim()}`.trim()));
        try {
          resolver(JSON.parse(linea) as MensajeAyudante);
        } catch {
          rechazar(new Error(`Respuesta inesperada del ayudante: ${linea.slice(0, 200)}`));
        }
      };
      const reloj = setTimeout(() => {
        esperando = null;
        cerrar();
        rechazar(new Error(`El dispositivo no respondió en ${plazoMs / 1000} s.`));
      }, plazoMs);
      if (siguiente !== undefined) procesar(siguiente);
      else if (terminado) procesar(null);
      else esperando = procesar;
    });

  const cerrar = () => {
    if (terminado) return;
    hijo.stdin.end("CANCELAR\n");
    // Si no termina solo, se termina este proceso (el que se lanzó aquí), nunca otro.
    setTimeout(() => {
      if (!terminado) hijo.kill();
    }, 2_000).unref();
  };

  return { leer, escribir: (linea) => hijo.stdin.write(`${linea}\n`), cerrar };
}

const inesperado = (m: MensajeAyudante) => new Error(m.evento === "error" ? m.mensaje : `Respuesta inesperada del ayudante: ${m.evento}`);

/**
 * Conexión a través del ayudante de PowerShell (impresora-windows.ps1), un proceso por comprobante: así un
 * dispositivo que se cuelga no bloquea el servidor. Si el ayudante no responde a tiempo, se termina ese proceso.
 */
export function conexionAyudante(lanzador: LanzadorAyudante, plazos: PlazosAyudante = PLAZOS_AYUDANTE): ConexionImpresora {
  const sesion = sesionAyudante(lanzador);
  return {
    async abrir() {
      const m = await sesion.leer(plazos.abrir);
      if (m.evento === "abierto") return m;
      throw inesperado(m);
    },
    async enviar(bytes) {
      sesion.escribir(`ENVIAR ${Buffer.from(bytes).toString("base64")}`);
      const m = await sesion.leer(plazos.enviar);
      if (m.evento !== "enviado") throw inesperado(m);
    },
    cerrar: sesion.cerrar,
  };
}

/** Puertos COM, impresoras USB y colas de impresión que ve Windows (`pnpm buscar-impresora`). Solo lee. */
export interface DispositivosWindows {
  puertos: { puerto: string; nombre: string }[];
  usb: { ruta: string }[];
  colas: { nombre: string; puerto: string; controlador: string }[];
}

export async function listarDispositivosWindows(lanzador = lanzadorPowerShell(["-Accion", "listar"])): Promise<DispositivosWindows> {
  const sesion = sesionAyudante(lanzador);
  try {
    const m = await sesion.leer(PLAZOS_AYUDANTE.abrir);
    if (m.evento !== "lista") throw inesperado(m);
    return m;
  } finally {
    sesion.cerrar();
  }
}

// --- IMPRESORA_DISPOSITIVO ---

/**
 * Dónde está la impresora, según `IMPRESORA_DISPOSITIVO`:
 * - `COM5`: puerto COM (Bluetooth, o USB instalada como puerto serie). Solo en Windows.
 * - `usb`: la única impresora USB conectada, directa; `usb:VID_0483&PID_5743` elige una si hay varias. Solo en Windows.
 * - `windows:Nombre de la impresora`: una impresora instalada en Windows, en modo RAW. Solo en Windows.
 * - cualquier otra cosa: una ruta a la que se escriben los bytes (`/dev/usb/lp0` en Linux, o un archivo).
 */
export type DestinoImpresora =
  | { tipo: "archivo"; ruta: string }
  | { tipo: "puerto"; puerto: string }
  | { tipo: "usb"; filtro: string | null }
  | { tipo: "cola"; nombre: string };

export function leerDestinoImpresora(valor: string | undefined): DestinoImpresora | null {
  const v = (valor ?? "").trim();
  if (v === "") return null;
  // "USB001" es el nombre de un puerto de la cola de Windows, no un archivo: escribir ahí crearía un archivo con ese nombre.
  if (/^USB\d{3}$/i.test(v)) {
    throw new Error(`IMPRESORA_DISPOSITIVO="${v}" es un puerto de la cola de Windows: use "usb" o "windows:<nombre de la impresora>" (pnpm buscar-impresora).`);
  }
  const com = /^(?:\\\\\.\\)?(COM\d{1,3})$/i.exec(v);
  if (com?.[1] !== undefined) return { tipo: "puerto", puerto: com[1].toUpperCase() };
  const usb = /^usb(?::(.+))?$/i.exec(v);
  if (usb !== null) return { tipo: "usb", filtro: usb[1]?.trim() || null };
  const cola = /^windows:(.+)$/i.exec(v);
  if (cola?.[1] !== undefined) return { tipo: "cola", nombre: cola[1].trim() };
  return { tipo: "archivo", ruta: v };
}

export function describirDestino(destino: DestinoImpresora): string {
  switch (destino.tipo) {
    case "archivo":
      return `archivo ${destino.ruta}`;
    case "puerto":
      return `puerto ${destino.puerto}`;
    case "usb":
      return destino.filtro === null ? "impresora USB" : `impresora USB ${destino.filtro}`;
    case "cola":
      return `impresora de Windows "${destino.nombre}"`;
  }
}

export function transporteDesdeDestino(destino: DestinoImpresora, plataforma: NodeJS.Platform = process.platform): TransporteImpresora {
  if (destino.tipo === "archivo") return transporteArchivo(destino.ruta);
  const descripcion = describirDestino(destino);
  if (plataforma !== "win32") throw new Error(`IMPRESORA_DISPOSITIVO: ${descripcion} solo se puede usar en Windows.`);
  const argumentos =
    destino.tipo === "puerto"
      ? ["-Tipo", "puerto", "-Valor", destino.puerto]
      : destino.tipo === "usb"
        ? ["-Tipo", "usb", "-Valor", destino.filtro ?? ""]
        : ["-Tipo", "cola", "-Valor", destino.nombre];
  return transporteConEstado(descripcion, () => conexionAyudante(lanzadorPowerShell(["-Accion", "enviar", ...argumentos])));
}

// --- Reintentos de conexión ---

/**
 * Esperas entre intentos cuando no hay conexión: 3 intentos, a los 0, 2 y 7 s. Cubre lo que se arregla solo en
 * segundos: la reconexión de Bluetooth, el puerto ocupado un momento por la instancia de capacitación, un cable USB
 * que se vuelve a enchufar. Un problema que informa la impresora (papel, tapa, temperatura) no se reintenta de
 * inmediato: lo resuelve una persona, y la cola vuelve a intentar cada 30 s (cola.ts).
 */
export const ESPERAS_REINTENTO_CONEXION_MS: readonly number[] = [2_000, 5_000];

export async function conReintentos<T>(
  accion: () => Promise<T>,
  esperasMs: readonly number[] = ESPERAS_REINTENTO_CONEXION_MS,
  esperar: (ms: number) => Promise<unknown> = dormir,
  alReintentar: (error: unknown, espera: number) => void = () => undefined,
): Promise<T> {
  for (let intento = 0; ; intento++) {
    try {
      return await accion();
    } catch (error) {
      const espera = esperasMs[intento];
      if (espera === undefined || causaDeError(error) !== "PRINTER_DISCONNECTED") throw error;
      alReintentar(error, espera);
      await esperar(espera);
    }
  }
}

// --- Simulación ---

/** Estado de la impresora simulada: la respuesta a DLE EOT, sin canal de vuelta (null) o sin conexión. */
export type EstadoSimulado = RespuestaEstado | null | "SIN_CONEXION";

/**
 * Impresora simulada para las pruebas y `pnpm prueba-impresora`: responde DLE EOT con los bytes que mandaría una
 * impresora real en ese estado y, si imprime, agrega los bytes al archivo. No toca ningún dispositivo.
 */
export function conexionSimulada(archivo: string, estado: () => EstadoSimulado): ConexionImpresora {
  return {
    async abrir() {
      const e = estado();
      if (e === "SIN_CONEXION") throw new Error("El puerto no existe (simulado).");
      return { tipo: "puerto", estado: e };
    },
    enviar: (bytes) => appendFile(archivo, bytes),
    cerrar: () => undefined,
  };
}
