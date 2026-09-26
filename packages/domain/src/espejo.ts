import {
  LARGO_MAXIMO_COMENTARIO_ESPEJO,
  ResumenDiaSchema,
  ResumenTurnoSchema,
  VERSION_RESUMEN_ESPEJO,
  type Alquiler,
  type DiaCalendario,
  type Habitacion,
  type OrigenTicket,
  type HoraAdicional,
  type MetodoPago,
  type PeriodoConsulta,
  type ResumenDia,
  type ResumenTurno,
  type Ticket,
  type Turno,
} from "@apurimeno/contracts";
import { periodoDeDias } from "@apurimeno/formato";
import { diaLocal, resumirOcupacion, resumirVentas } from "./reportes.js";

// Resumen para el espejo en la nube (ADR-06, RN-45). Reutiliza los mismos cálculos de los reportes locales:
// lo que ve la propietaria desde lejos cuadra con lo que ve en el Dashboard del local.

/** Periodo [inicio, fin) de un día de Lima, en UTC. */
export function periodoDelDia(dia: DiaCalendario): PeriodoConsulta {
  return periodoDeDias(dia, dia);
}

export interface DatosDia {
  /** Tickets emitidos ese día (cobros y compensatorios). */
  tickets: readonly Ticket[];
  /** Alquileres que ingresaron ese día. */
  alquileres: readonly Alquiler[];
  /** Horas adicionales de esos alquileres, de cualquier día. */
  horasAdicionales: readonly HoraAdicional[];
  /** Tickets de esos alquileres, de cualquier día: sus ingresos cuentan en el día del ingreso (RF-48). */
  ticketsDeAlquileres: readonly Ticket[];
  habitaciones: readonly Habitacion[];
  metodosPago: readonly MetodoPago[];
}

/**
 * Resumen de un día de Lima. Si algún ticket o alquiler no es de ese día, es un defecto de quien arma los
 * datos y se rechaza: publicaría totales equivocados sin que nadie lo note.
 */
export function resumirDia(dia: DiaCalendario, datos: DatosDia): ResumenDia {
  for (const t of datos.tickets) {
    if (diaLocal(t.creadoEn) !== dia) throw new RangeError(`El ticket ${t.id} no es del ${dia}.`);
  }
  for (const a of datos.alquileres) {
    if (diaLocal(a.ingresoEn) !== dia) throw new RangeError(`El alquiler ${a.id} no ingresó el ${dia}.`);
  }

  const ventas = resumirVentas(datos.tickets);
  const anulados = datos.tickets.filter((t) => t.tipo === "COBRO" && t.estado === "ANULADO");
  const ocupacion = resumirOcupacion(datos.habitaciones, datos.alquileres, datos.horasAdicionales, datos.ticketsDeAlquileres);
  const nombreMetodo = new Map(datos.metodosPago.map((m) => [m.id, m.nombre]));

  return ResumenDiaSchema.parse({
    dia,
    totalVentas: ventas.total,
    cantidadCobros: ventas.cantidadTickets,
    anuladosCantidad: anulados.length,
    anuladosTotal: anulados.reduce((suma, t) => suma + t.total, 0),
    alquileres: ocupacion.habitaciones.reduce((suma, h) => suma + h.alquileres, 0),
    horasVendidas: ocupacion.habitaciones.reduce((suma, h) => suma + h.horasVendidas, 0),
    detalle: {
      porOrigen: ventas.porOrigen,
      porMetodoPago: ventas.porMetodoPago.map((m) => ({
        ...m,
        nombre: nombreMetodo.get(m.metodoPagoId) ?? m.metodoPagoId,
      })),
      ocupacion: ocupacion.habitaciones,
    },
    version: VERSION_RESUMEN_ESPEJO,
  });
}

/** El comentario de cierre viaja recortado: es texto libre y el espejo solo resume. */
function recortar(texto: string | null): string | null {
  if (texto === null) return null;
  return texto.length <= LARGO_MAXIMO_COMENTARIO_ESPEJO ? texto : `${texto.slice(0, LARGO_MAXIMO_COMENTARIO_ESPEJO - 1)}…`;
}

/**
 * Arqueo de un turno cerrado para el espejo. Un turno abierto no se resume: su esperado no se revela antes del
 * cierre (RN-34). `tickets` son los del turno; los de otros turnos se ignoran.
 */
export function resumirTurno(turno: Turno, cajero: string, tickets: readonly Ticket[]): ResumenTurno {
  if (turno.estado !== "CERRADO" || turno.cerradoEn === null || turno.efectivoEsperado === null) {
    throw new RangeError(`El turno ${turno.id} no está cerrado: no se publica en el espejo (RN-34).`);
  }
  return ResumenTurnoSchema.parse({
    turnoId: turno.id,
    diaCierre: diaLocal(turno.cerradoEn),
    cajero,
    abiertoEn: turno.abiertoEn,
    cerradoEn: turno.cerradoEn,
    cierreForzado: turno.cierreForzado,
    efectivoInicial: turno.efectivoInicial,
    efectivoEsperado: turno.efectivoEsperado,
    efectivoContado: turno.efectivoContado,
    diferencia: turno.diferencia,
    ventasTurno: resumirVentas(tickets.filter((t) => t.turnoId === turno.id)).total,
    comentario: recortar(turno.comentarioCierre),
    version: VERSION_RESUMEN_ESPEJO,
  });
}

