import type { HoraAdicional, Ticket } from "@apurimeno/contracts";
import { describe, expect, it } from "vitest";
import {
  anularTicket,
  armarTicketCobro,
  cotizarHoraAdicional,
  cotizarIngreso,
  cotizarVenta,
  diaLocal,
  pagoSinVuelto,
  resumirArqueos,
  resumirOcupacion,
  resumirVentas,
  type Cotizacion,
} from "../src/index.js";
import { EFECTIVO, PARAMETROS, YAPE, alquiler, contexto, en, habitacion, producto, turnoAbierto, turnoCerrado } from "./fixtures.js";

function cobro(
  origen: Ticket["origen"],
  cotizacion: Cotizacion,
  metodo: string,
  ahora: string,
  extra: { alquilerId?: string | null; turnoId?: string; numero?: number } = {},
): Ticket {
  return armarTicketCobro(
    {
      numero: extra.numero ?? 1,
      origen,
      turno: turnoAbierto({ id: extra.turnoId ?? "turno-1" }),
      alquilerId: origen === "VENTA_TIENDA" ? null : (extra.alquilerId ?? "alq-1"),
      habitacionReferenciaId: null,
      cotizacion,
      pagos: [pagoSinVuelto(metodo, cotizacion.total, null)],
      creadoPorId: "cajero-1",
    },
    contexto(ahora),
  );
}

const ingreso = (precioBase = 3000) =>
  cotizarIngreso({ habitacion: habitacion({ precioBase }), clienteId: null, preciosEspeciales: [], parametros: PARAMETROS, horasAdicionalesAlIngreso: 0 });

describe("Días del negocio en hora de Lima", () => {
  it("las 03:00 UTC del 24 son todavía el 23 en Lima (UTC−5)", () => {
    expect(diaLocal("2026-09-24T03:00:00.000Z")).toBe("2026-09-23");
    expect(diaLocal("2026-09-24T05:00:00.000Z")).toBe("2026-09-24");
  });
});

describe("RF-47 · reporte de ventas", () => {
  const t1 = cobro("INGRESO_ALQUILER", ingreso(3000), EFECTIVO.id, en("14:00"));
  const t2 = cobro("HORA_ADICIONAL", cotizarHoraAdicional(alquiler()), YAPE.id, en("23:00"), { turnoId: "turno-2" });
  const t3 = cobro("VENTA_TIENDA", cotizarVenta([{ producto: producto(), cantidad: 2 }], false), EFECTIVO.id, en("04:00", 24));

  it("totaliza por origen, método, día de Lima, turno y producto, y todos cuadran con el total", () => {
    const r = resumirVentas([t1, t2, t3]);
    expect(r.total).toBe(3000 + 800 + 700);
    expect(r.cantidadTickets).toBe(3);
    expect(r.porOrigen).toEqual([
      { origen: "INGRESO_ALQUILER", total: 3000 },
      { origen: "HORA_ADICIONAL", total: 800 },
      { origen: "VENTA_TIENDA", total: 700 },
    ]);
    expect(r.porMetodoPago).toEqual([
      { metodoPagoId: EFECTIVO.id, total: 3700 },
      { metodoPagoId: YAPE.id, total: 800 },
    ]);
    // Las 04:00 UTC del 24 siguen siendo el 23 en Lima: todo cae en el mismo día.
    expect(r.porDia).toEqual([{ dia: "2026-09-23", total: 4500 }]);
    expect(r.porTurno.reduce((s, x) => s + x.total, 0)).toBe(r.total);
    expect(r.porProducto).toEqual([{ productoId: "prod-gaseosa", descripcion: "Gaseosa", cantidad: 2, total: 700 }]);
  });

  it("un ticket anulado y su compensatorio no cuentan (solo tickets vigentes)", () => {
    const { original, compensatorio } = anularTicket(
      { ticket: t1, motivo: "error", numero: 9, turno: turnoAbierto(), usuario: { id: "admin-1", permisos: ["tickets.void"] }, autorizacion: null },
      contexto(en("14:05")),
    );
    const r = resumirVentas([original, compensatorio, t2]);
    expect(r).toMatchObject({ total: 800, cantidadTickets: 1 });
    expect(r.porOrigen).toEqual([{ origen: "HORA_ADICIONAL", total: 800 }]);
  });

  it("sin tickets, todo en cero", () => {
    expect(resumirVentas([])).toEqual({ total: 0, cantidadTickets: 0, porOrigen: [], porMetodoPago: [], porDia: [], porTurno: [], porProducto: [] });
  });
});

