import {
  PARAMETROS_TIEMPO_PRECIO_INICIALES,
  type Alquiler,
  type Habitacion,
  type MetodoPago,
  type Producto,
  type Turno,
} from "@apurimeno/contracts";
import type { Contexto } from "../src/index.js";

// Supuestos de la tabla §16.10: habitación S/ 30.00, 8 horas base, cortesía 15 min, hora adicional S/ 8.00.
export const PARAMETROS = PARAMETROS_TIEMPO_PRECIO_INICIALES;

/** Hora UTC del 23/09/2026, ej. en("14:00"). */
export function en(hora: string, dia = 23): string {
  return `2026-09-${dia}T${hora}:00.000Z`;
}

let ultimoId = 0;

/** Ids únicos en todas las pruebas, como los generaría el backend. */
export function contexto(ahora: string): Contexto {
  return { ahora, generarId: () => `id-${++ultimoId}` };
}

export function habitacion(parcial: Partial<Habitacion> = {}): Habitacion {
  return { id: "hab-205", numero: "205", descripcion: null, precioBase: 3000, estado: "LIBRE", ...parcial };
}

export function turnoAbierto(parcial: Partial<Turno> = {}): Turno {
  return {
    id: "turno-1",
    usuarioId: "cajero-1",
    estado: "ABIERTO",
    abiertoEn: en("08:00"),
    efectivoInicial: 10000,
    cerradoEn: null,
    cerradoPorId: null,
    cierreForzado: false,
    efectivoContado: null,
    efectivoEsperado: null,
    diferencia: null,
    ...parcial,
  };
}

export const turnoCerrado = turnoAbierto({
  estado: "CERRADO",
  cerradoEn: en("20:00"),
  cerradoPorId: "cajero-1",
  efectivoContado: 10000,
  efectivoEsperado: 10000,
  diferencia: 0,
});

/** Alquiler abierto con ingreso a las 14:00 y salida programada a las 22:00. */
export function alquiler(parcial: Partial<Alquiler> = {}): Alquiler {
  return {
    id: "alq-1",
    habitacionId: "hab-205",
    clienteId: null,
    turnoId: "turno-1",
    estado: "ABIERTO",
    ingresoEn: en("14:00"),
    salidaProgramadaEn: en("22:00"),
    cortesiaConsumida: false,
    origenPrecio: "LISTA",
    precioHabitacionAplicado: 3000,
    horasAdicionalesAlIngreso: 0,
    parametrosAplicados: PARAMETROS,
    cerradoEn: null,
    cerradoPorId: null,
    salidaSinPago: false,
    motivoSalidaSinPago: null,
    ...parcial,
  };
}

/** Alquiler abierto cuya salida programada es `hora`, con el ingreso 8 horas antes. */
export function alquilerConSalida(hora: string, parcial: Partial<Alquiler> = {}): Alquiler {
  const salida = en(hora);
  return alquiler({ ingresoEn: new Date(Date.parse(salida) - 8 * 3_600_000).toISOString(), salidaProgramadaEn: salida, ...parcial });
}

export const EFECTIVO: MetodoPago = { id: "efectivo", nombre: "Efectivo", afectaCaja: true, requiereReferencia: false, activo: true };
export const YAPE: MetodoPago = { id: "yape", nombre: "Yape", afectaCaja: false, requiereReferencia: false, activo: true };

export function producto(parcial: Partial<Producto> = {}): Producto {
  return {
    id: "prod-gaseosa",
    categoriaId: "cat-bebidas",
    nombre: "Gaseosa",
    codigoBarras: null,
    precioHuesped: 300,
    precioPublico: 350,
    controlaStock: true,
    stock: 10,
    activo: true,
    ...parcial,
  };
}
