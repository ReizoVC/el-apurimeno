import { MENSAJE_ERROR_NEGOCIO, type CodigoErrorNegocio } from "@apurimeno/contracts";

/**
 * Rechazo por una regla de negocio. El backend lo traduce a una respuesta con `codigo`,
 * que es estable y forma parte del contrato (§24.2).
 * Los errores de programación (datos que no respetan el contrato) se lanzan como RangeError.
 */
export class ErrorNegocio extends Error {
  readonly codigo: CodigoErrorNegocio;

  constructor(codigo: CodigoErrorNegocio, detalle?: string) {
    super(detalle ?? MENSAJE_ERROR_NEGOCIO[codigo]);
    this.name = "ErrorNegocio";
    this.codigo = codigo;
  }
}
