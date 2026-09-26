import {
  PARAMETROS_TIEMPO_PRECIO_INICIALES,
  type DatosComprobante,
  type MetodoPago,
  type Producto,
  type Turno,
} from "@apurimeno/contracts";
import {
  armarTicketCobro,
  componerLineasComprobante,
  cotizarIngreso,
  cotizarVenta,
  pagoEnEfectivo,
  pagoSinVuelto,
  type LineaComprobante,
} from "@apurimeno/domain";
import type { PaginaCodigos } from "../../src/impresion/escpos.js";

// Casos fijos del comprobante impreso. `casos.json` guarda sus líneas (texto y estilo), y
// `generar_esperados.py` produce con ellas los bytes esperados (*.hex) usando los códecs cp850 y cp1252 de
// Python, que no comparten código con escpos.ts. Si cambia el diseño del comprobante:
//   pnpm exec tsx test/impresion/volcar-casos.ts && python3 test/impresion/generar_esperados.py
// y revisar el diff de los .hex antes de aceptarlo.

const EFECTIVO: MetodoPago = { id: "efectivo", nombre: "Efectivo", afectaCaja: true, requiereReferencia: false, activo: true };
const YAPE: MetodoPago = { id: "yape", nombre: "Yape", afectaCaja: false, requiereReferencia: true, activo: true };

const DATOS: DatosComprobante = {
  nombreNegocio: "Hospedaje El Apurimeño",
  datosAdicionales: "Jr. Ñaupa 123 — Andahuaylas",
  leyenda: "Documento interno sin valor tributario.",
};

const TURNO: Turno = {
  id: "turno-1",
  usuarioId: "cajero-1",
  estado: "ABIERTO",
  abiertoEn: "2026-09-23T13:00:00.000Z",
  efectivoInicial: 0,
  cerradoEn: null,
  cerradoPorId: null,
  cierreForzado: false,
  efectivoContado: null,
  efectivoEsperado: null,
  diferencia: null,
  comentarioCierre: null,
};

let ultimoId = 0;
const contexto = (ahora: string) => ({ ahora, generarId: () => `id-${++ultimoId}` });

const producto = (id: string, nombre: string, precioPublico: number): Producto => ({
  id,
  categoriaId: "cat-1",
  nombre,
  codigoBarras: null,
  precioHuesped: precioPublico,
  precioPublico,
  controlaStock: false,
  stock: 0,
  activo: true,
});

/** Ingreso a la 205 con 2 horas pagadas al ingreso, en efectivo con vuelto: ó, ñ y raya "—". */
function ingreso() {
  const cotizacion = cotizarIngreso({
    habitacion: { id: "hab-205", numero: "205", descripcion: null, precioBase: 4000, estado: "LIBRE" },
    clienteId: null,
    preciosEspeciales: [],
    parametros: PARAMETROS_TIEMPO_PRECIO_INICIALES,
    horasAdicionalesAlIngreso: 2,
  });
  return armarTicketCobro(
    {
      numero: 1045,
      origen: "INGRESO_ALQUILER",
      turno: TURNO,
      alquilerId: "alq-1",
      habitacionReferenciaId: null,
      cotizacion,
      pagos: [pagoEnEfectivo(EFECTIVO.id, cotizacion.total, 6000)],
      creadoPorId: "cajero-1",
    },
    contexto("2026-09-23T19:42:00.000Z"),
  );
}

/** Venta de tienda con tildes, "ñ" y signos de apertura, pagada con Yape y número de operación. */
function venta() {
  return armarTicketCobro(
    {
      numero: 1046,
      origen: "VENTA_TIENDA",
      turno: TURNO,
      alquilerId: null,
      habitacionReferenciaId: null,
      cotizacion: cotizarVenta(
        [
          { producto: producto("p-1", "Café pasado", 250), cantidad: 2 },
          { producto: producto("p-2", "Piña en almíbar ¡nueva!", 450), cantidad: 1 },
        ],
        false,
      ),
      pagos: [pagoSinVuelto(YAPE.id, 950, "004521")],
      creadoPorId: "cajero-1",
    },
    contexto("2026-09-23T20:05:00.000Z"),
  );
}

export interface CasoComprobante {
  nombre: string;
  paginaCodigos: PaginaCodigos;
  lineas: LineaComprobante[];
}

export function casos(): CasoComprobante[] {
  const metodosPago = [EFECTIVO, YAPE];
  return [
    {
      nombre: "ingreso-80mm-pc850",
      paginaCodigos: "PC850",
      lineas: componerLineasComprobante(ingreso(), { datos: DATOS, anchoPapelMm: 80, metodosPago, esCopia: false }),
    },
    {
      nombre: "venta-copia-58mm-pc850",
      paginaCodigos: "PC850",
      lineas: componerLineasComprobante(venta(), { datos: DATOS, anchoPapelMm: 58, metodosPago, esCopia: true }),
    },
    {
      nombre: "venta-copia-80mm-wpc1252",
      paginaCodigos: "WPC1252",
      lineas: componerLineasComprobante(venta(), { datos: DATOS, anchoPapelMm: 80, metodosPago, esCopia: true }),
    },
  ];
}
