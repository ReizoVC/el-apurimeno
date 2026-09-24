import { describe, expect, it } from "vitest";
import {
  AlquilerSchema,
  ClienteSchema,
  ConfiguracionGlobalSchema,
  HoraAdicionalSchema,
  MovimientoCajaSchema,
  MovimientoInventarioSchema,
  PERMISOS,
  PARAMETROS_TIEMPO_PRECIO_INICIALES,
  ProductoSchema,
  RANGOS_INICIALES,
  RegistroAuditoriaSchema,
  TRANSICIONES_HABITACION,
  TicketSchema,
  TurnoSchema,
  UsuarioSchema,
  esTransicionValida,
  type Alquiler,
  type ConfiguracionGlobal,
  type Ticket,
} from "../src/index.js";

const EFECTIVO = "metodo-efectivo";

// T-16: habitación de S/ 30.00 con 2 horas pagadas al ingreso → S/ 46.00.
function ticketIngresoT16(): Ticket {
  return {
    id: "ticket-1",
    numero: 1,
    tipo: "COBRO",
    origen: "INGRESO_ALQUILER",
    estado: "EMITIDO",
    turnoId: "turno-1",
    alquilerId: "alquiler-1",
    habitacionReferenciaId: null,
    ticketOriginalId: null,
    total: 4600,
    ajustePuntual: null,
    anulacion: null,
    lineas: [
      { id: "l1", tipo: "BASE_HABITACION", descripcion: "Habitación 205 — 8 horas", cantidad: 1, precioUnitario: 3000, importe: 3000, productoId: null },
      { id: "l2", tipo: "HORA_ADICIONAL", descripcion: "Hora adicional", cantidad: 2, precioUnitario: 800, importe: 1600, productoId: null },
    ],
    pagos: [{ id: "p1", metodoPagoId: EFECTIVO, monto: 4600, referencia: null, montoRecibido: 5000, vuelto: 400 }],
    creadoPorId: "cajero-1",
    creadoEn: "2026-09-23T19:00:00.000Z",
  };
}

// T-10: ajuste puntual de S/ 30.00 a S/ 40.00 con motivo.
function ticketConAjusteT10(): Ticket {
  return {
    ...ticketIngresoT16(),
    total: 4000,
    ajustePuntual: { montoOriginal: 3000, montoAjustado: 4000, motivo: "cliente ingresó solo" },
    lineas: [
      { id: "l1", tipo: "BASE_HABITACION", descripcion: "Habitación 205 — 8 horas", cantidad: 1, precioUnitario: 3000, importe: 3000, productoId: null },
      { id: "l2", tipo: "AJUSTE_PUNTUAL", descripcion: "Ajuste", cantidad: 1, precioUnitario: 1000, importe: 1000, productoId: null },
    ],
    pagos: [{ id: "p1", metodoPagoId: EFECTIVO, monto: 4000, referencia: null, montoRecibido: null, vuelto: null }],
  };
}

function alquilerAbierto(): Alquiler {
  return {
    id: "alquiler-1",
    habitacionId: "hab-205",
    clienteId: null,
    turnoId: "turno-1",
    estado: "ABIERTO",
    ingresoEn: "2026-09-23T19:00:00.000Z",
    salidaProgramadaEn: "2026-09-24T05:00:00.000Z",
    cortesiaConsumida: false,
    origenPrecio: "LISTA",
    precioHabitacionAplicado: 3000,
    horasAdicionalesAlIngreso: 2,
    parametrosAplicados: PARAMETROS_TIEMPO_PRECIO_INICIALES,
    cerradoEn: null,
    cerradoPorId: null,
    salidaSinPago: false,
    motivoSalidaSinPago: null,
  };
}

function configuracion(): ConfiguracionGlobal {
  return {
    parametrosAlquiler: PARAMETROS_TIEMPO_PRECIO_INICIALES,
    comprobante: { nombreNegocio: "El Apurimeño", datosAdicionales: "Documento interno sin valor tributario" },
    impresora: { anchoPapelMm: 80, conexion: "USB" },
    permitirStockNegativo: false,
    minutosVigenciaCodigoAutorizacion: 5,
  };
}

