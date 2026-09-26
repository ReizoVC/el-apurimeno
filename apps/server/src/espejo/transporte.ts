import type { CodigoErrorEspejo, FilaEstadoEspejo, FilaResumenDia, FilaResumenTurno } from "@apurimeno/contracts";

/** Lo que se publica en una vuelta de sincronización, ya con los nombres de columna del espejo. */
export interface LoteEspejo {
  dias: FilaResumenDia[];
  turnos: FilaResumenTurno[];
  /** Va al final: la hora de "última sincronización" solo avanza si todo lo anterior llegó. */
  estado: FilaEstadoEspejo;
}

/**
 * Destino del resumen (ADR-06). Solo escribe hacia la nube: nada de lo que devuelve se aplica a la base local
 * (RNF-SYNC-01). Publicar dos veces el mismo lote no duplica nada: cada fila reemplaza a la anterior.
 */
export interface TransporteEspejo {
  /** Para el registro del servidor. */
  readonly descripcion: string;
  publicar(lote: LoteEspejo): Promise<void>;
}

/** Falla esperable del espejo: sin internet, credenciales o una respuesta de error del servicio. */
export class ErrorEspejo extends Error {
  readonly codigo: CodigoErrorEspejo;

  constructor(codigo: CodigoErrorEspejo, mensaje: string) {
    super(mensaje);
    this.name = "ErrorEspejo";
    this.codigo = codigo;
  }
}
