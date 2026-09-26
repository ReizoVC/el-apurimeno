// Días y horas del negocio. El negocio opera en Perú: Lima está en UTC−5 todo el año (sin horario de verano), así
// que un día de Lima empieza a las 05:00 UTC. Los instantes viajan en ISO-8601 UTC; aquí se convierten.

export const ZONA_NEGOCIO = "America/Lima";

/** Día calendario en la hora de Lima, "AAAA-MM-DD". */
export type Dia = string;

const DESFASE_LIMA = "-05:00";
const PATRON_DIA = /^\d{4}-\d{2}-\d{2}$/;

const formatoDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_NEGOCIO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function instante(valor: Date | string): Date {
  const fecha = typeof valor === "string" ? new Date(valor) : valor;
  if (!Number.isFinite(fecha.getTime())) throw new RangeError(`Fecha inválida: ${String(valor)}`);
  return fecha;
}

function validarDia(dia: Dia): void {
  const mediodia = new Date(`${dia}T12:00:00.000Z`);
  if (!PATRON_DIA.test(dia) || !Number.isFinite(mediodia.getTime()) || mediodia.toISOString().slice(0, 10) !== dia) {
    throw new RangeError(`Día inválido: ${dia}`);
  }
}

/** Día de Lima de un instante (un `Date` o un ISO). */
export function diaLima(valor: Date | string): Dia {
  return formatoDia.format(instante(valor));
}

/** Instante (UTC) en que empieza un día de Lima. */
export function inicioDiaLima(dia: Dia): Date {
  validarDia(dia);
  return new Date(`${dia}T00:00:00.000${DESFASE_LIMA}`);
}

/** Suma (o resta) días a un día de Lima. */
export function sumarDias(dia: Dia, dias: number): Dia {
  validarDia(dia);
  const fecha = new Date(`${dia}T12:00:00.000Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** Días de Lima de `desde` a `hasta`, ambos incluidos, en orden; vacío si `hasta` es anterior. */
export function diasEntre(desde: Dia, hasta: Dia): Dia[] {
  validarDia(hasta);
  const dias: Dia[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) dias.push(d);
  return dias;
}

/** Periodo [desde, hasta) en UTC que cubre los días de Lima `desde` a `hasta`, ambos incluidos. */
export function periodoDeDias(desde: Dia, hasta: Dia): { desde: string; hasta: string } {
  return {
    desde: inicioDiaLima(desde).toISOString(),
    hasta: inicioDiaLima(sumarDias(hasta, 1)).toISOString(),
  };
}

const horaMinuto = { hour: "2-digit", minute: "2-digit", hour12: false } as const;
const formatoHora = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA_NEGOCIO, ...horaMinuto });
const formatoFechaHora = new Intl.DateTimeFormat("es-PE", {
  timeZone: ZONA_NEGOCIO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  ...horaMinuto,
});
// Las partes se arman a mano: con día y mes sin año, el ICU de es-PE da "26/9" en unas versiones y "26/09" en otras.
const formatoPartes = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONA_NEGOCIO,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  ...horaMinuto,
});
const DIA_SEMANA: Record<string, string> = { Mon: "lun", Tue: "mar", Wed: "mié", Thu: "jue", Fri: "vie", Sat: "sáb", Sun: "dom" };

function partes(fecha: Date): Record<string, string> {
  return Object.fromEntries(formatoPartes.formatToParts(fecha).map((p) => [p.type, p.value]));
}

/** "14:30", en hora de Lima. */
export const hora = (valor: Date | string): string => formatoHora.format(instante(valor));
/** "26/09/2026, 14:30", en hora de Lima. */
export const fechaHora = (valor: Date | string): string => formatoFechaHora.format(instante(valor));
/** "26/09, 14:30", en hora de Lima: para pantallas donde el año sobra. */
export function fechaHoraCorta(valor: Date | string): string {
  const p = partes(instante(valor));
  return `${p.day}/${p.month}, ${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

/** Un día de Lima para leer: "2026-09-26" → "sáb, 26/09". */
export function nombreDia(dia: Dia): string {
  // Mediodía de Lima: el día de la semana no se corre con la zona.
  const p = partes(new Date(`${dia}T12:00:00.000-05:00`));
  validarDia(dia);
  return `${DIA_SEMANA[p.weekday ?? ""] ?? p.weekday}, ${p.day}/${p.month}`;
}

/** "1 h 05 min" o "12 min" a partir de milisegundos (se toma el valor absoluto). */
export function duracion(ms: number): string {
  const minutos = Math.floor(Math.abs(ms) / 60_000);
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

/** "hace menos de un minuto", "hace 12 min", "hace 2 h 10 min", "hace 3 días": solo orientativo. */
export function hace(valor: Date | string, ahora: Date = new Date()): string {
  const minutos = Math.max(0, Math.round((ahora.getTime() - instante(valor).getTime()) / 60_000));
  if (minutos < 1) return "hace menos de un minuto";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `hace ${horas} h${minutos % 60 === 0 ? "" : ` ${minutos % 60} min`}`;
  return `hace ${Math.floor(horas / 24)} días`;
}