describe("Ticket", () => {
  it("acepta el ingreso con horas pagadas al ingreso (T-16)", () => {
    expect(TicketSchema.safeParse(ticketIngresoT16()).success).toBe(true);
  });

  it("rechaza un total que no es la suma de las líneas", () => {
    expect(TicketSchema.safeParse({ ...ticketIngresoT16(), total: 3000 }).success).toBe(false);
  });

  it("rechaza pagos que no suman el total", () => {
    const t = ticketIngresoT16();
    t.pagos = [{ id: "p1", metodoPagoId: EFECTIVO, monto: 4000, referencia: null, montoRecibido: null, vuelto: null }];
    expect(TicketSchema.safeParse(t).success).toBe(false);
  });

  it("rechaza un monto recibido insuficiente (PAYMENT_INSUFFICIENT)", () => {
    const t = ticketIngresoT16();
    t.pagos = [{ id: "p1", metodoPagoId: EFECTIVO, monto: 4600, referencia: null, montoRecibido: 4000, vuelto: 0 }];
    expect(TicketSchema.safeParse(t).success).toBe(false);
  });

  it("acepta un ajuste puntual al alza (T-10)", () => {
    expect(TicketSchema.safeParse(ticketConAjusteT10()).success).toBe(true);
  });

  it("rechaza un ajuste por debajo del mínimo (T-11, RN-18)", () => {
    const t = ticketConAjusteT10();
    t.ajustePuntual = { montoOriginal: 3000, montoAjustado: 2500, motivo: "descuento" };
    expect(TicketSchema.safeParse(t).success).toBe(false);
  });

  it("rechaza una línea de ajuste sin su detalle", () => {
    expect(TicketSchema.safeParse({ ...ticketConAjusteT10(), ajustePuntual: null }).success).toBe(false);
  });

  it("acepta un ticket compensatorio por el importe inverso (RF-29)", () => {
    const original = ticketIngresoT16();
    const compensatorio: Ticket = {
      ...original,
      id: "ticket-2",
      numero: 2,
      tipo: "COMPENSATORIO",
      ticketOriginalId: original.id,
      total: -4600,
      anulacion: { motivo: "habitación incorrecta", codigoAutorizacionId: null },
      lineas: original.lineas.map((l) => ({ ...l, precioUnitario: -l.precioUnitario, importe: -l.importe })),
      pagos: [{ id: "p2", metodoPagoId: EFECTIVO, monto: -4600, referencia: null, montoRecibido: null, vuelto: null }],
    };
    expect(TicketSchema.safeParse(compensatorio).success).toBe(true);
    expect(TicketSchema.safeParse({ ...compensatorio, anulacion: null }).success).toBe(false);
    expect(TicketSchema.safeParse({ ...compensatorio, estado: "ANULADO" }).success).toBe(false);
  });

  it("no permite que una venta de tienda referencie un alquiler (RES-02)", () => {
    const venta: Ticket = {
      ...ticketIngresoT16(),
      origen: "VENTA_TIENDA",
      alquilerId: null,
      habitacionReferenciaId: "hab-107",
      total: 600,
      lineas: [{ id: "l1", tipo: "PRODUCTO", descripcion: "Gaseosa x 2", cantidad: 2, precioUnitario: 300, importe: 600, productoId: "prod-1" }],
      pagos: [{ id: "p1", metodoPagoId: EFECTIVO, monto: 600, referencia: null, montoRecibido: null, vuelto: null }],
    };
    expect(TicketSchema.safeParse(venta).success).toBe(true);
    expect(TicketSchema.safeParse({ ...venta, alquilerId: "alquiler-1" }).success).toBe(false);
  });

  it("rechaza campos que no están en el contrato", () => {
    expect(TicketSchema.safeParse({ ...ticketIngresoT16(), nombreCliente: "Juan" }).success).toBe(false);
  });
});

describe("Alquiler", () => {
  it("acepta un alquiler abierto con 8 + 2 horas", () => {
    expect(AlquilerSchema.safeParse(alquilerAbierto()).success).toBe(true);
  });

  it("no guarda el estado temporal (RN-11)", () => {
    expect(AlquilerSchema.safeParse({ ...alquilerAbierto(), estadoTemporal: "EN_CORTESIA" }).success).toBe(false);
  });

  it("rechaza una salida programada menor a las horas pagadas al ingreso", () => {
    expect(AlquilerSchema.safeParse({ ...alquilerAbierto(), salidaProgramadaEn: "2026-09-24T03:00:00.000Z" }).success).toBe(false);
  });

  it("exige cliente identificado para un precio especial (RN-14)", () => {
    expect(AlquilerSchema.safeParse({ ...alquilerAbierto(), origenPrecio: "PRECIO_ESPECIAL" }).success).toBe(false);
  });

  it("exige motivo en una salida sin pago (CU-07)", () => {
    const cerrado: Alquiler = {
      ...alquilerAbierto(),
      estado: "CERRADO",
      cerradoEn: "2026-09-24T06:00:00.000Z",
      cerradoPorId: "cajero-1",
      salidaSinPago: true,
      motivoSalidaSinPago: "cliente se retiró sin avisar",
    };
    expect(AlquilerSchema.safeParse(cerrado).success).toBe(true);
    expect(AlquilerSchema.safeParse({ ...cerrado, motivoSalidaSinPago: "   " }).success).toBe(false);
    expect(AlquilerSchema.safeParse({ ...cerrado, motivoSalidaSinPago: null }).success).toBe(false);
  });
});

