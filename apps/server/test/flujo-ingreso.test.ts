import {
  RUTAS,
  RegistrarHoraAdicionalRespuestaSchema,
  RegistrarIngresoRespuestaSchema,
  SalidaRespuestaSchema,
  TurnoSchema,
} from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { efectivo, prepararEntorno, ruta, yape, type Entorno } from "./entorno.js";

let e: Entorno;
let cajero: string;

beforeEach(async () => {
  e = await prepararEntorno();
  cajero = await e.login("cajero");
});
afterEach(() => e.cerrar());

const abrirTurno = (efectivoInicial = 10000) => e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial });

function ingreso(cuerpo: Record<string, unknown> = {}, clave = "clave-ingreso-1") {
  return e.llamar(
    "POST",
    RUTAS.registrarIngreso,
    cajero,
    { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000, 5000)], ...cuerpo },
    clave,
  );
}

describe("Flujo de ingreso completo, de punta a punta", () => {
  it("turno → cotización → ingreso → hora adicional en sobretiempo → salida → limpieza pendiente → arqueo", async () => {
    // 14:00 — el cajero abre su turno con S/ 100.00.
    const turno = await abrirTurno(10000);
    expect(turno.statusCode).toBe(201);
    expect(TurnoSchema.parse(turno.json())).toMatchObject({ estado: "ABIERTO", efectivoInicial: 10000, efectivoEsperado: null });

    // Cotiza la 205 (S/ 40.00) con 2 horas al ingreso: 40 + 2 × 8 = S/ 56.00, salida 00:00.
    const cotizacion = await e.llamar("POST", RUTAS.cotizarIngreso, cajero, {
      habitacionId: "hab-205",
      clienteId: null,
      horasAdicionalesAlIngreso: 2,
    });
    expect(cotizacion.statusCode).toBe(200);
    expect(cotizacion.json()).toMatchObject({ total: 5600, origenPrecio: "LISTA", salidaProgramadaEn: "2026-09-24T00:00:00.000Z" });

    // Cobra S/ 56.00: paga S/ 60.00 en efectivo, vuelto S/ 4.00.
    const r = await ingreso({ horasAdicionalesAlIngreso: 2, pagos: [efectivo(5600, 6000)] });
    expect(r.statusCode).toBe(201);
    const { alquiler, habitacion, ticket } = RegistrarIngresoRespuestaSchema.parse(r.json());
    expect(alquiler).toMatchObject({ estado: "ABIERTO", salidaProgramadaEn: "2026-09-24T00:00:00.000Z", precioHabitacionAplicado: 4000 });
    expect(habitacion.estado).toBe("OCUPADA");
    expect(ticket).toMatchObject({ numero: 1, total: 5600, origen: "INGRESO_ALQUILER" });
    expect(ticket.pagos[0]).toMatchObject({ montoRecibido: 6000, vuelto: 400 });

    // 00:20 — 20 minutos después de la salida: sobretiempo. La cotización lo detecta sola (RF-08).
    e.reloj.avanzarMinutos(10 * 60 + 20);
    const cotHora = await e.llamar("GET", ruta(RUTAS.cotizarHoraAdicional, alquiler.id), cajero);
    expect(cotHora.json()).toMatchObject({ tipo: "LIQUIDACION_SOBRETIEMPO", estadoTemporal: "EN_SOBRETIEMPO", salidaNueva: "2026-09-24T01:20:00.000Z" });

    // Salir sin resolver el sobretiempo se rechaza (RN-12).
    const bloqueada = await e.llamar("POST", ruta(RUTAS.registrarSalida, alquiler.id), cajero, {});
    expect(bloqueada.statusCode).toBe(422);
    expect(bloqueada.json()).toMatchObject({ codigo: "OVERTIME_UNRESOLVED" });

    // Paga la hora (S/ 8.00 por Yape): nueva salida = pago + 1 h, cortesía consumida (RN-06, RN-07).
    const hora = await e.llamar("POST", ruta(RUTAS.registrarHoraAdicional, alquiler.id), cajero, { ajuste: null, pagos: [yape(800)] }, "clave-hora-1");
    expect(hora.statusCode).toBe(201);
    const pagada = RegistrarHoraAdicionalRespuestaSchema.parse(hora.json());
    expect(pagada.alquiler).toMatchObject({ salidaProgramadaEn: "2026-09-24T01:20:00.000Z", cortesiaConsumida: true });
    expect(pagada.horaAdicional).toMatchObject({ tipo: "LIQUIDACION_SOBRETIEMPO", salidaAnterior: "2026-09-24T00:00:00.000Z" });
    expect(pagada.ticket).toMatchObject({ numero: 2, total: 800, origen: "HORA_ADICIONAL" });

    // 00:50 — sale antes de agotar la hora: sin cargo; la habitación pasa a limpieza (RN-02, RN-29).
    e.reloj.avanzarMinutos(30);
    const salida = await e.llamar("POST", ruta(RUTAS.registrarSalida, alquiler.id), cajero, {});
    expect(salida.statusCode).toBe(200);
    const cerrada = SalidaRespuestaSchema.parse(salida.json());
    expect(cerrada.alquiler).toMatchObject({ estado: "CERRADO", cerradoEn: "2026-09-24T00:50:00.000Z", salidaSinPago: false });
    expect(cerrada.habitacion.estado).toBe("PENDIENTE_LIMPIEZA");

    // Arqueo ciego: esperado = 100 + 56 en efectivo; los S/ 8.00 de Yape no cuentan (RN-33, RN-35).
    const cierre = await e.llamar("POST", RUTAS.cerrarTurno, cajero, { efectivoContado: 15600, comentario: null });
    expect(cierre.statusCode).toBe(200);
    expect(TurnoSchema.parse(cierre.json())).toMatchObject({ estado: "CERRADO", efectivoEsperado: 15600, diferencia: 0 });

    // Todo quedó persistido y auditado (RN-42).
    const acciones = (await e.prisma.registroAuditoria.findMany({ orderBy: { ocurridoEn: "asc" } })).map((r) => r.accion);
    expect(acciones).toEqual(
      expect.arrayContaining(["SESION_INICIADA", "TURNO_ABIERTO", "INGRESO_REGISTRADO", "HORA_ADICIONAL_COBRADA", "SALIDA_REGISTRADA", "TURNO_CERRADO"]),
    );
    expect(await e.prisma.ticket.count()).toBe(2);
  });

  it("salida sin pago en sobretiempo, con motivo auditado (CU-07)", async () => {
    await abrirTurno();
    const { alquiler } = RegistrarIngresoRespuestaSchema.parse((await ingreso()).json());
    e.reloj.avanzarMinutos(8 * 60 + 30);

    const sinMotivo = await e.llamar("POST", ruta(RUTAS.registrarSalidaSinPago, alquiler.id), cajero, { motivo: "  " });
    expect(sinMotivo.json()).toMatchObject({ codigo: "REASON_REQUIRED" });

    const r = await e.llamar("POST", ruta(RUTAS.registrarSalidaSinPago, alquiler.id), cajero, { motivo: "se retiró sin avisar" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ alquiler: { salidaSinPago: true, motivoSalidaSinPago: "se retiró sin avisar" } });
    const registro = await e.prisma.registroAuditoria.findFirst({ where: { accion: "SALIDA_SIN_PAGO_REGISTRADA" } });
    expect(registro?.motivo).toBe("se retiró sin avisar");
  });
});

