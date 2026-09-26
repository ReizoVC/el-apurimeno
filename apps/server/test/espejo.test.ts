import {
  EstadoEspejoSchema,
  RUTAS,
  RegistrarIngresoRespuestaSchema,
  ReporteVentasSchema,
  SincronizacionEspejoRespuestaSchema,
} from "@apurimeno/contracts";
import { periodoDelDia } from "@apurimeno/domain";
import { afterEach, describe, expect, it } from "vitest";
import type { OpcionesEspejo } from "../src/espejo/control.js";
import { ErrorEspejo, type LoteEspejo, type TransporteEspejo } from "../src/espejo/transporte.js";
import { efectivo, prepararEntorno, ruta, type Entorno } from "./entorno.js";

/** Espejo en memoria: guarda cada lote publicado; puede fallar o quedarse esperando a pedido de la prueba. */
class EspejoFalso implements TransporteEspejo {
  readonly descripcion = "espejo de prueba";
  lotes: LoteEspejo[] = [];
  error: Error | null = null;
  pausa: Promise<void> | null = null;

  async publicar(lote: LoteEspejo): Promise<void> {
    if (this.pausa !== null) await this.pausa;
    if (this.error !== null) throw this.error;
    this.lotes.push(lote);
  }

  get ultimo(): LoteEspejo {
    const lote = this.lotes.at(-1);
    if (lote === undefined) throw new Error("No se publicó nada.");
    return lote;
  }
}

let e: Entorno;
let destino: EspejoFalso;
afterEach(() => e.cerrar());

const opciones = (transporte: TransporteEspejo | null): OpcionesEspejo => ({
  transporte,
  problemaConfiguracion: null,
  intervaloMinutos: 30,
  versionServidor: "0.1.0",
});

/**
 * El 23/09 (Lima), el cajero abre con S/ 100.00, cobra un ingreso de S/ 40.00 en efectivo y cierra cuadrado.
 * Luego el reloj pasa al 25/09 a las 09:00 de Lima.
 */
async function unDiaDeTrabajo() {
  destino = new EspejoFalso();
  e = await prepararEntorno("2026-09-23T14:00:00.000Z", { espejo: opciones(destino) });
  const cajero = await e.login("cajero");
  await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 10000 });
  const ingreso = RegistrarIngresoRespuestaSchema.parse(
    (
      await e.llamar(
        "POST",
        RUTAS.registrarIngreso,
        cajero,
        { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
        "clave-ingreso-espejo",
      )
    ).json(),
  );
  e.reloj.avanzarMinutos(8 * 60);
  expect((await e.llamar("POST", RUTAS.cerrarTurno, cajero, { efectivoContado: 14000, comentario: null })).statusCode).toBe(200);
  e.reloj.ahora = new Date("2026-09-25T14:00:00.000Z");
  return { ticketId: ingreso.ticket.id, turnoId: ingreso.ticket.turnoId };
}

async function anularComoAdmin(ticketId: string) {
  const admin = await e.login("admin");
  await e.llamar("POST", RUTAS.abrirTurno, admin, { efectivoInicial: 0 });
  const r = await e.llamar("POST", ruta(RUTAS.anularTicket, ticketId), admin, { motivo: "cobro duplicado", codigoAutorizacion: null }, "clave-anular-espejo");
  expect(r.statusCode).toBe(201);
}

const dias = (lote: LoteEspejo) => lote.dias.map((d) => d.dia);

