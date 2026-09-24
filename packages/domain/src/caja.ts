import {
  TurnoSchema,
  type Centimos,
  type CentimosConSigno,
  type FechaISO,
  type Id,
  type MetodoPago,
  type MovimientoCaja,
  type Ticket,
  type TipoMovimientoCaja,
  type Turno,
} from "@apurimeno/contracts";
import { ErrorNegocio } from "./errores.js";
import { asegurarCentimos, asegurarEnteroPositivo, motivoRequerido } from "./interno.js";

/** Ningún cobro ni movimiento de caja sin turno abierto (RN-32). */
export function asegurarTurnoAbierto(turno: Pick<Turno, "estado">): void {
  if (turno.estado !== "ABIERTO") throw new ErrorNegocio("SHIFT_NOT_OPEN");
}

/**
 * Efectivo esperado al cierre (RN-33, RN-35, RF-27):
 * inicial + pagos en métodos que afectan caja + ingresos manuales − retiros manuales.
 * Se suman los pagos de todos los tickets del turno. Un ticket compensatorio trae pagos negativos,
 * así que una devolución en efectivo resta del cajón en el que se hizo.
 */
export function calcularEfectivoEsperado(
  turno: Pick<Turno, "id" | "efectivoInicial">,
  tickets: readonly Ticket[],
  movimientos: readonly MovimientoCaja[],
  metodosPago: readonly MetodoPago[],
): CentimosConSigno {
  const afectaCaja = new Map(metodosPago.map((m) => [m.id, m.afectaCaja]));
  let esperado = turno.efectivoInicial;

  for (const ticket of tickets) {
    if (ticket.turnoId !== turno.id) throw new RangeError(`El ticket ${ticket.id} es de otro turno.`);
    for (const pago of ticket.pagos) {
      const afecta = afectaCaja.get(pago.metodoPagoId);
      if (afecta === undefined) throw new RangeError(`Método de pago desconocido: ${pago.metodoPagoId}`);
      if (afecta) esperado += pago.monto;
    }
  }
  for (const movimiento of movimientos) {
    if (movimiento.turnoId !== turno.id) throw new RangeError(`El movimiento ${movimiento.id} es de otro turno.`);
    esperado += movimiento.tipo === "INGRESO" ? movimiento.monto : -movimiento.monto;
  }
  return esperado;
}

/**
 * Cierre normal con arqueo ciego (RN-34, RF-28): recibe el efectivo contado por el cajero,
 * que se pide antes de mostrarle el esperado. La diferencia no impide cerrar (escenario 31.4).
 */
export function cerrarTurno(
  turno: Turno,
  datos: { efectivoContado: Centimos; efectivoEsperado: CentimosConSigno; ahora: FechaISO },
): Turno {
  asegurarTurnoAbierto(turno);
  asegurarCentimos(datos.efectivoContado, "efectivoContado");
  return TurnoSchema.parse({
    ...turno,
    estado: "CERRADO",
    cerradoEn: datos.ahora,
    cerradoPorId: turno.usuarioId,
    cierreForzado: false,
    efectivoContado: datos.efectivoContado,
    efectivoEsperado: datos.efectivoEsperado,
    diferencia: datos.efectivoContado - datos.efectivoEsperado,
  });
}

/** Cierre forzado por un Administrador de un turno ajeno (CU-20, RF-43). El conteo es opcional. */
export function forzarCierreTurno(
  turno: Turno,
  datos: {
    cerradoPorId: Id;
    efectivoContado: Centimos | null;
    efectivoEsperado: CentimosConSigno;
    ahora: FechaISO;
  },
): Turno {
  asegurarTurnoAbierto(turno);
  if (datos.cerradoPorId === turno.usuarioId) throw new ErrorNegocio("INVALID_STATE_TRANSITION");
  if (datos.efectivoContado !== null) asegurarCentimos(datos.efectivoContado, "efectivoContado");
  return TurnoSchema.parse({
    ...turno,
    estado: "CERRADO",
    cerradoEn: datos.ahora,
    cerradoPorId: datos.cerradoPorId,
    cierreForzado: true,
    efectivoContado: datos.efectivoContado,
    efectivoEsperado: datos.efectivoEsperado,
    diferencia: datos.efectivoContado === null ? null : datos.efectivoContado - datos.efectivoEsperado,
  });
}

/** Movimiento manual de caja antes de persistirse (RF-42). */
export interface BorradorMovimientoCaja {
  turnoId: Id;
  tipo: TipoMovimientoCaja;
  monto: Centimos;
  motivo: string;
}

/** Valida un movimiento manual: turno abierto, monto positivo y motivo (RN-32, RF-42). */
export function prepararMovimientoCaja(
  turno: Pick<Turno, "id" | "estado">,
  tipo: TipoMovimientoCaja,
  monto: number,
  motivo: string,
): BorradorMovimientoCaja {
  asegurarTurnoAbierto(turno);
  asegurarEnteroPositivo(monto, "monto");
  return { turnoId: turno.id, tipo, monto, motivo: motivoRequerido(motivo) };
}
