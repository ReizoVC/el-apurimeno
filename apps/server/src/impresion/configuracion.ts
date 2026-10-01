import type { ImagenMonocromo } from "./imagen.js";
import { cargarLogo } from "./logo.js";
import { leerDestinoImpresora, transporteDesdeDestino, type TransporteImpresora } from "./transporte.js";

/** Lo que el servidor arma al arrancar a partir de `IMPRESORA_DISPOSITIVO` e `IMPRESORA_LOGO`. */
export interface ConfiguracionImpresion {
  transporte: TransporteImpresora | null;
  logo: ImagenMonocromo | null;
  /** Error en `IMPRESORA_DISPOSITIVO`: se arranca sin impresora y los comprobantes quedan en cola. */
  problemaConfiguracion: string | null;
  /** Error en `IMPRESORA_LOGO`: los comprobantes salen sin logotipo. */
  problemaLogo: string | null;
}

const mensajeDe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Un error en la impresora o en el logotipo no impide arrancar: sin servidor no hay cobros. Tampoco se pierde en el
 * registro: queda en `GET /impresora/estado`, que el Dashboard muestra en la Vista general y el POS al cajero.
 */
export function configurarImpresion(
  dispositivo: string | undefined,
  logo: string | undefined,
  plataforma: NodeJS.Platform = process.platform,
): ConfiguracionImpresion {
  const configuracion: ConfiguracionImpresion = { transporte: null, logo: null, problemaConfiguracion: null, problemaLogo: null };
  try {
    const destino = leerDestinoImpresora(dispositivo);
    configuracion.transporte = destino === null ? null : transporteDesdeDestino(destino, plataforma);
  } catch (error) {
    configuracion.problemaConfiguracion = mensajeDe(error);
  }
  try {
    configuracion.logo = cargarLogo(logo);
  } catch (error) {
    configuracion.problemaLogo = mensajeDe(error);
  }
  return configuracion;
}
