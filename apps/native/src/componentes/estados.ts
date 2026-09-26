import type {
  EstadoHabitacion,
  EstadoTemporalAlquiler,
} from "@apurimeno/contracts";

// Color y texto de cada estado en el tablero. El color nunca va solo: siempre acompaña una etiqueta.

export const ESTADO_HABITACION: Record<
  EstadoHabitacion,
  { etiqueta: string; tarjeta: string; insignia: string }
> = {
  LIBRE: {
    etiqueta: "Libre",
    tarjeta: "border-emerald-500 bg-emerald-50",
    insignia: "bg-emerald-600 text-white",
  },
  OCUPADA: {
    etiqueta: "Ocupada",
    tarjeta: "border-sky-500 bg-sky-50",
    insignia: "bg-sky-600 text-white",
  },
  PENDIENTE_LIMPIEZA: {
    etiqueta: "Por limpiar",
    tarjeta: "border-violet-400 bg-violet-50",
    insignia: "bg-violet-600 text-white",
  },
  MANTENIMIENTO: {
    etiqueta: "Mantenimiento",
    tarjeta: "border-zinc-400 bg-zinc-100",
    insignia: "bg-zinc-600 text-white",
  },
};

export const ESTADO_TEMPORAL: Record<
  EstadoTemporalAlquiler,
  { etiqueta: string; tarjeta: string; insignia: string }
> = {
  A_TIEMPO: {
    etiqueta: "A tiempo",
    tarjeta: "border-sky-500 bg-sky-50",
    insignia: "bg-sky-600 text-white",
  },
  POR_VENCER: {
    etiqueta: "Por vencer",
    tarjeta: "border-amber-500 bg-amber-50",
    insignia: "bg-amber-500 text-black",
  },
  EN_CORTESIA: {
    etiqueta: "En cortesía",
    tarjeta: "border-orange-500 bg-orange-50",
    insignia: "bg-orange-600 text-white",
  },
  EN_SOBRETIEMPO: {
    etiqueta: "Sobretiempo",
    tarjeta: "border-red-600 bg-red-50",
    insignia: "bg-red-600 text-white",
  },
};
