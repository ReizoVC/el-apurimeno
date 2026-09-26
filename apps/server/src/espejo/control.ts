import { CodigoErrorEspejoSchema, EstadoEspejoSchema, type EstadoEspejo } from "@apurimeno/contracts";
import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "../db.js";
import { ErrorApi } from "../errores.js";
import { publicarResumen } from "./sincronizacion.js";
import { ErrorEspejo, type TransporteEspejo } from "./transporte.js";

export interface OpcionesEspejo {
  /** null: el espejo no está configurado. */
  transporte: TransporteEspejo | null;
  problemaConfiguracion: string | null;
  intervaloMinutos: number;
  versionServidor: string;
}

export const SIN_ESPEJO: OpcionesEspejo = {
  transporte: null,
  problemaConfiguracion: null,
  intervaloMinutos: 30,
  versionServidor: "desconocida",
};

/** Primera vuelta automática poco después de arrancar, sin demorar el arranque. */
const ESPERA_INICIAL_MS = 10_000;

export interface ResultadoSincronizacion {
  exito: boolean;
  diasPublicados: number;
  turnosPublicados: number;
}

export interface ControlEspejo {
  estado(): Promise<EstadoEspejo>;
  /**
   * Una vuelta de sincronización. Rechaza con ESPEJO_NO_CONFIGURADO o SINCRONIZACION_EN_CURSO; una falla del
   * espejo (sin internet, credenciales) no se lanza: queda registrada en el estado y se informa en el resultado.
   */
  sincronizar(completo: boolean): Promise<ResultadoSincronizacion>;
  /** Programa la sincronización automática cada `intervaloMinutos`. */
  iniciar(): void;
  detener(): void;
}

/**
 * Sincronización con el espejo en la nube (ADR-06): una vuelta a la vez, automática cada intervalo y a pedido
 * desde el Dashboard. Nada de esto toca la operación del local: si el espejo falla, el POS sigue igual
 * (RNF-SYNC-02).
 */
export function crearControlEspejo(
  prisma: PrismaClient,
  ahora: () => Date,
  opciones: OpcionesEspejo,
  log: FastifyBaseLogger,
): ControlEspejo {
  let enCurso: Promise<ResultadoSincronizacion> | null = null;
  let temporizador: NodeJS.Timeout | null = null;
  let proximaEn: Date | null = null;
  const intervaloMs = opciones.intervaloMinutos * 60_000;

  async function registrarFalla(inicio: Date, error: unknown): Promise<void> {
    const conocida = error instanceof ErrorEspejo;
    if (conocida) log.warn({ codigo: error.codigo }, `Espejo: ${error.message}`);
    else log.error({ err: error }, "Espejo: error interno al preparar o publicar el resumen");
    const falla = {
      ultimoIntentoEn: inicio,
      ultimoErrorCodigo: conocida ? error.codigo : "ERROR_INTERNO",
      ultimoErrorMensaje: conocida ? error.message : "Error interno al preparar el resumen; revise el registro del servidor.",
      ultimoErrorEn: inicio,
    };
    try {
      await prisma.estadoEspejo.upsert({ where: { id: 1 }, create: { id: 1, ...falla }, update: falla });
    } catch (err) {
      log.error({ err }, "Espejo: no se pudo registrar la falla");
    }
  }

  async function ejecutar(transporte: TransporteEspejo, completo: boolean): Promise<ResultadoSincronizacion> {
    const inicio = ahora();
    try {
      const r = await publicarResumen(prisma, transporte, {
        ahora: inicio,
        completo,
        intervaloMinutos: opciones.intervaloMinutos,
        versionServidor: opciones.versionServidor,
      });
      log.info({ dias: r.dias, turnos: r.turnos, completo }, "Espejo sincronizado");
      return { exito: true, diasPublicados: r.dias, turnosPublicados: r.turnos };
    } catch (error) {
      await registrarFalla(inicio, error);
      return { exito: false, diasPublicados: 0, turnosPublicados: 0 };
    }
  }

  const control: ControlEspejo = {
    async estado() {
      const fila = await prisma.estadoEspejo.findUnique({ where: { id: 1 } });
      const codigo = CodigoErrorEspejoSchema.catch("ERROR_INTERNO").parse(fila?.ultimoErrorCodigo);
      return EstadoEspejoSchema.parse({
        configurado: opciones.transporte !== null,
        problemaConfiguracion: opciones.problemaConfiguracion,
        intervaloMinutos: opciones.intervaloMinutos,
        sincronizando: enCurso !== null,
        ultimoIntentoEn: fila?.ultimoIntentoEn?.toISOString() ?? null,
        ultimoExitoEn: fila?.ultimoExitoEn?.toISOString() ?? null,
        ultimoError:
          fila?.ultimoErrorEn == null || fila.ultimoErrorCodigo === null
            ? null
            : { codigo, mensaje: fila.ultimoErrorMensaje ?? "", ocurridoEn: fila.ultimoErrorEn.toISOString() },
        proximaEn: opciones.transporte === null ? null : (proximaEn?.toISOString() ?? null),
      });
    },

    sincronizar(completo) {
      const transporte = opciones.transporte;
      if (transporte === null) {
        throw new ErrorApi(
          "ESPEJO_NO_CONFIGURADO",
          opciones.problemaConfiguracion ?? "El espejo en la nube no está configurado en este servidor (variables ESPEJO_*).",
        );
      }
      if (enCurso !== null) {
        throw new ErrorApi("SINCRONIZACION_EN_CURSO", "Ya hay una sincronización en curso; espere unos segundos y vuelva a intentarlo.");
      }
      const vuelta = ejecutar(transporte, completo).finally(() => {
        enCurso = null;
      });
      enCurso = vuelta;
      return vuelta;
    },

    iniciar() {
      if (opciones.transporte === null || temporizador !== null) return;
      const programar = (esperaMs: number) => {
        proximaEn = new Date(Date.now() + esperaMs);
        temporizador = setTimeout(() => {
          // Si hay una manual en curso, esta vuelta se salta: la siguiente llega en un intervalo.
          if (enCurso === null) void control.sincronizar(false);
          programar(intervaloMs);
        }, esperaMs);
        temporizador.unref();
      };
      programar(ESPERA_INICIAL_MS);
    },

    detener() {
      if (temporizador !== null) clearTimeout(temporizador);
      temporizador = null;
      proximaEn = null;
    },
  };
  return control;
}