describe("Reglas que rechazan sin dejar rastro", () => {
  it("sin turno abierto no se cobra (RN-32)", async () => {
    const r = await ingreso();
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: "SHIFT_NOT_OPEN" });
  });

  it("un pago insuficiente no registra nada (RN-23, E2 de CU-04)", async () => {
    await abrirTurno();
    const r = await ingreso({ pagos: [efectivo(3000, 3000)] });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: "PAYMENT_INSUFFICIENT" });
    expect(await e.prisma.alquiler.count()).toBe(0);
    expect(await e.prisma.ticket.count()).toBe(0);
    expect((await e.prisma.habitacion.findUniqueOrThrow({ where: { id: "hab-205" } })).estado).toBe("LIBRE");
  });

  it("un ajuste por debajo del precio se rechaza y nada se persiste (RN-18)", async () => {
    await abrirTurno();
    const r = await ingreso({ ajuste: { montoAjustado: 3500, motivo: "descuento" }, pagos: [efectivo(3500)] });
    expect(r.json()).toMatchObject({ codigo: "ADJUSTMENT_BELOW_MINIMUM" });
    expect(await e.prisma.alquiler.count()).toBe(0);
  });

  it("un ajuste al alza se cobra y queda auditado con su motivo (RN-17, RN-42)", async () => {
    await abrirTurno();
    const r = await ingreso({ ajuste: { montoAjustado: 5000, motivo: "cliente ingresó solo" }, pagos: [efectivo(5000)] });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ ticket: { total: 5000, ajustePuntual: { montoOriginal: 4000, montoAjustado: 5000 } } });
    const registro = await e.prisma.registroAuditoria.findFirst({ where: { accion: "AJUSTE_PUNTUAL_APLICADO" } });
    expect(registro?.motivo).toBe("cliente ingresó solo");
  });

  it("un método que exige número de operación lo requiere (RF-54)", async () => {
    await abrirTurno();
    await e.prisma.metodoPago.update({ where: { id: "metodo-transferencia" }, data: { activo: true } });
    const r = await ingreso({ pagos: [{ metodoPagoId: "metodo-transferencia", monto: 4000, montoRecibido: null, referencia: null }] });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ codigo: "VALIDACION" });
  });
});

describe("Arqueo con diferencia (PEND-05)", () => {
  it("sin comentario no cierra; con comentario cierra y lo guarda", async () => {
    await abrirTurno(10000);
    await ingreso();

    const sinComentario = await e.llamar("POST", RUTAS.cerrarTurno, cajero, { efectivoContado: 13500, comentario: null });
    expect(sinComentario.statusCode).toBe(422);
    expect(sinComentario.json()).toMatchObject({ codigo: "REASON_REQUIRED" });

    const r = await e.llamar("POST", RUTAS.cerrarTurno, cajero, { efectivoContado: 13500, comentario: "faltaron S/ 5.00" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ efectivoEsperado: 14000, diferencia: -500, comentarioCierre: "faltaron S/ 5.00" });
  });

  it("un turno cerrado no se cierra otra vez, y no se abren dos a la vez", async () => {
    expect((await abrirTurno()).statusCode).toBe(201);
    const segundo = await abrirTurno();
    expect(segundo.statusCode).toBe(422);
    expect(segundo.json()).toMatchObject({ codigo: "INVALID_STATE_TRANSITION" });

    await e.llamar("POST", RUTAS.cerrarTurno, cajero, { efectivoContado: 10000, comentario: null });
    const otraVez = await e.llamar("POST", RUTAS.cerrarTurno, cajero, { efectivoContado: 10000, comentario: null });
    expect(otraVez.json()).toMatchObject({ codigo: "SHIFT_NOT_OPEN" });
  });
});
