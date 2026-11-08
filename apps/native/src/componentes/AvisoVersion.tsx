import { useEffect, useState } from "react";
import { servidor } from "../lib/servidor";

const CADA_10_MINUTOS = 10 * 60_000;

/**
 * Aviso de versión nueva (decisión 30 de contracts). Solo informa: el POS se cierra al actualizarse, así que no podría
 * mostrar el avance. Se instala desde el Dashboard, con el permiso `system.update`.
 */
export function AvisoVersion() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const leer = () => {
      servidor.salud().then(
        ({ versionDisponible }) => setVersion(versionDisponible),
        () => undefined,
      );
    };
    leer();
    const id = window.setInterval(leer, CADA_10_MINUTOS);
    return () => window.clearInterval(id);
  }, []);

  if (version === null) return null;
  return (
    <p
      role="status"
      className="border-b border-amber-500/50 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      Hay una versión nueva del sistema ({version}). Al instalarla desde el
      Dashboard, este POS se cierra y hay que volver a abrirlo.
    </p>
  );
}