// --- Lectura del resumen (vista remota de la propietaria) ---

/**
 * ¿El espejo está desactualizado? Sí, si pasaron más de dos intervalos de sincronización desde la última
 * publicación correcta. Mismo criterio en el Dashboard del local y en la vista de la propietaria.
 */
export function estaDesactualizado(ultimaSincronizacion: string | null, intervaloMinutos: number, ahora: Date): boolean {
  if (ultimaSincronizacion === null) return false;
  return ahora.getTime() - Date.parse(ultimaSincronizacion) > 2 * intervaloMinutos * 60_000;
}

export interface TotalesEspejo {
  totalVentas: number;
  cantidadCobros: number;
  anuladosCantidad: number;
  anuladosTotal: number;
  alquileres: number;
  horasVendidas: number;
  porOrigen: { origen: OrigenTicket; total: number }[];
  /** De mayor a menor total. El nombre es el del día más reciente en que aparece. */
  porMetodoPago: { metodoPagoId: string; nombre: string; total: number }[];
  /** Solo los días publicados, en orden. */
  porDia: { dia: DiaCalendario; total: number; cantidadCobros: number }[];
  /** Todas las habitaciones que aparecen en el periodo, en orden de número. */
  ocupacion: ResumenDia["detalle"]["ocupacion"];
}

const ORDEN_ORIGEN: readonly OrigenTicket[] = ["INGRESO_ALQUILER", "HORA_ADICIONAL", "VENTA_TIENDA"];

/** Suma los resúmenes de varios días (un periodo de la vista remota). Sin días, todo en cero. */
export function sumarResumenesDia(resumenes: readonly ResumenDia[]): TotalesEspejo {
  const dias = [...resumenes].sort((a, b) => a.dia.localeCompare(b.dia));
  const porOrigen = new Map<OrigenTicket, number>();
  const porMetodo = new Map<string, { nombre: string; total: number }>();
  const ocupacion = new Map<string, TotalesEspejo["ocupacion"][number]>();
  const suma = { totalVentas: 0, cantidadCobros: 0, anuladosCantidad: 0, anuladosTotal: 0, alquileres: 0, horasVendidas: 0 };

  for (const d of dias) {
    suma.totalVentas += d.totalVentas;
    suma.cantidadCobros += d.cantidadCobros;
    suma.anuladosCantidad += d.anuladosCantidad;
    suma.anuladosTotal += d.anuladosTotal;
    suma.alquileres += d.alquileres;
    suma.horasVendidas += d.horasVendidas;
    for (const o of d.detalle.porOrigen) porOrigen.set(o.origen, (porOrigen.get(o.origen) ?? 0) + o.total);
    for (const m of d.detalle.porMetodoPago) {
      porMetodo.set(m.metodoPagoId, { nombre: m.nombre, total: (porMetodo.get(m.metodoPagoId)?.total ?? 0) + m.total });
    }
    for (const h of d.detalle.ocupacion) {
      const previo = ocupacion.get(h.habitacionId);
      ocupacion.set(h.habitacionId, {
        habitacionId: h.habitacionId,
        numero: h.numero,
        alquileres: (previo?.alquileres ?? 0) + h.alquileres,
        horasVendidas: (previo?.horasVendidas ?? 0) + h.horasVendidas,
        ingresos: (previo?.ingresos ?? 0) + h.ingresos,
      });
    }
  }

  return {
    ...suma,
    porOrigen: ORDEN_ORIGEN.filter((o) => porOrigen.has(o)).map((origen) => ({ origen, total: porOrigen.get(origen) ?? 0 })),
    porMetodoPago: [...porMetodo]
      .map(([metodoPagoId, m]) => ({ metodoPagoId, ...m }))
      .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre)),
    porDia: dias.map((d) => ({ dia: d.dia, total: d.totalVentas, cantidadCobros: d.cantidadCobros })),
    ocupacion: [...ocupacion.values()].sort((a, b) => a.numero.localeCompare(b.numero, "es", { numeric: true })),
  };
}

/** Arqueos de un periodo en la vista remota: en orden de cierre, con la suma de diferencias (como §25). */
export function resumirArqueosEspejo(turnos: readonly ResumenTurno[]) {
  const ordenados = [...turnos].sort((a, b) => Date.parse(a.cerradoEn) - Date.parse(b.cerradoEn));
  return {
    turnos: ordenados,
    diferenciaTotal: ordenados.reduce((suma, t) => suma + (t.diferencia ?? 0), 0),
    turnosConDiferencia: ordenados.filter((t) => t.diferencia !== null && t.diferencia !== 0).length,
  };
}
