import {
  EstadoActualizacionSchema,
  ManifiestoVersionSchema,
  type EstadoActualizacion,
  type EstadoRevisionVersion,
  type VersionDisponible,
} from "@apurimeno/contracts";
import { versionDisponible } from "@apurimeno/domain";
import type { FastifyBaseLogger } from "fastify";
import type { ConfiguracionActualizacion } from "./configuracion.js";
import { firmaValida } from "./firma.js";
import { publicacionDeGitHub, type ObtenerPublicacion, type PublicacionEncontrada } from "./github.js";

const MINUTO_MS = 60_000;
const ESPERA_INICIAL_MS = 30_000;
const INTERVALO_MS = 6 * 60 * MINUTO_MS;
/** Sin internet se reintenta antes: al volver la conexión, el aviso no espera 6 horas. */
const REINTENTO_MS = 30 * MINUTO_MS;

export interface OpcionesActualizacion extends ConfiguracionActualizacion {
  /** Las pruebas lo reemplazan: nunca salen a internet. */
  obtenerPublicacion?: ObtenerPublicacion;
}

export interface ControlActualizacion {
  estado(): EstadoActualizacion;
  /** Una revisión. false si no se pudo consultar: el estado sigue siendo el de la última que sí se pudo. */
  revisar(): Promise<boolean>;
  iniciar(): void;
  detener(): void;
}

/** Revisa si hay una versión nueva, firmada y posterior a la instalada (decisión 30). Nada de esto toca la operación. */
export function crearControlActualizacion(opciones: OpcionesActualizacion, ahora: () => Date, log: FastifyBaseLogger): ControlActualizacion {
  const { clavePublica, versionInstalada } = opciones;
  const obtener = opciones.obtenerPublicacion ?? publicacionDeGitHub;
  const configurado = clavePublica !== null && versionInstalada !== null;
  let estado: EstadoRevisionVersion = configurado ? "AL_DIA" : "SIN_CONFIGURAR";
  let disponible: VersionDisponible | null = null;
  let ultimaRevisionEn: Date | null = null;
  let temporizador: NodeJS.Timeout | null = null;
  let detenido = true;

  /** Lo publicado, solo si la firma es buena y es de la versión que dice su etiqueta. */
  function manifiestoVerificado(publicacion: PublicacionEncontrada) {
    const { manifiesto, firma, etiqueta } = publicacion;
    if (manifiesto === null || firma === null || clavePublica === null || !firmaValida(manifiesto, firma, clavePublica)) return null;
    try {
      const leido = ManifiestoVersionSchema.parse(JSON.parse(manifiesto.toString("utf8")));
      return etiqueta === `v${leido.version}` ? leido : null;
    } catch {
      return null;
    }
  }

  const control: ControlActualizacion = {
    estado() {
      return EstadoActualizacionSchema.parse({ estado, instalada: versionInstalada, disponible, ultimaRevisionEn: ultimaRevisionEn?.toISOString() ?? null });
    },

    async revisar() {
      if (!configurado) return false;
      let publicacion: PublicacionEncontrada | null;
      try {
        publicacion = await obtener();
      } catch (err) {
        log.warn({ err }, "Actualización: no se pudo consultar la última versión");
        return false;
      }
      ultimaRevisionEn = ahora();
      if (publicacion === null) {
        estado = "AL_DIA";
        disponible = null;
        return true;
      }
      const manifiesto = manifiestoVerificado(publicacion);
      if (manifiesto === null) {
        if (estado !== "FIRMA_INVALIDA") log.error({ etiqueta: publicacion.etiqueta }, "Actualización: lo publicado no pasó la verificación de firma");
        estado = "FIRMA_INVALIDA";
        disponible = null;
        return true;
      }
      disponible = versionDisponible(versionInstalada, manifiesto);
      estado = disponible === null ? "AL_DIA" : "DISPONIBLE";
      return true;
    },

    iniciar() {
      if (!detenido || !configurado) return;
      detenido = false;
      const vuelta = async () => {
        if (detenido) return;
        const exito = await control.revisar();
        if (detenido) return;
        temporizador = setTimeout(() => void vuelta(), exito ? INTERVALO_MS : REINTENTO_MS);
        temporizador.unref();
      };
      temporizador = setTimeout(() => void vuelta(), ESPERA_INICIAL_MS);
      temporizador.unref();
    },

    detener() {
      detenido = true;
      if (temporizador !== null) clearTimeout(temporizador);
      temporizador = null;
    },
  };
  return control;
}
