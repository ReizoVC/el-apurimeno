"use client";

import { useEffect, useState } from "react";
import { Button } from "@apurimeno/ui/components/button";
import { servidor } from "../lib/servidor";

const CADA_5_MINUTOS = 5 * 60_000;

/** Si el sistema se actualizó con esta página abierta, sigue siendo la vieja hasta recargarla (decisión 30 de contracts). */
export function AvisoRecargar() {
  const [vieja, setVieja] = useState(false);

  useEffect(() => {
    const leer = () => {
      servidor.salud().then(
        ({ versionSistema }) =>
          setVieja(
            versionSistema !== null &&
              versionSistema !== process.env.NEXT_PUBLIC_VERSION_SISTEMA,
          ),
        () => undefined,
      );
    };
    leer();
    const temporizador = setInterval(leer, CADA_5_MINUTOS);
    return () => clearInterval(temporizador);
  }, []);

  if (!vieja) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <p>El sistema se actualizó. Recargue esta página para seguir.</p>
      <Button size="sm" onClick={() => window.location.reload()}>
        Recargar
      </Button>
    </div>
  );
}
