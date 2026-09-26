import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMANDO, codificarTexto, comandosComprobante } from "../../src/impresion/escpos.js";
import { casos, type CasoComprobante } from "./casos.js";

const aqui = (archivo: string) => new URL(`./${archivo}`, import.meta.url);

/** Lee un .hex de generar_esperados.py: bytes en hexadecimal, un comando o una línea impresa por renglón. */
function leerHex(nombre: string): Uint8Array {
  const hex = readFileSync(aqui(`${nombre}.hex`), "utf8")
    .split("\n")
    .map((renglon) => renglon.split("#")[0] ?? "")
    .join(" ")
    .trim()
    .split(/\s+/);
  return Uint8Array.from(hex.map((b) => Number.parseInt(b, 16)));
}

const hex = (bytes: Iterable<number>) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");

describe("Comprobante ESC/POS byte a byte (Planos ADR-05, §13)", () => {
  const esperados = JSON.parse(readFileSync(aqui("casos.json"), "utf8")) as CasoComprobante[];

  it("las líneas de cada caso son las que se usaron para generar los .hex", () => {
    expect(casos()).toEqual(esperados);
  });

  it.each(casos().map((c) => [c.nombre, c] as const))("%s coincide con el .hex generado aparte", (nombre, caso) => {
    const generado = comandosComprobante(caso.lineas, { paginaCodigos: caso.paginaCodigos, lineasAntesDelCorte: 4 });
    // Se compara como texto hexadecimal para que un fallo muestre en qué byte difiere.
    expect(hex(generado)).toBe(hex(leerHex(nombre)));
  });

  it("cada línea impresa cabe en el ancho del papel: 48 columnas en 80 mm y 32 en 58 mm", () => {
    for (const caso of casos()) {
      const columnas = caso.nombre.includes("58mm") ? 32 : 48;
      for (const { texto } of caso.lineas) expect(codificarTexto(texto, caso.paginaCodigos).length).toBeLessThanOrEqual(columnas);
    }
  });

  it("empieza reiniciando y eligiendo la página de códigos; termina avanzando y cortando", () => {
    const bytes = [...comandosComprobante([{ texto: "Hola", estilo: "normal" }])];
    expect(hex(bytes.slice(0, 5))).toBe("1b 40 1b 74 02");
    expect(hex(bytes.slice(-6))).toBe(hex([...COMANDO.avanzarLineas(4), ...COMANDO.cortarParcial]));
  });
});

describe("Codificación de texto para la impresora", () => {
  it("tildes, ñ y signos del español en PC850 y en WPC1252", () => {
    expect(hex(codificarTexto("áéíóú ÁÉÍÓÚ ñÑ üÜ ¿¡ °", "PC850"))).toBe(
      "a0 82 a1 a2 a3 20 b5 90 d6 e0 e9 20 a4 a5 20 81 9a 20 a8 ad 20 f8",
    );
    expect(hex(codificarTexto("áéíóú ÁÉÍÓÚ ñÑ üÜ ¿¡ °", "WPC1252"))).toBe(
      "e1 e9 ed f3 fa 20 c1 c9 cd d3 da 20 f1 d1 20 fc dc 20 bf a1 20 b0",
    );
  });

  it("signos tipográficos → su versión ASCII; € solo existe en WPC1252", () => {
    expect(String.fromCharCode(...codificarTexto("Habitación 205 — 8 horas", "PC850"))).toBe("Habitaci\xa2n 205 - 8 horas");
    expect(String.fromCharCode(...codificarTexto("“Menú” …", "PC850"))).toBe('"Men\xa3" ...');
    expect(hex(codificarTexto("€", "PC850"))).toBe("45 55 52");
    expect(hex(codificarTexto("€", "WPC1252"))).toBe("80");
  });

  it("otra letra con acento pierde el acento; lo que no tiene equivalente sale como '?'", () => {
    expect(String.fromCharCode(...codificarTexto("Façade Ångström", "PC850"))).toBe("Facade Angstrom");
    expect(String.fromCharCode(...codificarTexto("té 中 🙂", "PC850"))).toBe("t\x82 ? ?");
  });

  it("descarta caracteres de control: un nombre de producto no puede colar comandos a la impresora", () => {
    // ESC @, GS V (corte) y un salto de línea dentro de un nombre: se imprimen solo las letras.
    expect(String.fromCharCode(...codificarTexto("Agua\x1b@\x1dV\x01 fría\n", "PC850"))).toBe("Agua@V fr\xa1a");
    expect(codificarTexto("\x1b\x1d\x10\x7f\x9b", "PC850")).toEqual([]);
  });
});
