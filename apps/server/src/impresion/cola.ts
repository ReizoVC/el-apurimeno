import type { CausaFallaImpresora, EstadoImpresora } from "@apurimeno/contracts";
import { componerLineasComprobante } from "@apurimeno/domain";
import type { PrismaClient, Transaccion } from "../db.js";
import { INCLUIR_TICKET, aConfiguracion, aMetodoPago, aTicket } from "../mapeo.js";
import { causaDeError } from "./estado.js";
import { comandosComprobante, OPCIONES_ESCPOS_POR_DEFECTO, PUNTOS_POR_LINEA, type OpcionesEscPos } from "./escpos.js";
import { conReintentos, ESPERAS_REINTENTO_CONEXION_MS, type TransporteImpresora } from "./transporte.js";

// Cola de impresión (ADR-05, RF-56). El trabajo se crea en la misma transacción que el cobro, así ningún cobro
// queda sin comprobante; se envía después de responder, y una falla de la impresora nunca revierte el cobro.

/** Encola el comprobante de un ticket (original o copia) dentro de la transacción del cobro. */
export async function encolarComprobante(tx: Transaccion, ticketId: string, esCopia: boolean, ahora: Date, id: string): Promise<string> {
  await tx.trabajoImpresion.create({ data: { id, ticketId, estado: "PENDIENTE", esCopia, creadoEn: ahora } });
  return id;
}

export interface Registro {
  info(datos: object, mensaje: string): void;
  warn(datos: object, mensaje: string): void;
  error(datos: object, mensaje: string): void;
}

/**
 * Reintento automático (RF-56, §20.5 "Error → Pendiente"): cada 30 s, los comprobantes en PENDIENTE o ERROR de
 * los últimos 15 minutos. Pasado ese plazo el cliente ya no está en el mostrador: el trabajo queda en ERROR y, si
 * hace falta, se reimprime una copia (CU-22). Así, una impresora apagada toda la noche no imprime de golpe los
 * comprobantes de horas atrás al encenderla.
 */
export const REINTENTO_AUTOMATICO = { cadaMs: 30_000, ventanaMs: 15 * 60_000 } as const;

/** Errores de configuración al arrancar: el servidor arrancó igual, y el estado los muestra (decisión 26). */
export interface ProblemasImpresion {
  configuracion: string | null;
  logo: string | null;
}

export interface OpcionesCola {
  prisma: PrismaClient;
  /** null: sin impresora configurada; los comprobantes quedan PENDIENTE. */
  transporte: TransporteImpresora | null;
  registro: Registro;
  ahora: () => Date;
  opcionesEscPos?: OpcionesEscPos;
  /** Instancia de capacitación: todo comprobante lleva la marca "CAPACITACIÓN". */
  esCapacitacion?: boolean;
  /** Esperas entre intentos de conexión (transporte.ts); las pruebas las acortan. */
  esperasReintentoMs?: readonly number[];
  problemas?: ProblemasImpresion;
}

export interface ColaImpresion {
  /** Envía los comprobantes en cola de un ticket, sin esperar ni fallar (RF-56). */
  imprimir(ticketId: string): void;
  /** "Reintentar ahora": envía los comprobantes en espera o, si no hay, comprueba la impresora. */
  reintentar(): Promise<EstadoImpresora>;
  estado(): Promise<EstadoImpresora>;
  /** Promesa del último envío encolado: las pruebas la esperan antes de revisar el resultado. */
  terminada(): Promise<void>;
  /** Reintento automático cada `REINTENTO_AUTOMATICO.cadaMs`. */
  iniciar(): void;
  detener(): void;
}

interface Trabajo {
  id: string;
  ticketId: string;
  estado: string;
  esCopia: boolean;
}

