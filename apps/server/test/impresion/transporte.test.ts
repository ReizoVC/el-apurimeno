import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FallaImpresora,
  RESPUESTAS_TIPICAS,
  causaDeError,
  causaSegunColaWindows,
  causaSegunEstado,
  comandoConsultaEstado,
  esRespuestaEstadoValida,
} from "../../src/impresion/estado.js";
import {
  conReintentos,
  conexionAyudante,
  conexionSimulada,
  lanzadorPowerShell,
  leerDestinoImpresora,
  transporteConEstado,
  transporteDesdeDestino,
  type InformeApertura,
} from "../../src/impresion/transporte.js";

const AYUDANTE_SIMULADO = fileURLToPath(new URL("./ayudante-simulado.mjs", import.meta.url));
const nuevoArchivo = () => join(mkdtempSync(join(tmpdir(), "impresora-")), "salida.bin");

/** Rechazo esperado con su causa. */
async function causaDelRechazo(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (error) {
    expect(error).toBeInstanceOf(FallaImpresora);
    return causaDeError(error);
  }
  throw new Error("Se esperaba un rechazo.");
}

describe("Estado de la impresora (DLE EOT) → causa para el cajero", () => {
  it("DLE EOT n son los tres bytes 10 04 n", () => {
    expect(comandoConsultaEstado(1)).toEqual([0x10, 0x04, 0x01]);
    expect(comandoConsultaEstado(4)).toEqual([0x10, 0x04, 0x04]);
  });

  it("cada estado típico se traduce a su causa; lista, a ninguna", () => {
    expect(causaSegunEstado(RESPUESTAS_TIPICAS.lista)).toBeNull();
    expect(causaSegunEstado(RESPUESTAS_TIPICAS.sinPapel)).toBe("PRINTER_OUT_OF_PAPER");
    expect(causaSegunEstado(RESPUESTAS_TIPICAS.tapaAbierta)).toBe("PRINTER_COVER_OPEN");
    expect(causaSegunEstado(RESPUESTAS_TIPICAS.sobrecalentada)).toBe("PRINTER_OVERHEATED");
    expect(causaSegunEstado(RESPUESTAS_TIPICAS.cuchillaTrabada)).toBe("PRINTER_ERROR");
  });

  it("papel: basta el sensor del rollo o la impresión detenida por falta de papel; 'por acabarse' no detiene", () => {
    expect(causaSegunEstado([0x12, 0x12, 0x12, 0x32])).toBe("PRINTER_OUT_OF_PAPER"); // solo el bit 5 del rollo
    expect(causaSegunEstado([0x12, 0x32, 0x12, 0x12])).toBe("PRINTER_OUT_OF_PAPER"); // detenida por fin de papel
    expect(causaSegunEstado([0x12, 0x12, 0x12, 0x1e])).toBeNull(); // bits 2 y 3: papel por acabarse
  });

  it("con la tapa abierta y sin papel a la vez, primero la tapa (hay que abrirla para cambiar el rollo)", () => {
    expect(causaSegunEstado([0x1a, 0x36, 0x12, 0x72])).toBe("PRINTER_COVER_OPEN");
  });

  it("fuera de línea sin causa conocida, o una respuesta que no es de DLE EOT: error general", () => {
    expect(causaSegunEstado([0x1a, 0x12, 0x12, 0x12])).toBe("PRINTER_ERROR");
    expect(esRespuestaEstadoValida(0x12)).toBe(true);
    expect(esRespuestaEstadoValida(0x41)).toBe(false);
    expect(causaSegunEstado([0x41, 0x12, 0x12, 0x12])).toBe("PRINTER_ERROR");
  });

  it("cola de Windows: lo que informe el controlador", () => {
    const base = { sinConexion: false, estadoImpresora: 3, errorDetectado: 2 };
    expect(causaSegunColaWindows(base)).toBeNull();
    expect(causaSegunColaWindows({ ...base, estadoImpresora: null, errorDetectado: null })).toBeNull();
    expect(causaSegunColaWindows({ ...base, sinConexion: true })).toBe("PRINTER_DISCONNECTED");
    expect(causaSegunColaWindows({ ...base, estadoImpresora: 7 })).toBe("PRINTER_DISCONNECTED");
    expect(causaSegunColaWindows({ ...base, errorDetectado: 4 })).toBe("PRINTER_OUT_OF_PAPER");
    expect(causaSegunColaWindows({ ...base, errorDetectado: 7 })).toBe("PRINTER_COVER_OPEN");
    expect(causaSegunColaWindows({ ...base, errorDetectado: 8 })).toBe("PRINTER_ERROR");
  });

  it("un error que no es de la impresora (del sistema, del puerto) cuenta como sin conexión", () => {
    expect(causaDeError(new Error("EBUSY"))).toBe("PRINTER_DISCONNECTED");
    expect(causaDeError(new FallaImpresora("PRINTER_COVER_OPEN", "tapa"))).toBe("PRINTER_COVER_OPEN");
  });
});

