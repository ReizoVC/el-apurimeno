import type {
  Alquiler,
  Habitacion,
  HoraAdicional,
  OrigenTicket,
  ReporteArqueos,
  ReporteOcupacion,
  ReporteVentas,
  Ticket,
  Turno,
} from "@apurimeno/contracts";
import { ZONA_NEGOCIO, diaLima } from "@apurimeno/formato";
import { ms } from "./interno.js";

/** El negocio opera en Perú (UTC−5, sin horario de verano). Los días de los reportes son días de Lima. */
export const ZONA_HORARIA_NEGOCIO = ZONA_NEGOCIO;

/** Día calendario en la hora de Lima ("AAAA-MM-DD") de un instante UTC. */
export function diaLocal(fecha: string): string {
  return diaLima(new Date(ms(fecha)));
}

/** Un ticket vigente es un cobro no anulado (RF-47). Los compensatorios no cuentan: su cobro original ya no cuenta. */
export function esTicketVigente(ticket: Pick<Ticket, "tipo" | "estado">): boolean {
  return ticket.tipo === "COBRO" && ticket.estado === "EMITIDO";
}

function sumarPor<K extends string>(pares: Iterable<[K, number]>): Map<K, number> {
  const totales = new Map<K, number>();
  for (const [clave, monto] of pares) totales.set(clave, (totales.get(clave) ?? 0) + monto);
  return totales;
}

const ORDEN_ORIGEN: readonly OrigenTicket[] = ["INGRESO_ALQUILER", "HORA_ADICIONAL", "VENTA_TIENDA"];

/**
 * Ventas de un conjunto de tickets (RF-47, §25). Solo cuentan los vigentes. `total`, `porOrigen`,
 * `porMetodoPago`, `porDia` y `porTurno` suman lo mismo; `porProducto` solo cubre las líneas de producto.
 */
export function resumirVentas(tickets: readonly Ticket[]): ReporteVentas {
  const vigentes = tickets.filter(esTicketVigente);
  const total = vigentes.reduce((suma, t) => suma + t.total, 0);

  const porOrigen = sumarPor(vigentes.map((t) => [t.origen, t.total]));
  const porMetodo = sumarPor(vigentes.flatMap((t) => t.pagos.map((p): [string, number] => [p.metodoPagoId, p.monto])));
  const porDia = sumarPor(vigentes.map((t): [string, number] => [diaLocal(t.creadoEn), t.total]));
  const porTurno = sumarPor(vigentes.map((t): [string, number] => [t.turnoId, t.total]));

  const productos = new Map<string, { descripcion: string; cantidad: number; total: number }>();
  for (const linea of vigentes.flatMap((t) => t.lineas)) {
    if (linea.tipo !== "PRODUCTO" || linea.productoId === null) continue;
    const acumulado = productos.get(linea.productoId) ?? { descripcion: linea.descripcion, cantidad: 0, total: 0 };
    acumulado.cantidad += linea.cantidad;
    acumulado.total += linea.importe;
    productos.set(linea.productoId, acumulado);
  }

  const porClave = <K extends string>(mapa: Map<K, number>) => [...mapa].sort(([a], [b]) => a.localeCompare(b));
  return {
    total,
    cantidadTickets: vigentes.length,
    porOrigen: ORDEN_ORIGEN.filter((o) => porOrigen.has(o)).map((origen) => ({ origen, total: porOrigen.get(origen) ?? 0 })),
    porMetodoPago: porClave(porMetodo).map(([metodoPagoId, t]) => ({ metodoPagoId, total: t })),
    porDia: porClave(porDia).map(([dia, t]) => ({ dia, total: t })),
    porTurno: porClave(porTurno).map(([turnoId, t]) => ({ turnoId, total: t })),
    porProducto: [...productos]
      .map(([productoId, p]) => ({ productoId, ...p }))
      .sort((a, b) => b.total - a.total || a.productoId.localeCompare(b.productoId)),
  };
}

/**
 * Arqueos de un conjunto de turnos (§25): solo los cerrados, en orden de cierre, con la suma de
 * diferencias. Un cierre forzado sin conteo no tiene diferencia y no suma.
 */
export function resumirArqueos(turnos: readonly Turno[]): ReporteArqueos {
  const cerrados = turnos
    .filter((t) => t.estado === "CERRADO")
    .sort((a, b) => ms(a.cerradoEn ?? a.abiertoEn) - ms(b.cerradoEn ?? b.abiertoEn));
  return {
    turnos: cerrados,
    diferenciaTotal: cerrados.reduce((suma, t) => suma + (t.diferencia ?? 0), 0),
    turnosConDiferencia: cerrados.filter((t) => t.diferencia !== null && t.diferencia !== 0).length,
  };
}

/**
 * Ocupación por habitación (RF-48). Cada alquiler no anulado cuenta sus horas base, las pagadas al
 * ingreso y sus horas adicionales vigentes (cuyo ticket no fue anulado). Los ingresos son la suma de los
 * tickets vigentes de esos alquileres. Todas las habitaciones aparecen, aunque no tengan alquileres.
 */
export function resumirOcupacion(
  habitaciones: readonly Habitacion[],
  alquileres: readonly Alquiler[],
  horasAdicionales: readonly HoraAdicional[],
  tickets: readonly Ticket[],
): ReporteOcupacion {
  const vigentes = new Map(tickets.filter(esTicketVigente).map((t) => [t.id, t]));
  const horasPorAlquiler = sumarPor(
    horasAdicionales.filter((h) => vigentes.has(h.ticketId)).map((h): [string, number] => [h.alquilerId, 1]),
  );
  const ingresosPorAlquiler = sumarPor(
    [...vigentes.values()].filter((t) => t.alquilerId !== null).map((t): [string, number] => [t.alquilerId ?? "", t.total]),
  );

  const porHabitacion = new Map<string, { alquileres: number; horasVendidas: number; ingresos: number }>();
  for (const a of alquileres) {
    if (a.estado === "ANULADO") continue;
    const acumulado = porHabitacion.get(a.habitacionId) ?? { alquileres: 0, horasVendidas: 0, ingresos: 0 };
    acumulado.alquileres += 1;
    acumulado.horasVendidas += a.parametrosAplicados.horasBase + a.horasAdicionalesAlIngreso + (horasPorAlquiler.get(a.id) ?? 0);
    acumulado.ingresos += ingresosPorAlquiler.get(a.id) ?? 0;
    porHabitacion.set(a.habitacionId, acumulado);
  }

  return {
    habitaciones: [...habitaciones]
      .sort((a, b) => a.numero.localeCompare(b.numero, "es", { numeric: true }))
      .map((h) => ({
        habitacionId: h.id,
        numero: h.numero,
        ...(porHabitacion.get(h.id) ?? { alquileres: 0, horasVendidas: 0, ingresos: 0 }),
      })),
  };
}
