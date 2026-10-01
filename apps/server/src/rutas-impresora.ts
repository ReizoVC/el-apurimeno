import { EstadoImpresoraSchema, LogoComprobanteSchema, RUTAS } from "@apurimeno/contracts";
import type { FastifyInstance } from "fastify";
import type { ColaImpresion } from "./impresion/cola.js";
import { escribirPng, type ImagenMonocromo } from "./impresion/imagen.js";

/**
 * Estado de la impresora para el aviso del POS, y "reintentar ahora" (RF-56). Sin nuevas operaciones de permiso:
 * el estado lo ve quien ve el tablero (y el Administrador), y reintentar lo puede quien reimprime, porque solo
 * vuelve a enviar comprobantes ya encolados, sin crear ninguno. No se audita, igual que los reintentos automáticos.
 */
export function registrarRutasImpresora(app: FastifyInstance, cola: ColaImpresion, logo: ImagenMonocromo | null): void {
  app.get(RUTAS.estadoImpresora, { config: { operacion: ["CONSULTAR_TABLERO", "CONFIGURAR_PARAMETROS"] } }, async () =>
    EstadoImpresoraSchema.parse(await cola.estado()),
  );

  // Espera el resultado (segundos si la impresora no contesta): el POS muestra cómo quedó, no un "en proceso".
  app.post(RUTAS.reintentarImpresion, { config: { operacion: ["REIMPRIMIR_COMPROBANTE", "CONFIGURAR_PARAMETROS"] } }, async () =>
    EstadoImpresoraSchema.parse(await cola.reintentar()),
  );

  // El logotipo cargado al arrancar, para la vista previa de la Configuración (decisión 27): lo ve quien la edita.
  const respuestaLogo = LogoComprobanteSchema.parse({
    logo: logo === null ? null : { ancho: logo.ancho, alto: logo.alto, pngBase64: escribirPng(logo).toString("base64") },
  });
  app.get(RUTAS.logoComprobante, { config: { operacion: "CONFIGURAR_PARAMETROS" } }, async () => respuestaLogo);
}