describe("Sincronización con el espejo en la nube (ADR-06, RF-60)", () => {
  it("la primera vez publica todo el historial, más hoy y ayer, y los turnos cerrados", async () => {
    const { turnoId } = await unDiaDeTrabajo();
    expect(await e.app.espejo.sincronizar(false)).toEqual({ exito: true, diasPublicados: 3, turnosPublicados: 1 });

    const lote = destino.ultimo;
    expect(dias(lote)).toEqual(["2026-09-23", "2026-09-24", "2026-09-25"]);
    expect(lote.dias[0]).toMatchObject({ total_ventas: 4000, cantidad_cobros: 1, anulados_cantidad: 0, alquileres: 1, horas_vendidas: 8 });
    expect(lote.dias[0]?.detalle.porMetodoPago).toEqual([{ metodoPagoId: "metodo-efectivo", nombre: "Efectivo", total: 4000 }]);
    expect(lote.dias[1]).toMatchObject({ total_ventas: 0, cantidad_cobros: 0 });
    expect(lote.turnos).toEqual([
      expect.objectContaining({ turno_id: turnoId, cajero: "cajero", dia_cierre: "2026-09-23", efectivo_esperado: 14000, diferencia: 0, ventas_turno: 4000 }),
    ]);
    expect(lote.estado).toEqual({ id: true, ultima_sincronizacion: "2026-09-25T14:00:00.000Z", intervalo_minutos: 30, version_servidor: "0.1.0" });
  });

  it("el resumen del día cuadra con el reporte de ventas del Dashboard local", async () => {
    await unDiaDeTrabajo();
    await e.app.espejo.sincronizar(false);
    const admin = await e.login("admin");
    const periodo = periodoDelDia("2026-09-23");
    const reporte = ReporteVentasSchema.parse((await e.llamar("GET", `${RUTAS.reporteVentas}?desde=${periodo.desde}&hasta=${periodo.hasta}`, admin)).json());
    expect(destino.ultimo.dias[0]?.total_ventas).toBe(reporte.total);
    expect(destino.ultimo.dias[0]?.detalle.porOrigen).toEqual(reporte.porOrigen);
  });

  it("las siguientes solo publican hoy y ayer si nada cambió", async () => {
    await unDiaDeTrabajo();
    await e.app.espejo.sincronizar(false);
    e.reloj.avanzarMinutos(30);
    await e.app.espejo.sincronizar(false);
    expect(dias(destino.ultimo)).toEqual(["2026-09-24", "2026-09-25"]);
    expect(destino.ultimo.turnos).toEqual([]);
  });

  it("anular un cobro de hace días vuelve a publicar ese día y el turno que lo cobró", async () => {
    const { ticketId, turnoId } = await unDiaDeTrabajo();
    await e.app.espejo.sincronizar(false);
    e.reloj.avanzarMinutos(30);
    await anularComoAdmin(ticketId);
    await e.app.espejo.sincronizar(false);

    const lote = destino.ultimo;
    expect(dias(lote)).toEqual(["2026-09-23", "2026-09-24", "2026-09-25"]);
    expect(lote.dias[0]).toMatchObject({ total_ventas: 0, cantidad_cobros: 0, anulados_cantidad: 1, anulados_total: 4000, alquileres: 0 });
    // Solo el turno cerrado: el del Administrador sigue abierto y su esperado no se revela (RN-34).
    expect(lote.turnos.map((t) => t.turno_id)).toEqual([turnoId]);
    expect(lote.turnos[0]?.ventas_turno).toBe(0);
  });

  it("si el espejo falla, no se pierde nada: la siguiente vuelta publica lo pendiente", async () => {
    const { ticketId } = await unDiaDeTrabajo();
    await e.app.espejo.sincronizar(false);
    e.reloj.avanzarMinutos(30);
    await anularComoAdmin(ticketId);

    destino.error = new ErrorEspejo("SIN_CONEXION", "sin internet");
    expect(await e.app.espejo.sincronizar(false)).toEqual({ exito: false, diasPublicados: 0, turnosPublicados: 0 });
    const conFalla = await e.app.espejo.estado();
    expect(conFalla.ultimoError).toEqual({ codigo: "SIN_CONEXION", mensaje: "sin internet", ocurridoEn: "2026-09-25T14:30:00.000Z" });
    expect(conFalla.ultimoExitoEn).toBe("2026-09-25T14:00:00.000Z");

    // Sin internet, el local sigue cobrando (RNF-SYNC-02).
    const cajero = await e.login("cajero");
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 });
    const cobro = await e.llamar(
      "POST",
      RUTAS.registrarIngreso,
      cajero,
      { habitacionId: "hab-101", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(2500)] },
      "clave-ingreso-sin-internet",
    );
    expect(cobro.statusCode).toBe(201);

    destino.error = null;
    e.reloj.avanzarMinutos(30);
    expect((await e.app.espejo.sincronizar(false)).exito).toBe(true);
    expect(dias(destino.ultimo)).toContain("2026-09-23");
    expect((await e.app.espejo.estado()).ultimoError).toBeNull();
  });

  it("un error inesperado queda como ERROR_INTERNO, sin detalles internos en el Dashboard", async () => {
    await unDiaDeTrabajo();
    destino.error = new TypeError("algo se rompió");
    await e.app.espejo.sincronizar(false);
    expect((await e.app.espejo.estado()).ultimoError).toMatchObject({ codigo: "ERROR_INTERNO", mensaje: expect.stringContaining("registro del servidor") });
  });

  it("completo vuelve a publicar todo el historial aunque ya se haya sincronizado", async () => {
    await unDiaDeTrabajo();
    await e.app.espejo.sincronizar(false);
    e.reloj.avanzarMinutos(30);
    expect(await e.app.espejo.sincronizar(true)).toEqual({ exito: true, diasPublicados: 3, turnosPublicados: 1 });
  });
});

