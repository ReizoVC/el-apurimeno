import {
  CABECERA_IDEMPOTENCIA,
  ClaveIdempotenciaSchema,
  type OrigenTicket,
  type PagoEntrada,
} from "@apurimeno/contracts";
import { pagoEnEfectivo, pagoSinVuelto, type BorradorPago } from "@apurimeno/domain";
import type { FastifyRequest } from "fastify";
import type { PrismaClient, Transaccion } from "../db.js";
import { ErrorApi, esViolacionUnica, validar } from "../errores.js";

/** Lee la clave de idempotencia obligatoria de una operación que cobra (RF-59). */
export function claveIdempotencia(request: FastifyRequest): string {
  const valor = request.headers[CABECERA_IDEMPOTENCIA];
  if (valor === undefined) {
    throw new ErrorApi("VALIDACION", `Falta la cabecera ${CABECERA_IDEMPOTENCIA}.`);
  }
  return validar(ClaveIdempotenciaSchema, valor);
}

/**
 * Ejecuta un cobro una sola vez por clave (RF-59). Si la clave ya tiene un ticket, devuelve el resultado
 * guardado sin volver a cobrar. Si dos solicitudes con la misma clave llegan a la vez, el índice único de
 * `Ticket.claveIdempotencia` rechaza la segunda, y esa también devuelve el resultado de la primera.
 */
export async function unaSolaVez<T>(
  prisma: PrismaClient,
  clave: string,
  origen: OrigenTicket,
  reproducir: (ticketId: string) => Promise<T>,
  ejecutar: () => Promise<T>,
): Promise<{ resultado: T; repetido: boolean }> {
  const buscar = async () => {
    const existente = await prisma.ticket.findUnique({
      where: { claveIdempotencia: clave },
      select: { id: true, origen: true },
    });
    if (existente !== null && existente.origen !== origen) {
      throw new ErrorApi("CLAVE_IDEMPOTENCIA_REUTILIZADA", "La clave de idempotencia ya se usó en otra operación.");
    }
    return existente;
  };

  const previo = await buscar();
  if (previo !== null) return { resultado: await reproducir(previo.id), repetido: true };
  try {
    return { resultado: await ejecutar(), repetido: false };
  } catch (error) {
    if (!esViolacionUnica(error)) throw error;
    const ganador = await buscar();
    if (ganador === null) throw error;
    return { resultado: await reproducir(ganador.id), repetido: true };
  }
}

/**
 * Convierte los pagos recibidos en borradores del dominio. El método debe existir y estar activo;
 * `montoRecibido` (con vuelto) solo aplica a métodos que afectan caja, y los que exigen número de
 * operación lo requieren (RF-54).
 */
export async function construirPagos(tx: Transaccion, entradas: readonly PagoEntrada[]): Promise<BorradorPago[]> {
  const ids = [...new Set(entradas.map((e) => e.metodoPagoId))];
  const metodos = new Map((await tx.metodoPago.findMany({ where: { id: { in: ids } } })).map((m) => [m.id, m]));

  return entradas.map((entrada, i) => {
    const metodo = metodos.get(entrada.metodoPagoId);
    if (metodo === undefined || !metodo.activo) {
      throw new ErrorApi("VALIDACION", `pagos.${i}.metodoPagoId: método de pago inexistente o inactivo.`);
    }
    const referencia = entrada.referencia?.trim() || null;
    if (metodo.requiereReferencia && referencia === null) {
      throw new ErrorApi("VALIDACION", `pagos.${i}.referencia: ${metodo.nombre} exige número de operación.`);
    }
    if (entrada.montoRecibido === null) return pagoSinVuelto(metodo.id, entrada.monto, referencia);
    if (!metodo.afectaCaja) {
      throw new ErrorApi("VALIDACION", `pagos.${i}.montoRecibido: solo aplica a pagos en efectivo.`);
    }
    return pagoEnEfectivo(metodo.id, entrada.monto, entrada.montoRecibido);
  });
}

/** Correlativo de ticket sin huecos: se calcula dentro de la transacción del cobro (Planos §9.4). */
export async function siguienteNumeroTicket(tx: Transaccion): Promise<number> {
  const ultimo = await tx.ticket.aggregate({ _max: { numero: true } });
  return (ultimo._max.numero ?? 0) + 1;
}
