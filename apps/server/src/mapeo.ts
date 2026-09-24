import {
  AlquilerSchema,
  HabitacionSchema,
  HoraAdicionalSchema,
  MetodoPagoSchema,
  ParametrosTiempoPrecioSchema,
  PermisoSchema,
  ProductoSchema,
  RangoSchema,
  TicketSchema,
  TurnoSchema,
  UsuarioSchema,
  type Alquiler,
  type Habitacion,
  type HoraAdicional,
  type MetodoPago,
  type ParametrosTiempoPrecio,
  type Producto,
  type Rango,
  type Ticket,
  type Turno,
  type Usuario,
} from "@apurimeno/contracts";
import type * as Db from "./generated/prisma/client.js";
import { Prisma } from "./generated/prisma/client.js";

// Convierte entre filas de Prisma y objetos del contrato. Cada salida se valida con su esquema:
// una fila que no cumple el contrato es un defecto y se detecta aquí, no en el cliente.

function iso(fecha: Date): string {
  return fecha.toISOString();
}

function isoONulo(fecha: Date | null): string | null {
  return fecha === null ? null : fecha.toISOString();
}

export function fecha(valor: string): Date {
  return new Date(valor);
}

export function fechaONula(valor: string | null): Date | null {
  return valor === null ? null : new Date(valor);
}

/** Json nulo en Prisma se escribe con DbNull, no con `null`. */
export function jsonONulo(valor: object | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return valor === null ? Prisma.DbNull : (valor as Prisma.InputJsonValue);
}

export function aHabitacion(fila: Db.Habitacion): Habitacion {
  return HabitacionSchema.parse({
    id: fila.id,
    numero: fila.numero,
    descripcion: fila.descripcion,
    precioBase: fila.precioBase,
    estado: fila.estado,
  });
}

export function aParametros(valor: unknown): ParametrosTiempoPrecio {
  return ParametrosTiempoPrecioSchema.parse(valor);
}

export function aAlquiler(fila: Db.Alquiler): Alquiler {
  return AlquilerSchema.parse({
    id: fila.id,
    habitacionId: fila.habitacionId,
    clienteId: fila.clienteId,
    turnoId: fila.turnoId,
    estado: fila.estado,
    ingresoEn: iso(fila.ingresoEn),
    salidaProgramadaEn: iso(fila.salidaProgramadaEn),
    cortesiaConsumida: fila.cortesiaConsumida,
    origenPrecio: fila.origenPrecio,
    precioHabitacionAplicado: fila.precioHabitacionAplicado,
    horasAdicionalesAlIngreso: fila.horasAdicionalesAlIngreso,
    parametrosAplicados: fila.parametrosAplicados,
    cerradoEn: isoONulo(fila.cerradoEn),
    cerradoPorId: fila.cerradoPorId,
    salidaSinPago: fila.salidaSinPago,
    motivoSalidaSinPago: fila.motivoSalidaSinPago,
  });
}

export function datosAlquiler(a: Alquiler) {
  return {
    ...a,
    ingresoEn: fecha(a.ingresoEn),
    salidaProgramadaEn: fecha(a.salidaProgramadaEn),
    cerradoEn: fechaONula(a.cerradoEn),
    parametrosAplicados: a.parametrosAplicados,
  };
}

export function aHoraAdicional(fila: Db.HoraAdicional): HoraAdicional {
  return HoraAdicionalSchema.parse({
    id: fila.id,
    alquilerId: fila.alquilerId,
    ticketId: fila.ticketId,
    tipo: fila.tipo,
    salidaAnterior: iso(fila.salidaAnterior),
    salidaNueva: iso(fila.salidaNueva),
    creadoPorId: fila.creadoPorId,
    creadoEn: iso(fila.creadoEn),
  });
}

export function aTurno(fila: Db.Turno): Turno {
  return TurnoSchema.parse({
    id: fila.id,
    usuarioId: fila.usuarioId,
    estado: fila.estado,
    abiertoEn: iso(fila.abiertoEn),
    efectivoInicial: fila.efectivoInicial,
    cerradoEn: isoONulo(fila.cerradoEn),
    cerradoPorId: fila.cerradoPorId,
    cierreForzado: fila.cierreForzado,
    efectivoContado: fila.efectivoContado,
    efectivoEsperado: fila.efectivoEsperado,
    diferencia: fila.diferencia,
    comentarioCierre: fila.comentarioCierre,
  });
}