describe("HoraAdicional (RF-10)", () => {
  const base = {
    id: "h1",
    alquilerId: "alquiler-1",
    ticketId: "ticket-3",
    salidaAnterior: "2026-09-23T21:00:00.000Z",
    creadoPorId: "cajero-1",
  };

  it("extensión anticipada: salida 16:00 → 17:00", () => {
    const h = { ...base, tipo: "EXTENSION_ANTICIPADA", creadoEn: "2026-09-23T20:30:00.000Z", salidaNueva: "2026-09-23T22:00:00.000Z" };
    expect(HoraAdicionalSchema.safeParse(h).success).toBe(true);
  });

  it("pagada en cortesía (16:10): es extensión anticipada, 16:00 → 17:00 (README, decisión 13)", () => {
    const h = { ...base, tipo: "EXTENSION_ANTICIPADA", creadoEn: "2026-09-23T21:10:00.000Z", salidaNueva: "2026-09-23T22:00:00.000Z" };
    expect(HoraAdicionalSchema.safeParse(h).success).toBe(true);
    expect(HoraAdicionalSchema.safeParse({ ...h, salidaNueva: "2026-09-23T22:10:00.000Z" }).success).toBe(false);
  });

  it("liquidación de sobretiempo: pago 16:20 → salida 17:20, no 17:00", () => {
    const h = { ...base, tipo: "LIQUIDACION_SOBRETIEMPO", creadoEn: "2026-09-23T21:20:00.000Z", salidaNueva: "2026-09-23T22:20:00.000Z" };
    expect(HoraAdicionalSchema.safeParse(h).success).toBe(true);
    expect(HoraAdicionalSchema.safeParse({ ...h, salidaNueva: "2026-09-23T22:00:00.000Z" }).success).toBe(false);
  });
});

describe("Turno y caja", () => {
  const cerrado = {
    id: "turno-1",
    usuarioId: "cajero-1",
    estado: "CERRADO",
    abiertoEn: "2026-09-23T12:00:00.000Z",
    efectivoInicial: 5000,
    cerradoEn: "2026-09-24T00:00:00.000Z",
    cerradoPorId: "cajero-1",
    cierreForzado: false,
    efectivoContado: 33500,
    efectivoEsperado: 34000,
    diferencia: -500,
  };

  it("registra una diferencia de −S/ 5.00 (escenario 31.4)", () => {
    expect(TurnoSchema.safeParse(cerrado).success).toBe(true);
    expect(TurnoSchema.safeParse({ ...cerrado, diferencia: 500 }).success).toBe(false);
  });

  it("no expone el efectivo esperado con el turno abierto (RN-34)", () => {
    const abierto = { ...cerrado, estado: "ABIERTO", cerradoEn: null, cerradoPorId: null, efectivoContado: null, diferencia: null };
    expect(TurnoSchema.safeParse(abierto).success).toBe(false);
    expect(TurnoSchema.safeParse({ ...abierto, efectivoEsperado: null }).success).toBe(true);
  });

  it("un cierre forzado lo hace otro usuario (CU-20)", () => {
    expect(TurnoSchema.safeParse({ ...cerrado, cierreForzado: true }).success).toBe(false);
    expect(TurnoSchema.safeParse({ ...cerrado, cierreForzado: true, cerradoPorId: "admin-1" }).success).toBe(true);
  });

  it("un movimiento de caja exige motivo y monto positivo (RF-42)", () => {
    const m = { id: "m1", turnoId: "turno-1", tipo: "RETIRO", monto: 2000, motivo: "gasto menor", creadoPorId: "cajero-1", creadoEn: "2026-09-23T15:00:00.000Z" };
    expect(MovimientoCajaSchema.safeParse(m).success).toBe(true);
    expect(MovimientoCajaSchema.safeParse({ ...m, motivo: "" }).success).toBe(false);
    expect(MovimientoCajaSchema.safeParse({ ...m, monto: 0 }).success).toBe(false);
  });
});

