import {
  ProductoSchema,
  RUTAS,
  RegistrarIngresoRespuestaSchema,
  ReporteArqueosSchema,
  ReporteOcupacionSchema,
  ReporteVentasSchema,
  ReposicionRespuestaSchema,
  TicketSchema,
} from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { efectivo, prepararEntorno, ruta, yape, type Entorno } from "./entorno.js";

let e: Entorno;
let cajero: string;
let admin: string;

beforeEach(async () => {
  e = await prepararEntorno();
  cajero = await e.login("cajero");
  admin = await e.login("admin");
  await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 10000 });
});
afterEach(() => e.cerrar());

const nuevoProducto = (extra: Record<string, unknown> = {}) => ({
  categoriaId: "cat-bebidas",
  nombre: "Gaseosa 500 ml",
  codigoBarras: "7750000000001",
  precioHuesped: 300,
  precioPublico: 350,
  controlaStock: true,
  activo: true,
  ...extra,
});

async function prepararCatalogo(): Promise<string> {
  expect((await e.llamar("POST", RUTAS.categoriasProducto, admin, { nombre: "Bebidas" })).statusCode).toBe(201);
  const categoriaId = (await e.prisma.categoriaProducto.findFirstOrThrow()).id;
  const creado = await e.llamar("POST", RUTAS.productos, admin, nuevoProducto({ categoriaId }));
  expect(creado.statusCode).toBe(201);
  const producto = ProductoSchema.parse(creado.json());
  expect(producto.stock).toBe(0);
  const repuesto = await e.llamar("POST", ruta(RUTAS.reponerProducto, producto.id), admin, { cantidad: 24 });
  expect(ReposicionRespuestaSchema.parse(repuesto.json())).toMatchObject({ producto: { stock: 24 }, movimiento: { tipo: "REPOSICION", cantidad: 24 } });
  return producto.id;
}

const venta = (productoId: string, esHuesped: boolean, habitacionReferenciaId: string | null, pagos: unknown[]) => ({
  items: [{ productoId, cantidad: 2 }],
  esHuesped,
  habitacionReferenciaId,
  ajuste: null,
  pagos,
});

describe("Tienda por HTTP (CU-11, CU-12, CU-29)", () => {
  it("catálogo: el Administrador crea y repone; el Cajero ve el catálogo y lo busca por código de barras", async () => {
    const productoId = await prepararCatalogo();
    const porCodigo = await e.llamar("GET", `${RUTAS.productos}?codigoBarras=7750000000001`, cajero);
    expect(ProductoSchema.array().parse(porCodigo.json()).map((p) => p.id)).toEqual([productoId]);
    expect((await e.llamar("GET", `${RUTAS.productos}?codigoBarras=000`, cajero)).json()).toEqual([]);
  });

  it("un producto desactivado sale del catálogo de venta, pero la gestión lo sigue viendo para reactivarlo", async () => {
    const productoId = await prepararCatalogo();
    const categoriaId = (await e.prisma.categoriaProducto.findFirstOrThrow()).id;
    await e.llamar("PUT", ruta(RUTAS.producto, productoId), admin, nuevoProducto({ categoriaId, activo: false }));
    expect((await e.llamar("GET", RUTAS.productos, cajero)).json()).toEqual([]);
    expect((await e.llamar("GET", `${RUTAS.productos}?incluirInactivos=false`, admin)).json()).toEqual([]);
    const todos = ProductoSchema.array().parse((await e.llamar("GET", `${RUTAS.productos}?incluirInactivos=true`, admin)).json());
    expect(todos).toMatchObject([{ id: productoId, activo: false, stock: 24 }]);
    // Quien solo vende no ve los inactivos.
    expect((await e.llamar("GET", `${RUTAS.productos}?incluirInactivos=true`, cajero)).statusCode).toBe(403);
    expect((await e.llamar("GET", `${RUTAS.productos}?incluirInactivos=si`, admin)).statusCode).toBe(400);
  });

  it("el Cajero no gestiona el catálogo ni repone (RN-25)", async () => {
    const productoId = await prepararCatalogo();
    expect((await e.llamar("POST", RUTAS.productos, cajero, nuevoProducto())).statusCode).toBe(403);
    expect((await e.llamar("POST", ruta(RUTAS.reponerProducto, productoId), cajero, { cantidad: 1 })).statusCode).toBe(403);
  });

  it("el código de barras es único entre productos (decisión 14 de contracts)", async () => {
    const productoId = await prepararCatalogo();
    const categoriaId = (await e.prisma.categoriaProducto.findFirstOrThrow()).id;
    const duplicado = await e.llamar("POST", RUTAS.productos, admin, nuevoProducto({ categoriaId, nombre: "Otra" }));
    expect(duplicado.json()).toMatchObject({ codigo: "VALIDACION" });
    // Editar el mismo producto conservando su código sí se permite, y el cambio de precio queda auditado.
    const editado = await e.llamar("PUT", ruta(RUTAS.producto, productoId), admin, nuevoProducto({ categoriaId, precioPublico: 400 }));
    expect(ProductoSchema.parse(editado.json())).toMatchObject({ precioPublico: 400, stock: 24 });
    expect(await e.prisma.registroAuditoria.findFirst({ where: { accion: "PRODUCTO_EDITADO" } })).not.toBeNull();
  });

  it("vende con esHuesped explícito: huésped S/ 3.00 c/u, público S/ 3.50 c/u, y descuenta stock", async () => {
    const productoId = await prepararCatalogo();
    const huesped = await e.llamar("POST", RUTAS.registrarVenta, cajero, venta(productoId, true, "hab-107", [efectivo(600)]), "clave-v-1");
    expect(huesped.statusCode).toBe(201);
    expect(TicketSchema.parse(huesped.json())).toMatchObject({ total: 600, habitacionReferenciaId: "hab-107", alquilerId: null });
    const publico = await e.llamar("POST", RUTAS.registrarVenta, cajero, venta(productoId, false, null, [yape(700)]), "clave-v-2");
    expect(TicketSchema.parse(publico.json()).total).toBe(700);
    expect((await e.prisma.producto.findUniqueOrThrow({ where: { id: productoId } })).stock).toBe(20);
  });

  it("una venta a público asociada a una habitación no cumple el contrato (400)", async () => {
    const productoId = await prepararCatalogo();
    const r = await e.llamar("POST", RUTAS.registrarVenta, cajero, venta(productoId, false, "hab-107", [efectivo(700)]), "clave-v-3");
    expect(r.statusCode).toBe(400);
  });

  it("un ajuste en la venta exige store.manual_adjustment y queda auditado", async () => {
    const productoId = await prepararCatalogo();
    const conAjuste = { ...venta(productoId, false, null, [efectivo(800)]), ajuste: { montoAjustado: 800, motivo: "botella helada" } };
    expect((await e.llamar("POST", RUTAS.registrarVenta, cajero, conAjuste, "clave-v-4")).statusCode).toBe(201);
    expect(await e.prisma.registroAuditoria.findFirst({ where: { accion: "AJUSTE_PUNTUAL_APLICADO" } })).toMatchObject({ motivo: "botella helada" });
  });
});

