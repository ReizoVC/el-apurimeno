import { useCallback, useState } from "react";

/**
 * Clave de idempotencia de una operación que cobra (RF-59). Se genera al preparar el cobro y se conserva si
 * el envío falla, para que reintentar no cobre dos veces; se renueva solo después de un cobro exitoso.
 */
export function useClaveIdempotencia(): [string, () => void] {
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const renovar = useCallback(() => setClave(crypto.randomUUID()), []);
  return [clave, renovar];
}