describe("Tienda", () => {
  it("un producto tiene código de barras opcional", () => {
    const p = {
      id: "prod-1",
      categoriaId: "cat-bebidas",
      nombre: "Gaseosa 500 ml",
      codigoBarras: "7751271001234",
      precioHuesped: 300,
      precioPublico: 350,
      controlaStock: true,
      stock: 10,
      activo: true,
    };
    expect(ProductoSchema.safeParse(p).success).toBe(true);
    expect(ProductoSchema.safeParse({ ...p, codigoBarras: null }).success).toBe(true);
    expect(ProductoSchema.safeParse({ ...p, codigoBarras: "" }).success).toBe(false);
    const { codigoBarras: _omitido, ...sinCampo } = p;
    expect(ProductoSchema.safeParse(sinCampo).success).toBe(false);
  });

  it("una venta descuenta stock y referencia su ticket", () => {
    const m = { id: "mi1", productoId: "prod-1", tipo: "VENTA", cantidad: -3, ticketId: "ticket-9", creadoPorId: "cajero-1", creadoEn: "2026-09-23T15:00:00.000Z" };
    expect(MovimientoInventarioSchema.safeParse(m).success).toBe(true);
    expect(MovimientoInventarioSchema.safeParse({ ...m, cantidad: 3 }).success).toBe(false);
    expect(MovimientoInventarioSchema.safeParse({ ...m, tipo: "REPOSICION", cantidad: 10 }).success).toBe(false);
  });
});

describe("Clientes, usuarios y permisos", () => {
  it("un cliente necesita documento o nombre", () => {
    expect(ClienteSchema.safeParse({ id: "c1", documento: "12345678", nombre: null }).success).toBe(true);
    expect(ClienteSchema.safeParse({ id: "c1", documento: null, nombre: null }).success).toBe(false);
  });

  it("las credenciales no pasan por el contrato", () => {
    const u = { id: "u1", nombreUsuario: "cajero", activo: true, rangoIds: ["rango-cajero"] };
    expect(UsuarioSchema.safeParse(u).success).toBe(true);
    expect(UsuarioSchema.safeParse({ ...u, passwordHash: "x" }).success).toBe(false);
  });

  it("el catálogo tiene los 23 permisos de §41.3 más store.manual_adjustment", () => {
    expect(PERMISOS).toHaveLength(24);
    expect(PERMISOS).toContain("store.manual_adjustment");
    expect(RANGOS_INICIALES.ADMINISTRADOR.permisos).toEqual(PERMISOS);
  });

  it("el Cajero ajusta habitaciones y tienda, pero no anula por sí mismo", () => {
    expect(RANGOS_INICIALES.CAJERO.permisos).toContain("rentals.manual_adjustment");
    expect(RANGOS_INICIALES.CAJERO.permisos).toContain("store.manual_adjustment");
    expect(RANGOS_INICIALES.CAJERO.permisos).not.toContain("tickets.void");
  });

  it("una habitación pendiente de limpieza no pasa directo a ocupada", () => {
    expect(esTransicionValida(TRANSICIONES_HABITACION, "PENDIENTE_LIMPIEZA", "OCUPADA")).toBe(false);
    expect(esTransicionValida(TRANSICIONES_HABITACION, "PENDIENTE_LIMPIEZA", "LIBRE")).toBe(true);
  });
});

describe("Auditoría y configuración", () => {
  it("una anulación auditada exige motivo", () => {
    const r = {
      id: "a1",
      ocurridoEn: "2026-09-23T15:00:00.000Z",
      usuarioId: "admin-1",
      accion: "TICKET_ANULADO",
      tipoEntidad: "TICKET",
      entidadId: "ticket-1",
      valorPrevio: { estado: "EMITIDO" },
      valorNuevo: { estado: "ANULADO" },
      motivo: null,
    };
    expect(RegistroAuditoriaSchema.safeParse(r).success).toBe(false);
    expect(RegistroAuditoriaSchema.safeParse({ ...r, motivo: "habitación incorrecta" }).success).toBe(true);
  });

  it("el comprobante no usa terminología fiscal (RN-39)", () => {
    expect(ConfiguracionGlobalSchema.safeParse(configuracion()).success).toBe(true);
    const conBoleta = configuracion();
    conBoleta.comprobante.datosAdicionales = "Boleta de venta";
    expect(ConfiguracionGlobalSchema.safeParse(conBoleta).success).toBe(false);
    const conSerie = configuracion();
    conSerie.comprobante.datosAdicionales = "B001-00000123";
    expect(ConfiguracionGlobalSchema.safeParse(conSerie).success).toBe(false);
  });
});