export function crearColaImpresion(o: OpcionesCola): ColaImpresion {
  const opcionesEscPos = o.opcionesEscPos ?? OPCIONES_ESCPOS_POR_DEFECTO;
  const esperas = o.esperasReintentoMs ?? ESPERAS_REINTENTO_CONEXION_MS;
  // Un envío a la vez: dos cobros casi simultáneos no deben mezclar sus bytes en la misma impresora.
  let cadena: Promise<void> = Promise.resolve();
  let ultimo: { causa: CausaFallaImpresora | null; en: Date } | null = null;
  let temporizador: NodeJS.Timeout | null = null;
  let cicloEnCola = false;

  const encadenar = (tarea: () => Promise<void>): Promise<void> => {
    cadena = cadena.then(tarea).catch((err: unknown) => o.registro.error({ err }, "Error en la cola de impresión"));
    return cadena;
  };

  const filtroEnEspera = () => ({
    estado: { in: ["PENDIENTE" as const, "ERROR" as const] },
    creadoEn: { gte: new Date(o.ahora().getTime() - REINTENTO_AUTOMATICO.ventanaMs) },
  });

  async function bytesDe(trabajo: Trabajo): Promise<Uint8Array> {
    const ticket = aTicket(await o.prisma.ticket.findUniqueOrThrow({ where: { id: trabajo.ticketId }, include: INCLUIR_TICKET }));
    const { comprobante, impresora } = aConfiguracion(await o.prisma.configuracionGlobal.findUniqueOrThrow({ where: { id: 1 } }));
    const metodosPago = (await o.prisma.metodoPago.findMany()).map(aMetodoPago);
    const lineas = componerLineasComprobante(ticket, {
      datos: comprobante,
      anchoPapelMm: impresora.anchoPapelMm,
      metodosPago,
      esCopia: trabajo.esCopia,
      esCapacitacion: o.esCapacitacion === true,
    });
    let logo = opcionesEscPos.logo ?? null;
    if (logo !== null && logo.ancho > PUNTOS_POR_LINEA[impresora.anchoPapelMm]) {
      o.registro.warn({ anchoLogo: logo.ancho, anchoPapelMm: impresora.anchoPapelMm }, "El logotipo no cabe en el papel: se imprime sin él");
      logo = null;
    }
    return comandosComprobante(lineas, { ...opcionesEscPos, logo });
  }

  /**
   * Envía los trabajos en orden. Al primero que falla, se detiene: con la impresora sin papel o desconectada, los
   * siguientes fallarían igual. Los que no se intentaron quedan como estaban, y el reintento automático los toma.
   */
  async function enviar(trabajos: readonly Trabajo[]): Promise<void> {
    const transporte = o.transporte;
    if (transporte === null) return;
    for (const trabajo of trabajos) {
      // §20.5: un trabajo con error vuelve a pendiente para reintentarse.
      if (trabajo.estado === "ERROR") await o.prisma.trabajoImpresion.update({ where: { id: trabajo.id }, data: { estado: "PENDIENTE" } });
      try {
        const bytes = await bytesDe(trabajo);
        await conReintentos(
          () => transporte.enviar(bytes),
          esperas,
          undefined,
          (err, espera) => o.registro.warn({ err, trabajoId: trabajo.id, esperaMs: espera }, "Sin conexión con la impresora; se reintenta"),
        );
        await o.prisma.trabajoImpresion.update({ where: { id: trabajo.id }, data: { estado: "IMPRESO" } });
        ultimo = { causa: null, en: o.ahora() };
      } catch (err) {
        const causa = causaDeError(err);
        await o.prisma.trabajoImpresion.update({ where: { id: trabajo.id }, data: { estado: "ERROR" } });
        ultimo = { causa, en: o.ahora() };
        o.registro.error({ err, causa, ticketId: trabajo.ticketId, trabajoId: trabajo.id, transporte: transporte.descripcion }, "Falló la impresión del comprobante");
        return;
      }
    }
  }

  async function comprobar(): Promise<void> {
    if (o.transporte === null) return;
    try {
      await o.transporte.comprobar();
      ultimo = { causa: null, en: o.ahora() };
    } catch (err) {
      ultimo = { causa: causaDeError(err), en: o.ahora() };
      o.registro.warn({ err, causa: ultimo.causa }, "La impresora no está lista");
    }
  }

  const enEspera = () => o.prisma.trabajoImpresion.findMany({ where: filtroEnEspera(), orderBy: { creadoEn: "asc" } });

  const cola: ColaImpresion = {
    imprimir(ticketId) {
      void encadenar(async () => {
        const trabajos = await o.prisma.trabajoImpresion.findMany({ where: { ticketId, estado: "PENDIENTE" }, orderBy: { creadoEn: "asc" } });
        if (trabajos.length === 0) return;
        if (o.transporte === null) {
          o.registro.info({ ticketId, trabajos: trabajos.length }, "Comprobante en cola: no hay impresora configurada (IMPRESORA_DISPOSITIVO)");
          return;
        }
        await enviar(trabajos);
      });
    },

    async reintentar() {
      await encadenar(async () => {
        const trabajos = await enEspera();
        if (trabajos.length > 0) await enviar(trabajos);
        else await comprobar();
      });
      return cola.estado();
    },

    async estado() {
      return {
        configurada: o.transporte !== null,
        causa: ultimo?.causa ?? null,
        comprobantesEnEspera: await o.prisma.trabajoImpresion.count({ where: filtroEnEspera() }),
        ultimoIntento: ultimo?.en.toISOString() ?? null,
        problemaConfiguracion: o.problemas?.configuracion ?? null,
        problemaLogo: o.problemas?.logo ?? null,
      };
    },

    terminada: () => cadena,

    iniciar() {
      if (o.transporte === null || temporizador !== null) return;
      const vuelta = () => {
        // Si la vuelta anterior sigue en la cola (una impresora que tarda en responder), no se apila otra.
        if (cicloEnCola) return;
        cicloEnCola = true;
        void encadenar(async () => {
          try {
            const trabajos = await enEspera();
            if (trabajos.length > 0) await enviar(trabajos);
          } finally {
            cicloEnCola = false;
          }
        });
      };
      // La primera, al arrancar: lo que quedó pendiente al reiniciar el servidor sale sin esperar 30 s.
      vuelta();
      temporizador = setInterval(vuelta, REINTENTO_AUTOMATICO.cadaMs);
      temporizador.unref();
    },

    detener() {
      if (temporizador !== null) clearInterval(temporizador);
      temporizador = null;
    },
  };
  return cola;
}
