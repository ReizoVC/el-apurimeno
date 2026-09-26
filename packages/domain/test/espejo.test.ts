import { ResumenDiaSchema, type ResumenDia, desdeFilaResumenDia, desdeFilaResumenTurno, aFilaResumenDia, aFilaResumenTurno, type Ticket } from "@apurimeno/contracts";
import { describe, expect, it } from "vitest";
import {
  anularTicket,
  armarTicketCobro,
  cotizarHoraAdicional,
  cotizarIngreso,
  cotizarVenta,
  pagoSinVuelto,
  periodoDelDia,
  resumirDia,
  estaDesactualizado,
  resumirArqueosEspejo,
  resumirTurno,
  sumarResumenesDia,
  type Cotizacion,
} from "../src/index.js";
import { EFECTIVO, PARAMETROS, YAPE, alquiler, contexto, en, habitacion, producto, turnoAbierto, turnoCerrado } from "./fixtures.js";

function cobro(origen: Ticket["origen"], cotizacion: Cotizacion, metodo: string, ahora: string, extra: { alquilerId?: string; turnoId?: string } = {}): Ticket {
  return armarTicketCobro(
    {
      numero: 1,
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

const anular = (ticket: Ticket, ahora: string) =>
  anularTicket(
    { ticket, motivo: "error", numero: 9, turno: turnoAbierto(), usuario: { id: "admin-1", permisos: ["tickets.void"] }, autorizacion: null },
    contexto(ahora),
  );

describe("Días de Lima para el espejo", () => {
  it("un día de Lima va de las 05:00 UTC a las 05:00 UTC del día siguiente", () => {
    expect(periodoDelDia("2026-09-23")).toEqual({ desde: "2026-09-23T05:00:00.000Z", hasta: "2026-09-24T05:00:00.000Z" });
  });

  it("rechaza un día mal escrito", () => {
    expect(() => periodoDelDia("2026-13-40")).toThrow(RangeError);
  });
});

describe("Resumen de un día (RN-45, RF-60)", () => {
  const habitaciones = [habitacion({ id: "hab-205", numero: "205" }), habitacion({ id: "hab-101", numero: "101" })];
  const a1 = alquiler({ id: "a1", habitacionId: "hab-205" });
  const ingresoA1 = cobro("INGRESO_ALQUILER", ingreso(3000), EFECTIVO.id, en("14:00"), { alquilerId: "a1" });
  // La hora adicional se cobra al día siguiente (00:30 del 24 en Lima): cuenta en la ocupación del día del ingreso.
  const horaA1 = cobro("HORA_ADICIONAL", cotizarHoraAdicional(a1), YAPE.id, en("05:30", 24), { alquilerId: "a1" });
  const venta = cobro("VENTA_TIENDA", cotizarVenta([{ producto: producto(), cantidad: 2 }], false), EFECTIVO.id, en("16:00"));
  const vendidaYAnulada = cobro("VENTA_TIENDA", cotizarVenta([{ producto: producto(), cantidad: 1 }], false), EFECTIVO.id, en("17:00"));
  // Anulada al día siguiente: el cobro original sigue siendo del 23, ahora anulado.
  const { original: anulada, compensatorio } = anular(vendidaYAnulada, en("06:00", 24));

  const resumen = resumirDia("2026-09-23", {
    tickets: [ingresoA1, venta, anulada],
    alquileres: [a1],
    horasAdicionales: [
      { id: "h1", alquilerId: "a1", ticketId: horaA1.id, tipo: "EXTENSION_ANTICIPADA", salidaAnterior: en("22:00"), salidaNueva: en("23:00"), creadoPorId: "cajero-1", creadoEn: horaA1.creadoEn },
    ],
    ticketsDeAlquileres: [ingresoA1, horaA1],
    habitaciones,
    metodosPago: [EFECTIVO, YAPE],
  });

  it("totaliza como el reporte de ventas: solo cobros vigentes del día", () => {
    expect(resumen).toMatchObject({ dia: "2026-09-23", totalVentas: 3000 + 700, cantidadCobros: 2 });
    expect(resumen.detalle.porOrigen).toEqual([
      { origen: "INGRESO_ALQUILER", total: 3000 },
      { origen: "VENTA_TIENDA", total: 700 },
    ]);
  });

  it("los métodos de pago llevan su nombre, para que el espejo no necesite la tabla de métodos", () => {
    expect(resumen.detalle.porMetodoPago).toEqual([{ metodoPagoId: EFECTIVO.id, nombre: "Efectivo", total: 3700 }]);
  });

  it("cuenta los cobros del día que hoy están anulados, aunque se anularan después", () => {
    expect(resumen).toMatchObject({ anuladosCantidad: 1, anuladosTotal: 350 });
  });

  it("la ocupación es la del reporte local: el alquiler con su hora adicional del día siguiente, todas las habitaciones", () => {
    expect(resumen).toMatchObject({ alquileres: 1, horasVendidas: 9 });
    expect(resumen.detalle.ocupacion).toEqual([
      { habitacionId: "hab-101", numero: "101", alquileres: 0, horasVendidas: 0, ingresos: 0 },
      { habitacionId: "hab-205", numero: "205", alquileres: 1, horasVendidas: 9, ingresos: 3000 + 800 },
    ]);
  });

  it("un compensatorio de otro día no entra en este: es un defecto de quien arma los datos", () => {
    expect(() => resumirDia("2026-09-23", { tickets: [compensatorio], alquileres: [], horasAdicionales: [], ticketsDeAlquileres: [], habitaciones, metodosPago: [] })).toThrow(
      RangeError,
    );
    expect(() => resumirDia("2026-09-22", { tickets: [], alquileres: [a1], horasAdicionales: [], ticketsDeAlquileres: [], habitaciones, metodosPago: [] })).toThrow(RangeError);
  });

  it("un día sin movimiento publica ceros con todas las habitaciones", () => {
    const vacio = resumirDia("2026-09-25", { tickets: [], alquileres: [], horasAdicionales: [], ticketsDeAlquileres: [], habitaciones, metodosPago: [] });
    expect(vacio).toMatchObject({ totalVentas: 0, cantidadCobros: 0, anuladosCantidad: 0, alquileres: 0, horasVendidas: 0 });
    expect(vacio.detalle.ocupacion).toHaveLength(2);
  });

  it("ida y vuelta por la fila de Postgres sin perder nada", () => {
    expect(desdeFilaResumenDia(aFilaResumenDia(resumen, en("20:00")))).toEqual(resumen);
    expect(ResumenDiaSchema.safeParse(resumen).success).toBe(true);
  });
});

describe("Resumen de un turno (RN-34)", () => {
  const faltante = { ...turnoCerrado, id: "t-a", efectivoContado: 9500, diferencia: -500, comentarioCierre: "faltó un vuelto" };
  const delTurno = cobro("INGRESO_ALQUILER", ingreso(3000), EFECTIVO.id, en("14:00"), { turnoId: "t-a" });
  const deOtro = cobro("INGRESO_ALQUILER", ingreso(4000), EFECTIVO.id, en("15:00"), { turnoId: "t-b" });

  it("publica el arqueo con lo vendido en el turno, sin tickets de otros turnos", () => {
    expect(resumirTurno(faltante, "ana", [delTurno, deOtro])).toEqual({
      turnoId: "t-a",
      diaCierre: "2026-09-23",
      cajero: "ana",
      abiertoEn: en("08:00"),
      cerradoEn: en("20:00"),
      cierreForzado: false,
      efectivoInicial: 10000,
      efectivoEsperado: 10000,
      efectivoContado: 9500,
      diferencia: -500,
      ventasTurno: 3000,
      comentario: "faltó un vuelto",
      version: 1,
    });
  });

  it("un cobro anulado ya no cuenta en las ventas del turno", () => {
    expect(resumirTurno(faltante, "ana", [anular(delTurno, en("15:00")).original]).ventasTurno).toBe(0);
  });

  it("el día de cierre es el de Lima: cerrar a las 02:00 UTC del 24 es todavía el 23", () => {
    expect(resumirTurno({ ...faltante, cerradoEn: en("02:00", 24) }, "ana", []).diaCierre).toBe("2026-09-23");
  });

  it("un cierre forzado sin conteo viaja sin contado ni diferencia", () => {
    const forzado = { ...turnoCerrado, cierreForzado: true, cerradoPorId: "admin-1", efectivoContado: null, diferencia: null };
    expect(resumirTurno(forzado, "luis", [])).toMatchObject({ cierreForzado: true, efectivoContado: null, diferencia: null });
  });

  it("un comentario largo se recorta a 200 caracteres", () => {
    const r = resumirTurno({ ...faltante, comentarioCierre: "x".repeat(500) }, "ana", []);
    expect(r.comentario).toHaveLength(200);
    expect(r.comentario?.endsWith("…")).toBe(true);
  });

  it("un turno abierto no se publica: su esperado es secreto hasta el cierre", () => {
    expect(() => resumirTurno(turnoAbierto(), "ana", [])).toThrow(RangeError);
  });

  it("ida y vuelta por la fila de Postgres, que devuelve fechas con desfase", () => {
    const r = resumirTurno(faltante, "ana", [delTurno]);
    const fila = { ...aFilaResumenTurno(r, en("20:00")), abierto_en: "2026-09-23T08:00:00+00:00", cerrado_en: "2026-09-23T20:00:00+00:00" };
    expect(desdeFilaResumenTurno(fila)).toEqual(r);
  });
});

describe("Lectura del resumen en la vista remota", () => {
  const dia = (d: string, extra: Partial<ResumenDia> = {}, detalle: Partial<ResumenDia["detalle"]> = {}): ResumenDia => ({
    dia: d,
    totalVentas: 0,
    cantidadCobros: 0,
    anuladosCantidad: 0,
    anuladosTotal: 0,
    alquileres: 0,
    horasVendidas: 0,
    detalle: { porOrigen: [], porMetodoPago: [], ocupacion: [], ...detalle },
    version: 1,
    ...extra,
  });
  const hab = (id: string, numero: string, alquileres: number, horasVendidas: number, ingresos: number) => ({ habitacionId: id, numero, alquileres, horasVendidas, ingresos });

  it("suma los días del periodo, sin importar el orden en que llegan", () => {
    const d24 = dia(
      "2026-09-24",
      { totalVentas: 4000, cantidadCobros: 2, alquileres: 1, horasVendidas: 8 },
      {
        porOrigen: [{ origen: "VENTA_TIENDA", total: 1000 }, { origen: "INGRESO_ALQUILER", total: 3000 }],
        porMetodoPago: [{ metodoPagoId: "efectivo", nombre: "Efectivo", total: 4000 }],
        ocupacion: [hab("h-101", "101", 0, 0, 0), hab("h-205", "205", 1, 8, 3000)],
      },
    );
    const d23 = dia(
      "2026-09-23",
      { totalVentas: 7000, cantidadCobros: 3, anuladosCantidad: 1, anuladosTotal: 2500, alquileres: 2, horasVendidas: 17 },
      {
        porOrigen: [{ origen: "INGRESO_ALQUILER", total: 6200 }, { origen: "HORA_ADICIONAL", total: 800 }],
        porMetodoPago: [
          { metodoPagoId: "efectivo", nombre: "Efectivo", total: 3000 },
          { metodoPagoId: "yape", nombre: "Yape", total: 4000 },
        ],
        ocupacion: [hab("h-205", "205", 1, 9, 3800), hab("h-101", "101", 1, 8, 2500)],
      },
    );
    const t = sumarResumenesDia([d24, d23]);
    expect(t).toMatchObject({ totalVentas: 11000, cantidadCobros: 5, anuladosCantidad: 1, anuladosTotal: 2500, alquileres: 3, horasVendidas: 25 });
    expect(t.porOrigen).toEqual([
      { origen: "INGRESO_ALQUILER", total: 9200 },
      { origen: "HORA_ADICIONAL", total: 800 },
      { origen: "VENTA_TIENDA", total: 1000 },
    ]);
    expect(t.porMetodoPago).toEqual([
      { metodoPagoId: "efectivo", nombre: "Efectivo", total: 7000 },
      { metodoPagoId: "yape", nombre: "Yape", total: 4000 },
    ]);
    expect(t.porDia).toEqual([
      { dia: "2026-09-23", total: 7000, cantidadCobros: 3 },
      { dia: "2026-09-24", total: 4000, cantidadCobros: 2 },
    ]);
    expect(t.ocupacion).toEqual([hab("h-101", "101", 1, 8, 2500), hab("h-205", "205", 2, 17, 6800)]);
    // Los totales cuadran con sus desgloses.
    expect(t.porOrigen.reduce((s, o) => s + o.total, 0)).toBe(t.totalVentas);
    expect(t.porMetodoPago.reduce((s, m) => s + m.total, 0)).toBe(t.totalVentas);
  });

  it("un método renombrado toma el nombre del día más reciente", () => {
    const t = sumarResumenesDia([
      dia("2026-09-24", {}, { porMetodoPago: [{ metodoPagoId: "m", nombre: "Tarjeta POS", total: 100 }] }),
      dia("2026-09-23", {}, { porMetodoPago: [{ metodoPagoId: "m", nombre: "Tarjeta", total: 100 }] }),
    ]);
    expect(t.porMetodoPago).toEqual([{ metodoPagoId: "m", nombre: "Tarjeta POS", total: 200 }]);
  });

  it("sin días, todo en cero", () => {
    expect(sumarResumenesDia([])).toEqual({
      totalVentas: 0,
      cantidadCobros: 0,
      anuladosCantidad: 0,
      anuladosTotal: 0,
      alquileres: 0,
      horasVendidas: 0,
      porOrigen: [],
      porMetodoPago: [],
      porDia: [],
      ocupacion: [],
    });
  });

  it("arqueos del periodo en orden de cierre, con la suma de diferencias", () => {
    const base = resumirTurno({ ...turnoCerrado, id: "t-a", efectivoContado: 9500, diferencia: -500, comentarioCierre: "faltó" }, "ana", []);
    const cuadrado = { ...base, turnoId: "t-b", cerradoEn: en("19:00"), diferencia: 0, efectivoContado: 10000 };
    const sinConteo = { ...base, turnoId: "t-c", cerradoEn: en("21:00"), cierreForzado: true, diferencia: null, efectivoContado: null };
    const r = resumirArqueosEspejo([sinConteo, base, cuadrado]);
    expect(r.turnos.map((t) => t.turnoId)).toEqual(["t-b", "t-a", "t-c"]);
    expect(r).toMatchObject({ diferenciaTotal: -500, turnosConDiferencia: 1 });
  });

  it("desactualizado: más de dos intervalos sin publicar", () => {
    const ahora = new Date("2026-09-26T15:00:00.000Z");
    expect(estaDesactualizado("2026-09-26T14:01:00.000Z", 30, ahora)).toBe(false);
    expect(estaDesactualizado("2026-09-26T14:00:00.000Z", 30, ahora)).toBe(false);
    expect(estaDesactualizado("2026-09-26T13:59:00.000Z", 30, ahora)).toBe(true);
    expect(estaDesactualizado(null, 30, ahora)).toBe(false);
  });
});
