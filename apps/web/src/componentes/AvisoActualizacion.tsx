"use client";

import { useEffect, useState } from "react";
import type { EstadoActualizacion } from "@apurimeno/contracts";
import { servidor } from "../lib/servidor";
import { Aviso } from "./comunes";

const CADA_10_MINUTOS = 10 * 60_000;

/**
 * Aviso de versiones nuevas (decisión 30 de contracts), arriba de todas las secciones, para quien tenga `system.update`.
 * Un error al consultarlo no se muestra: no debe tapar el trabajo, y el servidor caído ya se nota en la sección.
 */
export function AvisoActualizacion() {
  const [estado, setEstado] = useState<EstadoActualizacion | null>(null);

  useEffect(() => {
    let vigente = true;
    const leer = () => {
      servidor.estadoActualizacion().then(
        (e) => {
          if (vigente) setEstado(e);
        },
        () => undefined,
      );
    };
    leer();
    const temporizador = setInterval(leer, CADA_10_MINUTOS);
    return () => {
      vigente = false;
      clearInterval(temporizador);
    };
  }, []);

  if (estado?.estado === "FIRMA_INVALIDA") {
    return (
      <Aviso tipo="error">
        Se encontró una versión publicada que no pasó la verificación de firma.
        No se ofrece ni se instala. Avise a Reizo.
      </Aviso>
    );
  }
  const { disponible } = estado ?? { disponible: null };
  if (disponible === null) return null;
  return (
    <div
      role="status"
      className="rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <p className="font-medium">
        Hay una versión nueva del sistema: {disponible.version}
      </p>
      <p className="whitespace-pre-line">{disponible.notas}</p>
      <p className="mt-1 text-xs">
        {disponible.completa
          ? "Al instalarla, el sistema queda varios minutos sin poder cobrar."
          : "Al instalarla, el sistema queda cerca de 1 minuto sin poder cobrar."}{" "}
        Por ahora la instala Reizo.
      </p>
    </div>
  );
}
