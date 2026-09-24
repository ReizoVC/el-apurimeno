import { EstadoHabitacion, type Habitacion } from "@apurimeno/contracts";

export const HABITACIONES_MOCK: Habitacion[] = [
  {
    id: "hab-101",
    numero: "101",
    descripcion: "Sin baño propio",
    precioBase: 2500,
    estado: EstadoHabitacion.PENDIENTE_LIMPIEZA,
  },
  {
    id: "hab-105",
    numero: "105",
    descripcion: "Grande, con baño propio",
    precioBase: 4000,
    estado: EstadoHabitacion.PENDIENTE_LIMPIEZA,
  },
  {
    id: "hab-202",
    numero: "202",
    descripcion: "Con baño propio",
    precioBase: 3000,
    estado: EstadoHabitacion.PENDIENTE_LIMPIEZA,
  },
  {
    id: "hab-205",
    numero: "205",
    descripcion: "Grande, con baño propio",
    precioBase: 4000,
    estado: EstadoHabitacion.PENDIENTE_LIMPIEZA,
  },
  {
    id: "hab-301",
    numero: "301",
    descripcion: "Con baño propio",
    precioBase: 3000,
    estado: EstadoHabitacion.PENDIENTE_LIMPIEZA,
  },
  {
    id: "hab-304",
    numero: "304",
    descripcion: "Con baño propio",
    precioBase: 3000,
    estado: EstadoHabitacion.LIBRE,
  },
];

export async function obtenerHabitaciones(): Promise<Habitacion[]> {
  return HABITACIONES_MOCK;
}

export async function marcarHabitacionLista(id: string): Promise<void> {
  console.log(`[API Mock] Habitación ${id} marcada como lista`);
}

export async function reportarMantenimiento(id: string): Promise<void> {
  console.log(`[API Mock] Habitación ${id} reportada para mantenimiento`);
}
