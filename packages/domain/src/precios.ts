import type {
  AjustePuntual,
  Alquiler,
  Centimos,
  Habitacion,
  Id,
  LineaTicket,
  OrigenPrecioAlquiler,
  ParametrosTiempoPrecio,
  PrecioEspecialCliente,
  Producto,
} from "@apurimeno/contracts";
import { ErrorNegocio } from "./errores.js";
import { asegurarCentimos, asegurarEnteroPositivo, motivoRequerido } from "./interno.js";

/** Línea de ticket antes de persistirse: el backend le asigna `id`. */
export type BorradorLinea = Omit<LineaTicket, "id">;

/** Monto a cobrar por una operación, antes de recibir el pago. */
export interface Cotizacion {
  lineas: BorradorLinea[];
  total: Centimos;
  ajustePuntual: AjustePuntual | null;
}

function sumar(lineas: readonly BorradorLinea[]): Centimos {
  return lineas.reduce((total, linea) => total + linea.importe, 0);
}

function linea(
  tipo: BorradorLinea["tipo"],
  descripcion: string,
  cantidad: number,
  precioUnitario: number,
  productoId: Id | null = null,
): BorradorLinea {
  return { tipo, descripcion, cantidad, precioUnitario, importe: cantidad * precioUnitario, productoId };
}

/**
 * Precio de la habitación para un ingreso (RN-13, RN-14, RN-15, RF-02, RF-17).
 * El precio especial reemplaza al de lista, y solo si coincide exactamente el cliente y la habitación.
 */
export function resolverPrecioHabitacion(
  habitacion: Habitacion,
  clienteId: Id | null,
  preciosEspeciales: readonly PrecioEspecialCliente[],
): { origenPrecio: OrigenPrecioAlquiler; precio: Centimos } {
  const especial =
    clienteId === null
      ? undefined
      : preciosEspeciales.find((p) => p.clienteId === clienteId && p.habitacionId === habitacion.id);
  return especial === undefined
    ? { origenPrecio: "LISTA", precio: habitacion.precioBase }
    : { origenPrecio: "PRECIO_ESPECIAL", precio: especial.precio };
}

export interface CotizacionIngreso extends Cotizacion {
  origenPrecio: OrigenPrecioAlquiler;
  precioHabitacion: Centimos;
  horasAdicionalesAlIngreso: number;
}

export interface DatosCotizacionIngreso {
  habitacion: Habitacion;
  clienteId: Id | null;
  preciosEspeciales: readonly PrecioEspecialCliente[];
  /** Configuración vigente en este momento: se copia al alquiler (RN-43). */
  parametros: ParametrosTiempoPrecio;
  horasAdicionalesAlIngreso: number;
}

/**
 * Total de un ingreso: precio de la habitación + horas pagadas al ingreso × precio de hora adicional
 * (RN-08 caso a, RN-10, RF-64). Ej. T-16: 30.00 + 2 × 8.00 = 46.00.
 * Las descripciones nunca incluyen datos del cliente (RN-38).
 */
export function cotizarIngreso(datos: DatosCotizacionIngreso): CotizacionIngreso {
  const { habitacion, parametros, horasAdicionalesAlIngreso } = datos;
  if (!Number.isSafeInteger(horasAdicionalesAlIngreso) || horasAdicionalesAlIngreso < 0) {
    throw new RangeError(`Horas adicionales al ingreso inválidas: ${horasAdicionalesAlIngreso}`);
  }
  const { origenPrecio, precio } = resolverPrecioHabitacion(habitacion, datos.clienteId, datos.preciosEspeciales);

  const lineas = [
    linea("BASE_HABITACION", `Habitación ${habitacion.numero} — ${parametros.horasBase} horas`, 1, precio),
  ];
  if (horasAdicionalesAlIngreso > 0) {
    lineas.push(
      linea("HORA_ADICIONAL", "Horas adicionales", horasAdicionalesAlIngreso, parametros.precioHoraAdicional),
    );
  }
  return {
    origenPrecio,
    precioHabitacion: precio,
    horasAdicionalesAlIngreso,
    lineas,
    total: sumar(lineas),
    ajustePuntual: null,
  };
}

/**
 * Una hora adicional al precio copiado al ingreso del alquiler (RN-09, RN-10, RN-43).
 * No depende del precio de la habitación ni del precio especial del cliente.
 */
export function cotizarHoraAdicional(alquiler: Pick<Alquiler, "parametrosAplicados">): Cotizacion {
  const lineas = [linea("HORA_ADICIONAL", "Hora adicional", 1, alquiler.parametrosAplicados.precioHoraAdicional)];
  return { lineas, total: sumar(lineas), ajustePuntual: null };
}

/**
 * Ajuste puntual del cajero (RN-17, RN-18, RN-19, RF-19, RF-20): solo al alza y con motivo.
 * Devuelve una cotización nueva; la original no cambia y nada queda guardado como regla.
 */
export function aplicarAjustePuntual(cotizacion: Cotizacion, montoAjustado: number, motivo: string): Cotizacion {
  if (cotizacion.ajustePuntual !== null) {
    throw new RangeError("La cotización ya tiene un ajuste puntual.");
  }
  const motivoLimpio = motivoRequerido(motivo);
  asegurarCentimos(montoAjustado, "montoAjustado");
  if (montoAjustado < cotizacion.total) throw new ErrorNegocio("ADJUSTMENT_BELOW_MINIMUM");

  const diferencia = montoAjustado - cotizacion.total;
  return {
    lineas: [...cotizacion.lineas, linea("AJUSTE_PUNTUAL", "Ajuste", 1, diferencia)],
    total: montoAjustado,
    ajustePuntual: { montoOriginal: cotizacion.total, montoAjustado, motivo: motivoLimpio },
  };
}

/** Precio de un producto según el comprador (RN-20). */
export function precioProducto(producto: Producto, esHuesped: boolean): Centimos {
  return esHuesped ? producto.precioHuesped : producto.precioPublico;
}

export interface ItemVenta {
  producto: Producto;
  cantidad: number;
}

/**
 * Venta de tienda (RN-20, RN-22, RN-24, RF-21, RF-22).
 * `esHuesped` lo indica el cajero de forma explícita; nadie lo infiere, porque la tienda no conoce
 * alquileres (RES-02). Asociar la venta a una habitación es opcional.
 */
export function cotizarVenta(items: readonly ItemVenta[], esHuesped: boolean): Cotizacion {
  if (items.length === 0) throw new RangeError("Una venta tiene al menos un producto.");
  const lineas = items.map(({ producto, cantidad }) => {
    asegurarEnteroPositivo(cantidad, `cantidad de ${producto.nombre}`);
    return linea("PRODUCTO", producto.nombre, cantidad, precioProducto(producto, esHuesped), producto.id);
  });
  return { lineas, total: sumar(lineas), ajustePuntual: null };
}