export function datosTurno(t: Turno) {
  return { ...t, abiertoEn: fecha(t.abiertoEn), cerradoEn: fechaONula(t.cerradoEn) };
}

export type FilaTicket = Db.Ticket & { lineas: Db.LineaTicket[]; pagos: Db.Pago[] };

export const INCLUIR_TICKET = {
  lineas: { orderBy: { posicion: "asc" } },
  pagos: { orderBy: { posicion: "asc" } },
} as const;

export function aTicket(fila: FilaTicket): Ticket {
  return TicketSchema.parse({
    id: fila.id,
    numero: fila.numero,
    tipo: fila.tipo,
    origen: fila.origen,
    estado: fila.estado,
    turnoId: fila.turnoId,
    alquilerId: fila.alquilerId,
    habitacionReferenciaId: fila.habitacionReferenciaId,
    ticketOriginalId: fila.ticketOriginalId,
    total: fila.total,
    ajustePuntual: fila.ajustePuntual,
    anulacion: fila.anulacion,
    lineas: fila.lineas.map((l) => ({
      id: l.id,
      tipo: l.tipo,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      importe: l.importe,
      productoId: l.productoId,
    })),
    pagos: fila.pagos.map((p) => ({
      id: p.id,
      metodoPagoId: p.metodoPagoId,
      monto: p.monto,
      referencia: p.referencia,
      montoRecibido: p.montoRecibido,
      vuelto: p.vuelto,
    })),
    creadoPorId: fila.creadoPorId,
    creadoEn: iso(fila.creadoEn),
  });
}

/** Datos para crear un ticket con sus líneas y pagos, en el orden del contrato. */
export function datosTicket(t: Ticket, claveIdempotencia: string | null): Prisma.TicketUncheckedCreateInput {
  return {
    id: t.id,
    numero: t.numero,
    tipo: t.tipo,
    origen: t.origen,
    estado: t.estado,
    turnoId: t.turnoId,
    alquilerId: t.alquilerId,
    habitacionReferenciaId: t.habitacionReferenciaId,
    ticketOriginalId: t.ticketOriginalId,
    total: t.total,
    ajustePuntual: jsonONulo(t.ajustePuntual),
    anulacion: jsonONulo(t.anulacion),
    creadoPorId: t.creadoPorId,
    creadoEn: fecha(t.creadoEn),
    claveIdempotencia,
    lineas: { create: t.lineas.map((l, posicion) => ({ ...l, posicion })) },
    pagos: { create: t.pagos.map((p, posicion) => ({ ...p, posicion })) },
  };
}

export function aMetodoPago(fila: Db.MetodoPago): MetodoPago {
  return MetodoPagoSchema.parse({
    id: fila.id,
    nombre: fila.nombre,
    afectaCaja: fila.afectaCaja,
    requiereReferencia: fila.requiereReferencia,
    activo: fila.activo,
  });
}

export function aProducto(fila: Db.Producto): Producto {
  return ProductoSchema.parse({
    id: fila.id,
    categoriaId: fila.categoriaId,
    nombre: fila.nombre,
    codigoBarras: fila.codigoBarras,
    precioHuesped: fila.precioHuesped,
    precioPublico: fila.precioPublico,
    controlaStock: fila.controlaStock,
    stock: fila.stock,
    activo: fila.activo,
  });
}

export type FilaUsuario = Db.Usuario & {
  rangos: (Db.UsuarioRango & { rango: Db.Rango & { permisos: Db.RangoPermiso[] } })[];
};

export const INCLUIR_USUARIO = { rangos: { include: { rango: { include: { permisos: true } } } } } as const;

/** El hash de la contraseña no forma parte del contrato: `UsuarioSchema` es estricto y lo rechazaría. */
export function aUsuario(fila: FilaUsuario): Usuario {
  return UsuarioSchema.parse({
    id: fila.id,
    nombreUsuario: fila.nombreUsuario,
    activo: fila.activo,
    rangoIds: fila.rangos.map((r) => r.rangoId),
  });
}

export function aRangos(fila: FilaUsuario): Rango[] {
  return fila.rangos.map((r) =>
    RangoSchema.parse({
      id: r.rango.id,
      nombre: r.rango.nombre,
      permisos: r.rango.permisos.map((p) => PermisoSchema.parse(p.permiso)),
    }),
  );
}
