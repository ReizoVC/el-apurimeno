import { EstadoImpresoraSchema, RUTAS } from "@apurimeno/contracts";
import type { FastifyInstance } from "fastify";
import type { ColaImpresion } from "./impresion/cola.js";

/**
 * Estado de la impresora para el aviso del POS, y "reintentar ahora" (RF-56). Sin nuevas operaciones de permiso:
 * el estado lo ve quien ve el tablero (y el Administrador), y reintentar lo puede quien reimprime, porque solo
 * vuelve a enviar comprobantes ya encolados, sin crear ninguno. No se audita, igual que los reintentos automáticos.
 */
export function registrarRutasImpresora(app: FastifyInstance, cola: ColaImpresion): void {
  app.get(RUTAS.estadoImpresora, { config: { operacion: ["CONSULTAR_TABLERO", "CONFIGURAR_PARAMETROS"] } }, async () =>
    EstadoImpresoraSchema.parse(await cola.estado()),
  );

  // Espera el resultado (segundos si la impresora no contesta): el POS muestra cómo quedó, no un "en proceso".
  app.post(RUTAS.reintentarImpresion, { config: { operacion: ["REIMPRIMIR_COMPROBANTE", "CONFIGURAR_PARAMETROS"] } }, async () =>
    EstadoImpresoraSchema.parse(await cola.reintentar()),
  );
}
