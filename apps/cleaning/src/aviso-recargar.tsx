"use client";

import { useEffect, useState } from "react";
import { RUTAS, SaludRespuestaSchema } from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import { urlServidor } from "./api";

const CADA_5_MINUTOS = 5 * 60_000;

/** Si el sistema se actualizó con la app abierta en el celular, sigue siendo la vieja hasta recargarla (decisión 30). */
export function AvisoRecargar() {
  const [vieja, setVieja] = useState(false);

  useEffect(() => {
    const leer = async () => {
      try {
        const r = await fetch(`${urlServidor()}${RUTAS.salud}`);
        const { versionSistema } = SaludRespuestaSchema.parse(await r.json());
        setVieja(
          versionSistema !== null &&
            versionSistema !== process.env.NEXT_PUBLIC_VERSION_SISTEMA,
        );
      } catch {
        // Sin servidor no se sabe; la lista ya avisa si no puede cargar.
      }
    };
    void leer();
    const temporizador = setInterval(() => void leer(), CADA_5_MINUTOS);
    return () => clearInterval(temporizador);
  }, []);

  if (!vieja) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <p>El sistema se actualizó. Recargue para seguir.</p>
      <Button size="sm" onClick={() => window.location.reload()}>
        Recargar
      </Button>
    </div>
  );
}
