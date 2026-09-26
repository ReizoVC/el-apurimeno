"use client";

import { useCallback, useEffect, useState } from "react";
import { mensajeDe } from "./servidor";

export interface Carga<T> {
  datos: T | null;
  error: string | null;
  cargando: boolean;
  recargar: () => Promise<void>;
}

/** Carga datos del servidor al montar (y cuando cambian las dependencias), con su error en castellano. */
export function useCarga<T>(
  obtener: () => Promise<T>,
  dependencias: readonly unknown[],
): Carga<T> {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const obtenerMemo = useCallback(obtener, dependencias);

  const recargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await obtenerMemo());
      setError(null);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setCargando(false);
    }
  }, [obtenerMemo]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return { datos, error, cargando, recargar };
}
