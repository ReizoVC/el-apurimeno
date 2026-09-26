import { appendFile } from "node:fs/promises";

/**
 * Cómo llegan los bytes a la impresora (ADR-05). La parte 2, con la REDPOS RED-E803 real, completa esta
 * capa (Bluetooth, Windows, reintentos). Hoy hay una sola implementación: escribir los bytes en una ruta.
 */
export interface TransporteImpresora {
  readonly descripcion: string;
  enviar(bytes: Uint8Array): Promise<void>;
}

/**
 * Escribe los bytes al final de un archivo o dispositivo. En Linux, una impresora USB aparece como
 * `/dev/usb/lp0` y acepta ESC/POS escrito directamente. Con un archivo normal sirve para inspeccionar lo que
 * se habría impreso. Todavía no probado con la impresora real.
 */
export function transporteArchivo(ruta: string): TransporteImpresora {
  return {
    descripcion: `archivo ${ruta}`,
    enviar: (bytes) => appendFile(ruta, bytes),
  };
}