describe("IMPRESORA_DISPOSITIVO", () => {
  it("puerto COM, USB directa, cola de Windows o ruta", () => {
    expect(leerDestinoImpresora(undefined)).toBeNull();
    expect(leerDestinoImpresora("  ")).toBeNull();
    expect(leerDestinoImpresora("COM5")).toEqual({ tipo: "puerto", puerto: "COM5" });
    expect(leerDestinoImpresora("com12")).toEqual({ tipo: "puerto", puerto: "COM12" });
    expect(leerDestinoImpresora("\\\\.\\COM12")).toEqual({ tipo: "puerto", puerto: "COM12" });
    expect(leerDestinoImpresora("usb")).toEqual({ tipo: "usb", filtro: null });
    expect(leerDestinoImpresora("USB:VID_0483&PID_5743")).toEqual({ tipo: "usb", filtro: "VID_0483&PID_5743" });
    expect(leerDestinoImpresora("windows:POS-80 RED-E803")).toEqual({ tipo: "cola", nombre: "POS-80 RED-E803" });
    expect(leerDestinoImpresora("/dev/usb/lp0")).toEqual({ tipo: "archivo", ruta: "/dev/usb/lp0" });
  });

  it("'USB001' es un puerto de la cola de Windows, no una ruta: se rechaza con la alternativa", () => {
    expect(() => leerDestinoImpresora("USB001")).toThrow(/windows:<nombre de la impresora>/);
  });

  it("COM, usb y windows: solo en Windows; una ruta, en cualquier sistema", () => {
    expect(() => transporteDesdeDestino({ tipo: "puerto", puerto: "COM5" }, "linux")).toThrow(/solo se puede usar en Windows/);
    expect(transporteDesdeDestino({ tipo: "archivo", ruta: "/dev/usb/lp0" }, "linux").descripcion).toBe("archivo /dev/usb/lp0");
  });
});

describe("Reintentos de conexión", () => {
  it("sin conexión: 3 intentos, esperando 2 y 5 s entre ellos", async () => {
    const esperas: number[] = [];
    let intentos = 0;
    const r = conReintentos(
      async () => {
        intentos++;
        throw new FallaImpresora("PRINTER_DISCONNECTED", "no hay puerto");
      },
      undefined,
      async (ms) => esperas.push(ms),
    );
    expect(await causaDelRechazo(r)).toBe("PRINTER_DISCONNECTED");
    expect(intentos).toBe(3);
    expect(esperas).toEqual([2_000, 5_000]);
  });

  it("si vuelve la conexión, sigue; un problema que informa la impresora no se reintenta", async () => {
    let intentos = 0;
    const bien = await conReintentos(
      async () => {
        if (++intentos < 2) throw new Error("puerto ocupado");
        return "impreso";
      },
      undefined,
      async () => undefined,
    );
    expect([bien, intentos]).toEqual(["impreso", 2]);

    intentos = 0;
    const sinPapel = conReintentos(
      async () => {
        intentos++;
        throw new FallaImpresora("PRINTER_OUT_OF_PAPER", "sin papel");
      },
      undefined,
      async () => undefined,
    );
    expect(await causaDelRechazo(sinPapel)).toBe("PRINTER_OUT_OF_PAPER");
    expect(intentos).toBe(1);
  });
});

describe("Transporte con estado sobre una impresora simulada (salida a archivo)", () => {
  it("lista: revisa el estado y escribe los bytes; comprobar no escribe nada", async () => {
    const archivo = nuevoArchivo();
    const t = transporteConEstado("simulada", () => conexionSimulada(archivo, () => RESPUESTAS_TIPICAS.lista));
    await t.comprobar();
    expect(existsSync(archivo)).toBe(false);
    await t.enviar(Uint8Array.from([0x1b, 0x40, 0x41, 0x0a]));
    expect(readFileSync(archivo).toString("hex")).toBe("1b40410a");
  });

  it.each([
    [RESPUESTAS_TIPICAS.sinPapel, "PRINTER_OUT_OF_PAPER"],
    [RESPUESTAS_TIPICAS.tapaAbierta, "PRINTER_COVER_OPEN"],
    [RESPUESTAS_TIPICAS.sobrecalentada, "PRINTER_OVERHEATED"],
    ["SIN_CONEXION", "PRINTER_DISCONNECTED"],
  ] as const)("con %j no escribe nada y rechaza con %s", async (estado, causa) => {
    const archivo = nuevoArchivo();
    const t = transporteConEstado("simulada", () => conexionSimulada(archivo, () => estado));
    expect(await causaDelRechazo(t.enviar(Uint8Array.from([0x41])))).toBe(causa);
    expect(await causaDelRechazo(t.comprobar())).toBe(causa);
    expect(existsSync(archivo)).toBe(false);
  });
});

