import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registroRotativo, rutaAnterior } from "../src/registro.js";

// El registro del servicio rota por tamaño dentro del servidor, sin depender de que NSSM lo relance.

let carpeta: string;
let ruta: string;
beforeEach(() => {
  carpeta = mkdtempSync(join(tmpdir(), "apurimeno-registro-"));
  ruta = join(carpeta, "logs", "servidor.log");
});
afterEach(() => rmSync(carpeta, { recursive: true, force: true }));

const linea = (n: number) => `${JSON.stringify({ n, msg: "x".repeat(80) })}\n`; // 100 bytes o poco más

describe("registroRotativo", () => {
  it("rota al pasar el tamaño y conserva solo los anteriores configurados, en orden", () => {
    const registro = registroRotativo(ruta, { maxBytes: 1000, anteriores: 3 });
    for (let n = 0; n < 100; n++) registro.write(linea(n));

    for (const archivo of [ruta, rutaAnterior(ruta, 1), rutaAnterior(ruta, 2), rutaAnterior(ruta, 3)]) {
      expect(statSync(archivo).size).toBeLessThanOrEqual(1000);
    }
    expect(existsSync(rutaAnterior(ruta, 4))).toBe(false);
    // Lo más nuevo está en servidor.log y cada anterior continúa donde termina el siguiente, sin perder líneas.
    const numeros = [rutaAnterior(ruta, 3), rutaAnterior(ruta, 2), rutaAnterior(ruta, 1), ruta].flatMap((a) =>
      readFileSync(a, "utf8").trim().split("\n").map((l) => (JSON.parse(l) as { n: number }).n),
    );
    expect(numeros.at(-1)).toBe(99);
    expect(numeros).toEqual(Array.from({ length: numeros.length }, (_, i) => 100 - numeros.length + i));
  });

  it("continúa el archivo que ya existía y lo rota cuando se llena", () => {
    registroRotativo(ruta, { maxBytes: 1000 }).write(linea(0));
    const registro = registroRotativo(ruta, { maxBytes: 1000 });
    registro.write(linea(1));
    expect(readFileSync(ruta, "utf8").trim().split("\n")).toHaveLength(2);
    for (let n = 2; n < 12; n++) registro.write(linea(n));
    expect(existsSync(rutaAnterior(ruta, 1))).toBe(true);
    expect(rutaAnterior(ruta, 1)).toBe(join(carpeta, "logs", "servidor.1.log"));
  });

  it("si no puede rotar, sigue escribiendo en el mismo archivo y reintenta pasado un minuto", () => {
    let reloj = 0;
    const registro = registroRotativo(ruta, { maxBytes: 300, anteriores: 1, ahora: () => reloj });
    // Una carpeta no vacía donde iría servidor.1.log impide rotar (como un archivo abierto por otro programa).
    const bloqueo = rutaAnterior(ruta, 1);
    mkdirSync(join(bloqueo, "ocupado"), { recursive: true });

    for (let n = 0; n < 6; n++) registro.write(linea(n));
    expect(readFileSync(ruta, "utf8").trim().split("\n")).toHaveLength(6);

    rmSync(bloqueo, { recursive: true });
    reloj = 61_000;
    registro.write(linea(6));
    expect(readFileSync(ruta, "utf8").trim().split("\n")).toHaveLength(1);
    expect(readFileSync(bloqueo, "utf8").trim().split("\n")).toHaveLength(6);
  });
});