describe("Reportes (§25)", () => {
  const periodo = `?desde=2026-09-23T00:00:00.000Z&hasta=2026-09-25T00:00:00.000Z`;

  it("ventas: solo tickets vigentes, con desgloses que cuadran (RF-47)", async () => {
    const productoId = await prepararCatalogo();
    const { alquiler } = RegistrarIngresoRespuestaSchema.parse(
      (
        await e.llamar(
          "POST",
          RUTAS.registrarIngreso,
          cajero,
          { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
          "clave-r-1",
        )
      ).json(),
    );
    await e.llamar("POST", ruta(RUTAS.registrarHoraAdicional, alquiler.id), cajero, { ajuste: null, pagos: [yape(800)] }, "clave-r-2");
    const anulada = await e.llamar("POST", RUTAS.registrarVenta, cajero, venta(productoId, false, null, [efectivo(700)]), "clave-r-3");
    await e.llamar("POST", RUTAS.abrirTurno, admin, { efectivoInicial: 0 });
    await e.llamar("POST", ruta(RUTAS.anularTicket, anulada.json<{ id: string }>().id), admin, { motivo: "error", codigoAutorizacion: null }, "clave-r-4");

    const r = await e.llamar("GET", `${RUTAS.reporteVentas}${periodo}`, admin);
    expect(r.statusCode).toBe(200);
    const reporte = ReporteVentasSchema.parse(r.json());
    expect(reporte).toMatchObject({ total: 4800, cantidadTickets: 2 });
    expect(reporte.porOrigen).toEqual([
      { origen: "INGRESO_ALQUILER", total: 4000 },
      { origen: "HORA_ADICIONAL", total: 800 },
    ]);
    expect(reporte.porMetodoPago).toEqual([
      { metodoPagoId: "metodo-efectivo", total: 4000 },
      { metodoPagoId: "metodo-yape", total: 800 },
    ]);
    expect(reporte.porDia).toEqual([{ dia: "2026-09-23", total: 4800 }]);
    expect(reporte.porProducto).toEqual([]);
  });

  it("arqueos y ocupación del periodo", async () => {
    await e.llamar(
      "POST",
      RUTAS.registrarIngreso,
      cajero,
      { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 2, ajuste: null, pagos: [efectivo(5600)] },
      "clave-o-1",
    );
    await e.llamar("POST", RUTAS.cerrarTurno, cajero, { efectivoContado: 15500, comentario: "faltó S/ 1.00" });

    const arqueos = ReporteArqueosSchema.parse((await e.llamar("GET", `${RUTAS.reporteArqueos}${periodo}`, admin)).json());
    expect(arqueos).toMatchObject({ diferenciaTotal: -100, turnosConDiferencia: 1 });
    expect(arqueos.turnos[0]).toMatchObject({ efectivoEsperado: 15600, comentarioCierre: "faltó S/ 1.00" });

    const ocupacion = ReporteOcupacionSchema.parse((await e.llamar("GET", `${RUTAS.reporteOcupacion}${periodo}`, admin)).json());
    expect(ocupacion.habitaciones).toHaveLength(17);
    expect(ocupacion.habitaciones.find((h) => h.numero === "205")).toMatchObject({ alquileres: 1, horasVendidas: 10, ingresos: 5600 });
  });

  it("un periodo inválido responde 400, y el Cajero no ve reportes (403)", async () => {
    expect((await e.llamar("GET", `${RUTAS.reporteVentas}?desde=2026-09-25T00:00:00.000Z&hasta=2026-09-23T00:00:00.000Z`, admin)).statusCode).toBe(400);
    expect((await e.llamar("GET", `${RUTAS.reporteVentas}${periodo}`, cajero)).statusCode).toBe(403);
  });
});