describe("§25 · reporte de arqueos", () => {
  it("solo turnos cerrados, con la suma de diferencias", () => {
    const faltante = { ...turnoCerrado, id: "t-a", efectivoContado: 9500, diferencia: -500, comentarioCierre: "faltó" };
    const cuadrado = { ...turnoCerrado, id: "t-b", cerradoEn: en("21:00") };
    const forzado = { ...turnoCerrado, id: "t-c", cierreForzado: true, cerradoPorId: "admin-1", efectivoContado: null, diferencia: null, cerradoEn: en("22:00") };
    const r = resumirArqueos([turnoAbierto({ id: "t-abierto" }), cuadrado, faltante, forzado]);
    expect(r.turnos.map((t) => t.id)).toEqual(["t-a", "t-b", "t-c"]);
    expect(r).toMatchObject({ diferenciaTotal: -500, turnosConDiferencia: 1 });
  });
});

describe("RF-48 · reporte de ocupación", () => {
  it("cuenta horas base + horas al ingreso + horas adicionales vigentes, e ingresos vigentes", () => {
    const a1 = alquiler({ id: "a1", habitacionId: "hab-205", horasAdicionalesAlIngreso: 2, salidaProgramadaEn: en("00:00", 24) });
    const a2 = alquiler({ id: "a2", habitacionId: "hab-205" });
    const anulado = alquiler({ id: "a3", habitacionId: "hab-101", estado: "ANULADO" });
    const ticketA1 = cobro("INGRESO_ALQUILER", ingreso(4000), EFECTIVO.id, en("14:00"), { alquilerId: "a1" });
    const horaA2 = cobro("HORA_ADICIONAL", cotizarHoraAdicional(a2), EFECTIVO.id, en("21:00"), { alquilerId: "a2" });
    const horaAnulada = anularTicket(
      { ticket: cobro("HORA_ADICIONAL", cotizarHoraAdicional(a2), EFECTIVO.id, en("21:30"), { alquilerId: "a2" }), motivo: "error", numero: 7, turno: turnoAbierto(), usuario: { id: "admin-1", permisos: ["tickets.void"] }, autorizacion: null },
      contexto(en("21:31")),
    ).original;
    const horas: HoraAdicional[] = [horaA2, horaAnulada].map((t, i) => ({
      id: `h${i}`,
      alquilerId: "a2",
      ticketId: t.id,
      tipo: "EXTENSION_ANTICIPADA",
      salidaAnterior: en("22:00"),
      salidaNueva: en("23:00"),
      creadoPorId: "cajero-1",
      creadoEn: t.creadoEn,
    }));

    const r = resumirOcupacion(
      [habitacion({ id: "hab-205", numero: "205" }), habitacion({ id: "hab-101", numero: "101" })],
      [a1, a2, anulado],
      horas,
      [ticketA1, horaA2, horaAnulada],
    );
    expect(r.habitaciones).toEqual([
      { habitacionId: "hab-101", numero: "101", alquileres: 0, horasVendidas: 0, ingresos: 0 },
      // a1: 8 + 2 = 10 h; a2: 8 + 1 vigente = 9 h (la anulada no cuenta).
      // Ingresos: ticket de a1 (S/ 40.00) + hora vigente de a2 (S/ 8.00); la hora anulada no suma.
      { habitacionId: "hab-205", numero: "205", alquileres: 2, horasVendidas: 19, ingresos: 4000 + 800 },
    ]);
  });
});
