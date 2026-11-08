import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EstadoActualizacionSchema,
  type EstadoActualizacion,
  type EstadoRevisionVersion,
  type UltimaInstalacion,
  type VersionDisponible,
} from "@apurimeno/contracts";
import { ErrorNegocio, exigirVersionInstalable, versionDisponible } from "@apurimeno/domain";
import type { FastifyBaseLogger } from "fastify";
import type { ConfiguracionActualizacion } from "./configuracion.js";
import { manifiestoVerificado } from "./firma.js";
import { publicacionDeGitHub, type ObtenerPublicacion, type PublicacionEncontrada } from "./github.js";

const MINUTO_MS = 60_000;
const ESPERA_INICIAL_MS = 30_000;
const INTERVALO_MS = 6 * 60 * MINUTO_MS;
/** Sin internet se reintenta antes: al volver la conexión, el aviso no espera 6 horas. */
const REINTENTO_MS = 30 * MINUTO_MS;
/** El tiempo máximo de la tarea (actualizar-produccion.ps1): después de esto, "en curso" ya no es cierto. */
const TIEMPO_MAXIMO_TAREA_MS = 2 * 60 * MINUTO_MS;
const TAREA = "ApurimenoActualizacion";
const CARPETA_POR_DEFECTO = fileURLToPath(new URL("../../datos/actualizaciones", import.meta.url));

export interface OpcionesActualizacion extends ConfiguracionActualizacion {
  /** Las pruebas lo reemplazan: nunca salen a internet. */
  obtenerPublicacion?: ObtenerPublicacion;
  /** Las pruebas lo reemplazan: nunca lanzan la tarea real. */
  lanzarTarea?: () => Promise<void>;
  /** Donde el servidor y actualizar-produccion.ps1 dejan la orden y el resultado. */
  carpeta?: string;
}

export interface ControlActualizacion {
  estado(): EstadoActualizacion;
  /** Una revisión. false si no se pudo consultar: el estado sigue siendo el de la última que sí se pudo. */
  revisar(): Promise<boolean>;
  /** Comprueba que se pueda instalar: el llamador registra la auditoría antes de `instalar`. */
  comprobarInstalable(version: string): void;
  /** Deja la orden y lanza la tarea. Si no se puede lanzar, lanza un error y queda en el estado. */
  instalar(version: string): Promise<void>;
  iniciar(): void;
  detener(): void;
}

/** Lanza la tarea que registró `actualizar-produccion.ps1 -RegistrarTarea`. Sin shell: el nombre es fijo. */
const lanzarTareaProgramada = () =>
  new Promise<void>((resolver, rechazar) => {
    execFile("schtasks", ["/Run", "/TN", TAREA], { windowsHide: true, timeout: 30_000 }, (error) => (error === null ? resolver() : rechazar(error)));
  });

/**
 * Revisa si hay una versión nueva, firmada y posterior a la instalada, y lanza su instalación (decisión 30). Revisar no
 * toca la operación. Instalar la detiene unos minutos: la decide alguien en el Dashboard.
 */
export function crearControlActualizacion(opciones: OpcionesActualizacion, ahora: () => Date, log: FastifyBaseLogger): ControlActualizacion {
  const { clavePublica, versionInstalada } = opciones;
  const obtener = opciones.obtenerPublicacion ?? publicacionDeGitHub;
  const lanzarTarea = opciones.lanzarTarea ?? lanzarTareaProgramada;
  const carpeta = opciones.carpeta ?? CARPETA_POR_DEFECTO;
  const archivoEstado = join(carpeta, "estado.json");
  const archivoOrden = join(carpeta, "orden.json");
  const configurado = clavePublica !== null && versionInstalada !== null;
  let estado: EstadoRevisionVersion = configurado ? "AL_DIA" : "SIN_CONFIGURAR";
  let disponible: VersionDisponible | null = null;
  let ultimaRevisionEn: Date | null = null;
  let temporizador: NodeJS.Timeout | null = null;
  let detenido = true;

  /** El mismo archivo que escribe actualizar-produccion.ps1, con BOM. La hora es la del archivo: no depende del formato. */
  function leerUltimaInstalacion(): UltimaInstalacion | null {
    if (!configurado) return null;
    try {
      const texto = readFileSync(archivoEstado, "utf8").replace(/^﻿/, "");
      const { resultado, version, mensaje } = JSON.parse(texto) as { resultado?: unknown; version?: unknown; mensaje?: unknown };
      const actualizadaEn = statSync(archivoEstado).mtime;
      const base = { version: String(version ?? ""), mensaje: typeof mensaje === "string" && mensaje !== "" ? mensaje : null, actualizadaEn: actualizadaEn.toISOString() };
      if (resultado === "ok") return { resultado: "OK", ...base };
      if (resultado === "error") return { resultado: "ERROR", ...base };
      if (resultado !== "en-curso") return null;
      return { resultado: ahora().getTime() - actualizadaEn.getTime() > TIEMPO_MAXIMO_TAREA_MS ? "CORTADA" : "EN_CURSO", ...base };
    } catch {
      return null; // Todavía no se actualizó con este sistema, o el archivo se está escribiendo.
    }
  }

  function guardarEstado(resultado: "en-curso" | "error", version: string, mensaje: string): void {
    writeFileSync(archivoEstado, JSON.stringify({ resultado, version: `v${version}`, mensaje }), "utf8");
  }

  const control: ControlActualizacion = {
    estado() {
      return EstadoActualizacionSchema.parse({
        estado,
        instalada: versionInstalada,
        disponible,
        ultimaRevisionEn: ultimaRevisionEn?.toISOString() ?? null,
        ultimaInstalacion: leerUltimaInstalacion(),
      });
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
      const manifiesto = manifiestoVerificado(publicacion, clavePublica);
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

    comprobarInstalable(version) {
      exigirVersionInstalable(control.estado(), version);
    },

    async instalar(version) {
      exigirVersionInstalable(control.estado(), version);
      mkdirSync(carpeta, { recursive: true });
      // El POS se cierra siempre: abierto, bloquearía la actualización. Quien pulsó ya lo confirmó en el Dashboard.
      writeFileSync(archivoOrden, JSON.stringify({ version: `v${version}`, cerrarPOS: true }), "utf8");
      guardarEstado("en-curso", version, "");
      try {
        await lanzarTarea();
      } catch (err) {
        log.error({ err }, "Actualización: no se pudo lanzar la tarea");
        const mensaje = `No se pudo lanzar la actualización. ¿Se corrió actualizar-produccion.ps1 -RegistrarTarea en este equipo? No se tocó nada.`;
        guardarEstado("error", version, mensaje);
        throw new ErrorNegocio("INVALID_STATE_TRANSITION", mensaje);
      }
      log.warn({ version }, "Actualización: lanzada desde el Dashboard");
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
