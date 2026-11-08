"use client";

import { useCallback, useEffect, useState } from "react";
import type { EstadoActualizacion } from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import { mensajeDe, servidor } from "../lib/servidor";
import { Aviso } from "./comunes";

const CADA_10_MINUTOS = 10 * 60_000;
const CADA_3_SEGUNDOS = 3_000;
/** La completa tarda minutos. Pasado esto, se avisa, aunque siga intentando leer el resultado. */
const ESPERA_MAXIMA_MS = 20 * 60_000;

const CLASE_AVISO =
  "flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900";

/**
 * Versiones nuevas e instalación (decisión 30 de contracts), arriba de todas las secciones, para quien tenga
 * `system.update`. Mientras se instala, el servidor y esta misma app se reinician: la página ya cargada sigue esperando y
 * un error al consultar no se muestra, porque es lo normal en ese momento.
 */
export function AvisoActualizacion() {
  const [estado, setEstado] = useState<EstadoActualizacion | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Hora en que se lanzó desde esta página: de ahí sale el mensaje final y el tiempo de espera. */
  const [lanzadaEn, setLanzadaEn] = useState<number | null>(null);
  const [demorada, setDemorada] = useState(false);

  const enCurso = estado?.ultimaInstalacion?.resultado === "EN_CURSO";
  const esperando = lanzadaEn !== null && (enCurso || estado === null);

  const leer = useCallback(async () => {
    try {
      setEstado(await servidor.estadoActualizacion());
    } catch {
      // Sin servidor no hay nada que mostrar: la sección ya lo avisa, y durante una instalación es lo esperado.
    }
  }, []);

  useEffect(() => {
    void leer();
    const temporizador = setInterval(
      () => {
        void leer();
        if (lanzadaEn !== null && Date.now() - lanzadaEn > ESPERA_MAXIMA_MS) {
          setDemorada(true);
        }
      },
      enCurso || lanzadaEn !== null ? CADA_3_SEGUNDOS : CADA_10_MINUTOS,
    );
    return () => clearInterval(temporizador);
  }, [leer, enCurso, lanzadaEn]);

  const instalar = async (version: string) => {
    setEnviando(true);
    setError(null);
    try {
      setEstado(await servidor.instalarActualizacion(version));
      setLanzadaEn(Date.now());
      setConfirmando(false);
    } catch (e) {
      setError(mensajeDe(e));
      await leer();
    } finally {
      setEnviando(false);
    }
  };

  if (estado === null) return null;
  const { disponible, ultimaInstalacion: ultima } = estado;

  if (enCurso || esperando) {
    return (
      <div role="status" className={CLASE_AVISO}>
        <p className="font-medium">
          Actualizando el sistema
          {ultima !== null && ` a ${ultima.version}`}…
        </p>
        <p>
          No cierre esta página ni apague el equipo. Mientras tanto no se puede
          cobrar, y puede parecer que el sistema dejó de responder.
        </p>
        {demorada && (
          <p className="font-medium">
            Está tardando más de lo normal. Avise a Reizo.
          </p>
        )}
      </div>
    );
  }

  if (lanzadaEn !== null && ultima?.resultado === "OK") {
    return (
      <div role="status" className={CLASE_AVISO}>
        <p className="font-medium">
          El sistema se actualizó a {ultima.version}.
        </p>
        <p>
          Vuelva a abrir el POS: la actualización lo cerró y no se abre solo.
        </p>
        <div>
          <Button size="sm" onClick={() => window.location.reload()}>
            Recargar esta página
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {estado.estado === "FIRMA_INVALIDA" && (
        <Aviso tipo="error">
          Se encontró una versión publicada que no pasó la verificación de
          firma. No se ofrece ni se instala. Avise a Reizo.
        </Aviso>
      )}
      {(ultima?.resultado === "ERROR" || ultima?.resultado === "CORTADA") && (
        <Aviso tipo="error">
          La actualización a {ultima.version} no terminó bien.{" "}
          {ultima.resultado === "CORTADA"
            ? "Se cortó antes de terminar: ¿se apagó el equipo?"
            : ultima.mensaje}{" "}
          Avise a Reizo.
        </Aviso>
      )}
      {error !== null && (
        <Aviso tipo="error" onCerrar={() => setError(null)}>
          {error}
        </Aviso>
      )}
      {disponible !== null && (
        <div role="status" className={CLASE_AVISO}>
          <p className="font-medium">
            Hay una versión nueva del sistema: {disponible.version}
          </p>
          <p className="whitespace-pre-line">{disponible.notas}</p>
          {confirmando ? (
            <>
              <ul className="list-disc pl-5">
                <li>
                  {disponible.completa
                    ? "El sistema queda varios minutos sin poder cobrar."
                    : "El sistema queda cerca de 1 minuto sin poder cobrar."}
                </li>
                <li>
                  El POS se cierra: se pierde lo que el cajero esté escribiendo.
                  Después hay que volver a abrirlo.
                </li>
                <li>
                  Los turnos abiertos y las ventas registradas no se pierden.
                </li>
              </ul>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={enviando}
                  onClick={() => void instalar(disponible.version)}
                >
                  {enviando ? "Iniciando…" : "Actualizar ahora"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={enviando}
                  onClick={() => setConfirmando(false)}
                >
                  Cancelar
                </Button>
              </div>
            </>
          ) : (
            <div>
              <Button size="sm" onClick={() => setConfirmando(true)}>
                Actualizar
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
