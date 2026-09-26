import {
  LARGO_MAXIMO_COMENTARIO_ESPEJO,
  ResumenDiaSchema,
  ResumenTurnoSchema,
  VERSION_RESUMEN_ESPEJO,
  type Alquiler,
  type DiaCalendario,
  type Habitacion,
  type HoraAdicional,
  type MetodoPago,
  type PeriodoConsulta,
  type ResumenDia,
  type ResumenTurno,
  type Ticket,
  type Turno,
} from "@apurimeno/contracts";
import { diaLocal, resumirOcupacion, resumirVentas } from "./reportes.js";

// Resumen para el espejo en la nube (ADR-06, RN-45). Reutiliza los mismos cálculos de los reportes locales:
// lo que ve la propietaria desde lejos cuadra con lo que ve en el Dashboard del local.

/** Lima está en UTC−5 todo el año (sin horario de verano): un día de Lima empieza a las 05:00 UTC. */
const DESFASE_LIMA = "-05:00";

/** Periodo [inicio, fin) de un día de Lima, en UTC. */
export function periodoDelDia(dia: DiaCalendario): PeriodoConsulta {
  const desde = new Date(`${dia}T00:00:00.000${DESFASE_LIMA}`);
  if (!Number.isFinite(desde.getTime())) throw new RangeError(`Día inválido: ${dia}`);
  const hasta = new Date(desde.getTime() + 24 * 3_600_000);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

/** Suma (o resta) días a un día de Lima. */
export function sumarDias(dia: DiaCalendario, dias: number): DiaCalendario {
  const fecha = new Date(`${dia}T12:00:00.000Z`);
  if (!Number.isFinite(fecha.getTime())) throw new RangeError(`Día inválido: ${dia}`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
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