describe("Rutas del espejo (settings.manage)", () => {
  it("el Dashboard ve el estado; el Cajero no", async () => {
    await unDiaDeTrabajo();
    const admin = await e.login("admin");
    const cajero = await e.login("cajero");
    expect((await e.llamar("GET", RUTAS.estadoEspejo, cajero)).statusCode).toBe(403);
    expect((await e.llamar("POST", RUTAS.sincronizarEspejo, cajero, { completo: false })).statusCode).toBe(403);
    const estado = EstadoEspejoSchema.parse((await e.llamar("GET", RUTAS.estadoEspejo, admin)).json());
    expect(estado).toMatchObject({ configurado: true, sincronizando: false, ultimoExitoEn: null, ultimoError: null, intervaloMinutos: 30 });
  });

  it("sincronizar ahora devuelve el resultado y queda auditado con quién lo pidió", async () => {
    await unDiaDeTrabajo();
    const admin = await e.login("admin");
    const r = await e.llamar("POST", RUTAS.sincronizarEspejo, admin, { completo: false });
    expect(r.statusCode).toBe(200);
    const cuerpo = SincronizacionEspejoRespuestaSchema.parse(r.json());
    expect(cuerpo).toMatchObject({ exito: true, diasPublicados: 3, turnosPublicados: 1, estado: { ultimoExitoEn: "2026-09-25T14:00:00.000Z" } });
    const auditoria = await e.prisma.registroAuditoria.findFirstOrThrow({ where: { accion: "ESPEJO_SINCRONIZADO" } });
    expect(auditoria).toMatchObject({ usuarioId: "usuario-admin", tipoEntidad: "ESPEJO" });
    expect(auditoria.valorNuevo).toEqual({ completo: false, exito: true, diasPublicados: 3, turnosPublicados: 1, error: null });
  });

  it("una falla del espejo responde 200 con el error en el estado, para mostrarlo tal cual", async () => {
    await unDiaDeTrabajo();
    destino.error = new ErrorEspejo("CREDENCIALES_RECHAZADAS", "Supabase rechazó la cuenta de sincronización.");
    const admin = await e.login("admin");
    const cuerpo = SincronizacionEspejoRespuestaSchema.parse((await e.llamar("POST", RUTAS.sincronizarEspejo, admin, { completo: false })).json());
    expect(cuerpo).toMatchObject({ exito: false, estado: { ultimoError: { codigo: "CREDENCIALES_RECHAZADAS" } } });
  });

  it("no se lanzan dos sincronizaciones a la vez", async () => {
    await unDiaDeTrabajo();
    let soltar: () => void = () => undefined;
    destino.pausa = new Promise((resolver) => (soltar = resolver));
    const admin = await e.login("admin");
    const primera = e.llamar("POST", RUTAS.sincronizarEspejo, admin, { completo: false });
    await new Promise((resolver) => setTimeout(resolver, 50));
    expect((await e.app.espejo.estado()).sincronizando).toBe(true);
    const segunda = await e.llamar("POST", RUTAS.sincronizarEspejo, admin, { completo: false });
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json()).toMatchObject({ codigo: "SINCRONIZACION_EN_CURSO" });
    soltar();
    expect((await primera).statusCode).toBe(200);
    expect(destino.lotes).toHaveLength(1);
  });

  it("sin espejo configurado, el servidor funciona igual y el Dashboard lo dice", async () => {
    e = await prepararEntorno("2026-09-23T14:00:00.000Z", { espejo: opciones(null) });
    const admin = await e.login("admin");
    expect(EstadoEspejoSchema.parse((await e.llamar("GET", RUTAS.estadoEspejo, admin)).json())).toMatchObject({ configurado: false, proximaEn: null });
    const r = await e.llamar("POST", RUTAS.sincronizarEspejo, admin, { completo: false });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ codigo: "ESPEJO_NO_CONFIGURADO" });
  });

  it("valida el cuerpo", async () => {
    await unDiaDeTrabajo();
    const admin = await e.login("admin");
    expect((await e.llamar("POST", RUTAS.sincronizarEspejo, admin, {})).statusCode).toBe(400);
  });
});
