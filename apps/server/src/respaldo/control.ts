import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  EstadoRespaldosSchema,
  INTERVALO_RESPALDO_LOCAL_MINUTOS,
  RETENCION_RESPALDO_EXTERNO_DIAS,
  RETENCION_RESPALDO_LOCAL_HORAS,
  type DestinoRespaldo,
  type EstadoCopiaRespaldo,
  type EstadoRespaldos,
} from "@apurimeno/contracts";
import { proximaCitaRespaldoExterno, proximaCopiaLocal, respaldoExternoPendiente, respaldosVencidos } from "@apurimeno/domain";
import type { FastifyBaseLogger } from "fastify";
import { ErrorApi } from "../errores.js";
import { cifrarArchivo } from "./cifrado.js";
import type { ConfiguracionRespaldos } from "./configuracion.js";
import { clasificarError, limpiarParciales, listarCopias, nombreCopia, SUFIJO_PARCIAL, tomarCopia, type CopiaGuardada } from "./copia.js";

export const SIN_RESPALDOS: ConfiguracionRespaldos = {
  rutaBase: ":memory:",
  carpetaLocal: null,
  externo: null,
  carpetaExternaConfigurada: null,
  problemaExterno: null,
};

const MINUTO_MS = 60_000;
const INTERVALO_LOCAL_MS = INTERVALO_RESPALDO_LOCAL_MINUTOS * MINUTO_MS;
/** Si la copia externa falla, se reintenta con esta frecuencia hasta que salga. */
const REINTENTO_EXTERNO_MS = INTERVALO_LOCAL_MS;
/** Primera vuelta poco después de arrancar, sin demorar el arranque. */
const ESPERA_INICIAL_MS = 10_000;
/** Aunque no toque nada, el programador revisa al menos cada minuto: sobrevive a cambios de hora y suspensiones. */
const REVISION_MAXIMA_MS = MINUTO_MS;
const RETENCION_MS: Record<DestinoRespaldo, number> = {
  LOCAL: RETENCION_RESPALDO_LOCAL_HORAS * 60 * MINUTO_MS,
  EXTERNO: RETENCION_RESPALDO_EXTERNO_DIAS * 24 * 60 * MINUTO_MS,
};

interface Seguimiento {
  copiando: boolean;
  ultimoIntentoEn: Date | null;
  ultimoError: EstadoCopiaRespaldo["ultimoError"];
}

export interface ControlRespaldos {
  estado(): Promise<EstadoRespaldos>;
  /**
   * Una copia. Rechaza con RESPALDO_NO_CONFIGURADO o RESPALDO_EN_CURSO; una falla al copiar (disco lleno, carpeta
   * inaccesible) no se lanza: queda en el estado y el resultado es `false`.
   */
  respaldar(destino: DestinoRespaldo): Promise<boolean>;
  /** Programa las copias automáticas: locales cada 15 minutos, la externa a las 04:00 de Lima. */
  iniciar(): void;
  detener(): void;
}

/**
 * Respaldos de la base (Planos §14.3, RNF-BKP-01). Una copia a la vez. Nada de esto toca la operación: si una copia
 * falla, el POS sigue igual y el Dashboard lo muestra.
 */
