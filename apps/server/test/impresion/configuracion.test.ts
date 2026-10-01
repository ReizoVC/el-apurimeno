import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configurarImpresion } from "../../src/impresion/configuracion.js";
import { escribirPng, imagenVacia } from "../../src/impresion/imagen.js";

// Un error en IMPRESORA_DISPOSITIVO o IMPRESORA_LOGO no detiene el servidor, pero queda a la vista (decisión 26).
describe("Configuración de la impresora y del logotipo al arrancar", () => {
  const dir = mkdtempSync(join(tmpdir(), "configuracion-impresion-"));

  it("bien configurada: transporte y logotipo, sin problemas", () => {
    const c = configurarImpresion(join(dir, "salida.bin"), undefined, "win32");
    expect(c.transporte?.descripcion).toBe(`archivo ${join(dir, "salida.bin")}`);
    expect([c.logo?.ancho, c.logo?.alto]).toEqual([224, 195]);
    expect([c.problemaConfiguracion, c.problemaLogo]).toEqual([null, null]);
  });

  it("sin IMPRESORA_DISPOSITIVO no es un problema: los comprobantes quedan en cola, como siempre", () => {
    const c = configurarImpresion("", "no", "win32");
    expect([c.transporte, c.logo, c.problemaConfiguracion, c.problemaLogo]).toEqual([null, null, null, null]);
  });

  it("un dispositivo inválido deja el servidor sin impresora, con el motivo", () => {
    const usb001 = configurarImpresion("USB001", undefined, "win32");
    expect(usb001.transporte).toBeNull();
    expect(usb001.problemaConfiguracion).toMatch(/USB001.*cola de Windows/);
    // El logotipo no depende de la impresora.
    expect(usb001.logo).not.toBeNull();

    const comEnLinux = configurarImpresion("COM5", undefined, "linux");
    expect(comEnLinux.problemaConfiguracion).toBe("IMPRESORA_DISPOSITIVO: puerto COM5 solo se puede usar en Windows.");
  });

  it("un logotipo que falta, no es PNG o no cabe: sin logotipo, con un motivo que entiende quien instala", () => {
    expect(configurarImpresion("", join(dir, "no-existe.png"), "win32").problemaLogo).toBe(
      `No existe el archivo del logotipo: ${join(dir, "no-existe.png")}.`,
    );
    writeFileSync(join(dir, "texto.png"), "no es una imagen");
    expect(configurarImpresion("", join(dir, "texto.png"), "win32").problemaLogo).toMatch(/no se puede usar: No es un archivo PNG/);
    writeFileSync(join(dir, "ancho.png"), escribirPng(imagenVacia(600, 1)));
    const ancho = configurarImpresion(join(dir, "salida.bin"), join(dir, "ancho.png"), "win32");
    expect(ancho.problemaLogo).toMatch(/600 puntos de ancho; en papel de 80 mm caben 576/);
    // La impresora sigue funcionando, solo sin logotipo.
    expect([ancho.transporte === null, ancho.logo, ancho.problemaConfiguracion]).toEqual([false, null, null]);
  });
});
