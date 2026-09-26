import {
  PATRONES_FISCALES_PROHIBIDOS,
  type DatosComprobante,
} from "@apurimeno/contracts";
import { describe, expect, it } from "vitest";
import {
  anularTicket,
  armarTicketCobro,
  componerComprobante,
  componerLineasComprobante,
  cotizarVenta,
  pagoEnEfectivo,
  pagoSinVuelto,
} from "../src/index.js";
import {
  EFECTIVO,
  YAPE,
  contexto,
  en,
  producto,
  turnoAbierto,
} from "./fixtures.js";

const datos: DatosComprobante = {
  nombreNegocio: "El Apurimeño",
  datosAdicionales: "Av. Siempre Viva 123",
  leyenda: "Documento interno sin valor tributario.",
};
const opciones = {
  datos,
  anchoPapelMm: 80 as const,
  metodosPago: [EFECTIVO, YAPE],
  esCopia: false,
};

function venta() {
  return armarTicketCobro(
    {
      numero: 123,
      origen: "VENTA_TIENDA",
      turno: turnoAbierto(),
      alquilerId: null,
      habitacionReferenciaId: null,
      cotizacion: cotizarVenta([{ producto: producto(), cantidad: 2 }], false),
      pagos: [pagoEnEfectivo(EFECTIVO.id, 700, 1000)],
      creadoPorId: "cajero-1",
    },
    contexto(en("14:05")),
  );
}

describe("Comprobante impreso (RN-38, RN-39, RF-44, RF-55)", () => {
  it("80 mm: 48 columnas, con negocio, número interno, fecha en Lima, líneas, total, pago y vuelto", () => {
    const texto = componerComprobante(venta(), opciones);
    expect(texto.every((l) => l.length <= 48)).toBe(true);
    expect(texto).toMatchInlineSnapshot(`
      [
        "                  El Apurimeño",
        "              Av. Siempre Viva 123",
        "------------------------------------------------",
        "Ticket 123                     23/09/2026, 09:05",
        "------------------------------------------------",
        "Gaseosa                                  S/ 7.00",
        "  2 x S/ 3.50",
        "------------------------------------------------",
        "TOTAL                                    S/ 7.00",
        "Efectivo                                 S/ 7.00",
        "  Recibido                              S/ 10.00",
        "  Vuelto                                 S/ 3.00",
        "------------------------------------------------",
        "    Documento interno sin valor tributario.",
      ]
    `);
  });

  it("la reimpresión dice COPIA de forma visible (RF-44)", () => {
    const texto = componerComprobante(venta(), { ...opciones, esCopia: true });
    expect(texto).toContain("                 *** COPIA ***");
    expect(componerComprobante(venta(), opciones).join("\n")).not.toContain(
      "COPIA",
    );
  });

  it("siempre termina con la leyenda configurada y no usa términos ni series fiscales (RN-39)", () => {
    const sinDatos = componerComprobante(venta(), {
      ...opciones,
      datos: { ...datos, datosAdicionales: null },
    });
    expect(sinDatos.at(-1)?.trim()).toBe("Documento interno sin valor tributario.");
    const reformulada = componerComprobante(venta(), {
      ...opciones,
      datos: { ...datos, leyenda: "Comprobante interno, no válido como documento tributario." },
    });
    expect(reformulada.slice(-2).map((l) => l.trim())).toEqual(["Comprobante interno, no válido como documento", "tributario."]);
    const texto = sinDatos.join("\n");
    expect(PATRONES_FISCALES_PROHIBIDOS.some((p) => p.test(texto))).toBe(false);
  });

  it("58 mm: 32 columnas; los textos largos se parten sin pasarse del ancho", () => {
    const largo = {
      nombreNegocio: "Hospedaje El Apurimeño de la Avenida Principal",
      datosAdicionales: null,
      leyenda: datos.leyenda,
    };
    const texto = componerComprobante(venta(), {
      ...opciones,
      datos: largo,
      anchoPapelMm: 58,
    });
    expect(texto.every((l) => l.length <= 32)).toBe(true);
    expect(texto.slice(0, 2).map((l) => l.trim())).toEqual([
      "Hospedaje El Apurimeño de la",
      "Avenida Principal",
    ]);
  });

  it("un ticket anulado y su compensatorio lo indican; el número de operación sale, el cliente nunca (RN-38)", () => {
    const conYape = armarTicketCobro(
      {
        numero: 124,
        origen: "VENTA_TIENDA",
        turno: turnoAbierto(),
        alquilerId: null,
        habitacionReferenciaId: null,
        cotizacion: cotizarVenta(
          [{ producto: producto(), cantidad: 1 }],
          false,
        ),
        pagos: [pagoSinVuelto(YAPE.id, 350, "0001")],
        creadoPorId: "cajero-1",
      },
      contexto(en("14:10")),
    );
    const { original, compensatorio } = anularTicket(
      {
        ticket: conYape,
        numero: 125,
        turno: turnoAbierto(),
        motivo: "error",
        usuario: { id: "admin", permisos: ["tickets.void"] },
        autorizacion: null,
      },
      contexto(en("14:20")),
    );
    expect(componerComprobante(original, opciones)).toContain(
      "                *** ANULADO ***",
    );
    const devolucion = componerComprobante(compensatorio, opciones);
    expect(devolucion).toContain("         ANULACIÓN DE UN COBRO ANTERIOR");
    expect(
      devolucion.some((l) => l.endsWith("-S/ 3.50") && l.startsWith("TOTAL")),
    ).toBe(true);
    expect(componerComprobante(conYape, opciones)).toContain("  Op. 0001");
  });

  it("estilos para la impresora: negocio y total en negrita, COPIA y ANULADO en grande; el resto normal", () => {
    const lineas = componerLineasComprobante(venta(), {
      ...opciones,
      esCopia: true,
    });
    const destacadas = lineas
      .filter((l) => l.estilo !== "normal")
      .map((l) => [l.texto.trim(), l.estilo]);
    expect(destacadas).toEqual([
      ["El Apurimeño", "negrita"],
      ["*** COPIA ***", "grande"],
      ["TOTAL                                    S/ 7.00", "negrita"],
    ]);
  });
});