describe("Conversación con el ayudante de Windows (simulado con un proceso de Node)", () => {
  const plazos = { abrir: 5_000, enviar: 5_000 };
  const ayudante = (modo: string, apertura: object, archivo: string) =>
    transporteConEstado("ayudante simulado", () =>
      conexionAyudante({ comando: process.execPath, argumentos: [AYUDANTE_SIMULADO, modo, JSON.stringify(apertura), archivo] }, plazos),
    );
  const abierto = (informe: InformeApertura) => ({ evento: "abierto", ...informe });

  it("abre, informa el estado, recibe los bytes en base64 y los escribe tal cual", async () => {
    const archivo = nuevoArchivo();
    const bytes = Uint8Array.from({ length: 6000 }, (_, i) => i % 256); // del tamaño de un comprobante con logotipo
    await ayudante("normal", abierto({ tipo: "puerto", estado: [...RESPUESTAS_TIPICAS.lista] }), archivo).enviar(bytes);
    expect(Buffer.compare(readFileSync(archivo), Buffer.from(bytes))).toBe(0);
  });

  it("sin papel, informado por el ayudante: cancela sin enviar", async () => {
    const archivo = nuevoArchivo();
    const t = ayudante("normal", abierto({ tipo: "puerto", estado: [...RESPUESTAS_TIPICAS.sinPapel] }), archivo);
    expect(await causaDelRechazo(t.enviar(Uint8Array.from([0x41])))).toBe("PRINTER_OUT_OF_PAPER");
    expect(existsSync(archivo)).toBe(false);
  });

  it("cola de Windows fuera de línea: sin conexión", async () => {
    const t = ayudante("normal", abierto({ tipo: "cola", sinConexion: false, estadoImpresora: 7, errorDetectado: 9 }), nuevoArchivo());
    expect(await causaDelRechazo(t.comprobar())).toBe("PRINTER_DISCONNECTED");
  });

  it("el ayudante no puede abrir el dispositivo, termina sin responder o falla al enviar: sin conexión, con el motivo", async () => {
    const noAbre = ayudante("normal", { evento: "error", mensaje: "El puerto 'COM7' no existe." }, nuevoArchivo());
    await expect(noAbre.enviar(Uint8Array.from([0x41]))).rejects.toThrow(/COM7' no existe/);
    expect(await causaDelRechazo(ayudante("muere", {}, nuevoArchivo()).comprobar())).toBe("PRINTER_DISCONNECTED");
    const falla = ayudante("falla-envio", abierto({ tipo: "puerto", estado: null }), nuevoArchivo());
    await expect(falla.enviar(Uint8Array.from([0x41]))).rejects.toThrow(/no recibió los datos/);
  });

  it("un dispositivo que no responde no deja el servidor esperando: se corta al vencer el plazo", async () => {
    const t = transporteConEstado("colgado", () =>
      conexionAyudante({ comando: process.execPath, argumentos: [AYUDANTE_SIMULADO, "mudo", "{}", nuevoArchivo()] }, { abrir: 300, enviar: 300 }),
    );
    const inicio = Date.now();
    await expect(t.enviar(Uint8Array.from([0x41]))).rejects.toThrow(/no respondió en 0.3 s/);
    expect(Date.now() - inicio).toBeLessThan(3_000);
  });
});

// Con el ayudante real (PowerShell), solo con dispositivos que no existen: nunca abre un puerto de verdad.
describe.runIf(process.platform === "win32")("Ayudante de Windows real, con dispositivos que no existen", () => {
  const real = (argumentos: string[]) =>
    transporteConEstado("real", () => conexionAyudante(lanzadorPowerShell(["-Accion", "enviar", ...argumentos])));

  it("un puerto COM que no existe: sin conexión, con el mensaje de Windows", async () => {
    const t = real(["-Tipo", "puerto", "-Valor", "COM219"]);
    await expect(t.comprobar()).rejects.toThrow(/COM219/);
    expect(await causaDelRechazo(t.comprobar())).toBe("PRINTER_DISCONNECTED");
  });

  it("una impresora de Windows que no existe: sin conexión", async () => {
    const t = real(["-Tipo", "cola", "-Valor", "Impresora que no existe (prueba)"]);
    await expect(t.enviar(Uint8Array.from([0x41]))).rejects.toThrow(/No existe la impresora de Windows/);
  });
});
