import { useEffect, useState } from "react";

// Hora del servidor en el POS (RF-07: nunca la del dispositivo). Cada respuesta del tablero trae `ahora`; la
// diferencia con el reloj local se guarda y se aplica al contar el tiempo entre una consulta y la siguiente.

let desfaseMs = 0;

export function sincronizarReloj(ahoraServidor: string): void {
  desfaseMs = Date.parse(ahoraServidor) - Date.now();
}

export function ahoraServidor(): Date {
  return new Date(Date.now() + desfaseMs);
}

/** Hora del servidor, actualizada cada `cadaMs` para refrescar cuentas regresivas. */
export function useAhoraServidor(cadaMs = 1000): Date {
  const [ahora, setAhora] = useState(ahoraServidor);
  useEffect(() => {
    const id = window.setInterval(() => setAhora(ahoraServidor()), cadaMs);
    return () => window.clearInterval(id);
  }, [cadaMs]);
  return ahora;
}