export function crearControlRespaldos(config: ConfiguracionRespaldos, ahora: () => Date, log: FastifyBaseLogger): ControlRespaldos {
  const carpeta: Record<DestinoRespaldo, string | null> = { LOCAL: config.carpetaLocal, EXTERNO: config.externo?.carpeta ?? null };
  const seguimiento: Record<DestinoRespaldo, Seguimiento> = {
    LOCAL: { copiando: false, ultimoIntentoEn: null, ultimoError: null },
    EXTERNO: { copiando: false, ultimoIntentoEn: null, ultimoError: null },
  };
  // Una copia a la vez: la externa toma su propia foto y no debe competir por el disco con la local.
  let cola: Promise<unknown> = Promise.resolve();
  let temporizador: NodeJS.Timeout | null = null;
  let detenido = true;

  async function copias(destino: DestinoRespaldo): Promise<CopiaGuardada[]> {
    const dir = carpeta[destino];
    if (dir === null) return [];
    try {
      return await listarCopias(dir, destino);
    } catch {
      return []; // carpeta inexistente o desconectada: el próximo intento lo informa
    }
  }

  async function ejecutar(destino: DestinoRespaldo): Promise<boolean> {
    const dir = carpeta[destino];
    if (dir === null) return false;
    const inicio = ahora();
    const s = seguimiento[destino];
    s.ultimoIntentoEn = inicio;
    try {
      // La carpeta local se crea sola; la externa no: si no existe, la unidad o la sincronización no están.
      if (config.carpetaLocal !== null) await mkdir(config.carpetaLocal, { recursive: true });
      await limpiarParciales(dir);
      const nombre = nombreCopia(destino, inicio);
      if (destino === "LOCAL") {
        await tomarCopia(config.rutaBase, join(dir, nombre));
      } else {
        // La foto se toma junto a las locales (disco del equipo) y sale ya cifrada: nada sin cifrar pasa por la
        // carpeta sincronizada.
        const temporal = join(config.carpetaLocal ?? dir, `${nombreCopia("LOCAL", inicio)}.externa${SUFIJO_PARCIAL}`);
        try {
          await tomarCopia(config.rutaBase, temporal);
          const parcial = join(dir, nombre + SUFIJO_PARCIAL);
          await cifrarArchivo(temporal, parcial, config.externo!.clavePublica);
          await rename(parcial, join(dir, nombre));
        } finally {
          await rm(temporal, { force: true });
        }
      }
      s.ultimoError = null;
      log.info({ destino, archivo: nombre }, "Respaldo: copia hecha");
      await aplicarRetencion(destino);
      return true;
    } catch (error) {
      const e = clasificarError(error);
      if (e.codigo === "ERROR_INTERNO") log.error({ err: error, destino }, "Respaldo: error al copiar");
      else log.warn({ destino, codigo: e.codigo }, `Respaldo: ${e.message}`);
      s.ultimoError = { codigo: e.codigo, mensaje: e.message, ocurridoEn: inicio.toISOString() };
      return false;
    }
  }

  async function aplicarRetencion(destino: DestinoRespaldo): Promise<void> {
    for (const vencida of respaldosVencidos(await copias(destino), ahora(), RETENCION_MS[destino])) {
      try {
        await rm(vencida.ruta, { force: true });
      } catch (err) {
        log.warn({ err, archivo: vencida.nombre }, "Respaldo: no se pudo borrar una copia vencida");
      }
    }
  }

  const ultimaCopia = async (destino: DestinoRespaldo) => (await copias(destino)).at(-1) ?? null;

  /** Cuándo toca la próxima copia de cada destino, o null si no está configurado. */
  async function proximas(): Promise<Record<DestinoRespaldo, Date | null>> {
    const t = ahora();
    const local = carpeta.LOCAL === null ? null : proximaCopiaLocal(seguimiento.LOCAL.ultimoIntentoEn?.toISOString() ?? null, t);
    let externo: Date | null = null;
    if (carpeta.EXTERNO !== null) {
      const ultima = await ultimaCopia("EXTERNO");
      if (respaldoExternoPendiente(ultima?.creadoEn ?? null, t)) {
        const intento = seguimiento.EXTERNO.ultimoIntentoEn;
        externo = intento === null ? t : new Date(Math.max(t.getTime(), intento.getTime() + REINTENTO_EXTERNO_MS));
      } else {
        externo = proximaCitaRespaldoExterno(t);
      }
    }
    return { LOCAL: local, EXTERNO: externo };
  }

  const control: ControlRespaldos = {
    async estado() {
      const siguientes = await proximas();
      const estadoDe = async (destino: DestinoRespaldo): Promise<EstadoCopiaRespaldo> => {
        const guardadas = await copias(destino);
        const ultima = guardadas.at(-1) ?? null;
        const s = seguimiento[destino];
        return {
          configurado: carpeta[destino] !== null,
          problemaConfiguracion: destino === "EXTERNO" ? config.problemaExterno : null,
          carpeta: carpeta[destino] ?? (destino === "EXTERNO" ? config.carpetaExternaConfigurada : null),
          copiando: s.copiando,
          ultimoExitoEn: ultima?.creadoEn ?? null,
          ultimoArchivo: ultima?.nombre ?? null,
          ultimoTamanoBytes: ultima?.tamanoBytes ?? null,
          copiasGuardadas: guardadas.length,
          ultimoIntentoEn: s.ultimoIntentoEn?.toISOString() ?? null,
          ultimoError: s.ultimoError,
          proximaEn: detenido ? null : (siguientes[destino]?.toISOString() ?? null),
        };
      };
      return EstadoRespaldosSchema.parse({ local: await estadoDe("LOCAL"), externo: await estadoDe("EXTERNO") });
    },

    respaldar(destino) {
      if (carpeta[destino] === null) {
        throw new ErrorApi(
          "RESPALDO_NO_CONFIGURADO",
          destino === "EXTERNO"
            ? (config.problemaExterno ?? "La copia externa no está configurada (RESPALDO_CARPETA_EXTERNA y RESPALDO_CLAVE_PUBLICA).")
            : "Las copias locales no están disponibles con una base en memoria.",
        );
      }
      const s = seguimiento[destino];
      if (s.copiando) throw new ErrorApi("RESPALDO_EN_CURSO", "Ya hay una copia en curso; espere unos segundos y vuelva a intentarlo.");
      s.copiando = true;
      const vuelta = cola.then(() => ejecutar(destino)).finally(() => {
        s.copiando = false;
      });
      cola = vuelta.catch(() => undefined);
      return vuelta;
    },

    iniciar() {
      if (!detenido) return;
      detenido = false;
      const revisar = async () => {
        if (detenido) return;
        try {
          const siguientes = await proximas();
          const t = ahora().getTime();
          for (const destino of ["LOCAL", "EXTERNO"] as const) {
            const cuando = siguientes[destino];
            if (cuando !== null && cuando.getTime() <= t && !seguimiento[destino].copiando) void control.respaldar(destino);
          }
          await cola;
        } catch (err) {
          log.error({ err }, "Respaldo: error en el programador");
        }
        if (detenido) return;
        const siguientes = await proximas().catch(() => ({ LOCAL: null, EXTERNO: null }));
        const t = ahora().getTime();
        const espera = Math.min(
          REVISION_MAXIMA_MS,
          ...Object.values(siguientes)
            .filter((d): d is Date => d !== null)
            .map((d) => Math.max(0, d.getTime() - t)),
        );
        temporizador = setTimeout(() => void revisar(), espera);
        temporizador.unref();
      };
      // Tras un reinicio, la próxima copia local cuenta desde la última guardada, no desde el arranque.
      void ultimaCopia("LOCAL").then((ultima) => {
        if (ultima !== null && seguimiento.LOCAL.ultimoIntentoEn === null) seguimiento.LOCAL.ultimoIntentoEn = new Date(ultima.creadoEn);
        temporizador = setTimeout(() => void revisar(), ESPERA_INICIAL_MS);
        temporizador.unref();
      });
    },

    detener() {
      detenido = true;
      if (temporizador !== null) clearTimeout(temporizador);
      temporizador = null;
    },
  };
  return control;
}
