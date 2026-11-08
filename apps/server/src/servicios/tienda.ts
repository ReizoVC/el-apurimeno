import { randomUUID } from "node:crypto";
import {
  LIMITE_MOVIMIENTOS_INVENTARIO,
  MILESIMAS_POR_UNIDAD,
  type AccionAuditoria,
  type CategoriaProducto,
  type CategoriaProductoEntrada,
  type ConteoStockEntrada,
  type MovimientoHistorial,
  type Producto,
  type ProductoEntrada,
  type RegistrarVentaEntrada,
  type ReposicionRespuesta,
  type SalidaStockEntrada,
  type Ticket,
} from "@apurimeno/contracts";
import {
  ErrorNegocio,
  aplicarAjustePuntual,
  aplicarConteoStock,
  aplicarVentaAInventario,
  armarTicketCobro,
  cotizarVenta,
  registrarSalidaStock,
  reponerStock,
  type EfectoInventario,
} from "@apurimeno/domain";
import { cantidadConUnidad } from "@apurimeno/formato";
import { exigir } from "../auth.js";
import { auditar } from "../auditoria.js";
import { ErrorApi, esViolacionUnica } from "../errores.js";
import { INCLUIR_TICKET, aCategoria, aMovimientoInventario, aProducto, aTicket, datosTicket } from "../mapeo.js";
import { encolarComprobante } from "../impresion/cola.js";
import { construirPagos, siguienteNumeroTicket, unaSolaVez } from "./cobros.js";
import { contextoDominio, noEncontrado, parametrosVigentes, type ContextoServicio } from "./contexto.js";
import { turnoAbiertoDe } from "./turnos.js";

/**
 * Venta de tienda (CU-11). `esHuesped` llega explícito desde el cajero (RN-22); el servidor no lo infiere de los alquileres,
 * porque la tienda no conoce el hospedaje (RES-02). La habitación de referencia es opcional (RN-24).
 */
export async function registrarVentaServicio(ctx: ContextoServicio, entrada: RegistrarVentaEntrada, clave: string) {
  return unaSolaVez(
    ctx.prisma,
    clave,
    { tipo: "COBRO", origen: "VENTA_TIENDA" },
    async (ticketId) => aTicket(await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: INCLUIR_TICKET })),
    () =>
      ctx.prisma.$transaction(async (tx): Promise<Ticket> => {
        const dominio = contextoDominio(ctx.ahora);
        const turno = await turnoAbiertoDe(tx, ctx.usuario.id);
        if (
          entrada.habitacionReferenciaId !== null &&
          (await tx.habitacion.findUnique({ where: { id: entrada.habitacionReferenciaId } })) === null
        ) {
          throw noEncontrado("La habitación");
        }

        const ids = [...new Set(entrada.items.map((i) => i.productoId))];
        const productos = new Map(
          (await tx.producto.findMany({ where: { id: { in: ids }, activo: true } })).map((p) => [p.id, aProducto(p)]),
        );
        const items = entrada.items.map((item) => {
          const producto = productos.get(item.productoId);
          if (producto === undefined) throw noEncontrado(`El producto ${item.productoId}`);
          return { producto, cantidad: item.cantidadMilesimas };
        });

        let cotizacion = cotizarVenta(items, entrada.esHuesped);
        if (entrada.ajuste !== null) {
          exigir(ctx.usuario, "AJUSTAR_PRECIO_TIENDA");
          cotizacion = aplicarAjustePuntual(cotizacion, entrada.ajuste.montoAjustado, entrada.ajuste.motivo);
        }
        const { permitirStockNegativo } = await parametrosVigentes(tx);
        const inventario = aplicarVentaAInventario(items, permitirStockNegativo, entrada.confirmarSinStock);
        const ticket = armarTicketCobro(
          {
            numero: await siguienteNumeroTicket(tx),
            origen: "VENTA_TIENDA",
            turno,
            alquilerId: null,
            habitacionReferenciaId: entrada.habitacionReferenciaId,
            cotizacion,
            pagos: await construirPagos(tx, entrada.pagos),
            creadoPorId: ctx.usuario.id,
          },
          dominio,
        );

        await tx.ticket.create({ data: datosTicket(ticket, clave) });
        await encolarComprobante(tx, ticket.id, false, ctx.ahora, randomUUID());
        for (const producto of inventario.productos) {
          const anterior = productos.get(producto.id);
          const { count } = await tx.producto.updateMany({
            where: { id: producto.id, stock: anterior?.stock },
            data: { stock: producto.stock },
          });
          if (count === 0) throw new ErrorNegocio("INVALID_STATE_TRANSITION", "El stock cambió; vuelva a intentar.");
        }
        for (const movimiento of inventario.movimientos) {
          await tx.movimientoInventario.create({
            data: { id: randomUUID(), ...movimiento, ticketId: ticket.id, creadoPorId: ctx.usuario.id, creadoEn: ctx.ahora },
          });
        }
        if (ticket.ajustePuntual !== null) {
          await auditar(
            tx,
            {
              usuarioId: ctx.usuario.id,
              accion: "AJUSTE_PUNTUAL_APLICADO",
              tipoEntidad: "TICKET",
              entidadId: ticket.id,
              valorNuevo: ticket.ajustePuntual,
              motivo: ticket.ajustePuntual.motivo,
            },
            ctx.ahora,
          );
        }
        await auditar(
          tx,
          {
            usuarioId: ctx.usuario.id,
            accion: "VENTA_REGISTRADA",
            tipoEntidad: "TICKET",
            entidadId: ticket.id,
            valorNuevo: { ticketId: ticket.id, total: ticket.total, esHuesped: entrada.esHuesped },
          },
          ctx.ahora,
        );
        if (inventario.sinStock.length > 0) {
          await auditar(
            tx,
            {
              usuarioId: ctx.usuario.id,
              accion: "VENTA_SIN_STOCK",
              tipoEntidad: "TICKET",
              entidadId: ticket.id,
              valorNuevo: { productos: inventario.sinStock.map((p) => ({ ...p })) },
            },
            ctx.ahora,
          );
        }
        return ticket;
      }),
  );
}

// --- Catálogo (CU-29) e inventario (CU-12) ---

/** Catálogo de venta: productos activos (o todos, para gestionarlos), opcionalmente por código de barras (scanner USB). */
export async function listarProductos(
  ctx: ContextoServicio,
  codigoBarras: string | undefined,
  incluirInactivos = false,
  verCosto = false,
): Promise<Producto[]> {
  const filas = await ctx.prisma.producto.findMany({
    where: { ...(incluirInactivos ? {} : { activo: true }), ...(codigoBarras === undefined ? {} : { codigoBarras }) },
    orderBy: { nombre: "asc" },
  });
  return filas.map((fila) => aProducto(fila, verCosto));
}

export async function listarCategorias(ctx: ContextoServicio): Promise<CategoriaProducto[]> {
  return (await ctx.prisma.categoriaProducto.findMany({ orderBy: { nombre: "asc" } })).map(aCategoria);
}

export async function crearCategoria(ctx: ContextoServicio, entrada: CategoriaProductoEntrada): Promise<CategoriaProducto> {
  try {
    return aCategoria(await ctx.prisma.categoriaProducto.create({ data: { id: randomUUID(), nombre: entrada.nombre } }));
  } catch (error) {
    if (esViolacionUnica(error)) throw new ErrorApi("VALIDACION", "nombre: ya existe una categoría con ese nombre.");
    throw error;
  }
}

/** Renombrar solo cambia la etiqueta: los productos la referencian por id y los tickets no la guardan. */
export async function renombrarCategoria(ctx: ContextoServicio, id: string, entrada: CategoriaProductoEntrada): Promise<CategoriaProducto> {
  try {
    return await ctx.prisma.$transaction(async (tx) => {
      const previa = await tx.categoriaProducto.findUnique({ where: { id } });
      if (previa === null) throw noEncontrado("La categoría");
      const categoria = aCategoria(await tx.categoriaProducto.update({ where: { id }, data: { nombre: entrada.nombre } }));
      await auditar(
        tx,
        {
          usuarioId: ctx.usuario.id,
          accion: "CATEGORIA_RENOMBRADA",
          tipoEntidad: "CATEGORIA_PRODUCTO",
          entidadId: id,
          valorPrevio: { nombre: previa.nombre },
          valorNuevo: { nombre: categoria.nombre },
        },
        ctx.ahora,
      );
      return categoria;
    });
  } catch (error) {
    if (esViolacionUnica(error)) throw new ErrorApi("VALIDACION", "nombre: ya existe una categoría con ese nombre.");
    throw error;
  }
}

/** Solo se elimina vacía; con `moverA`, sus productos (también los inactivos) pasan antes a esa categoría (decisión 28). */
export async function eliminarCategoria(ctx: ContextoServicio, id: string, moverA: string | undefined): Promise<void> {
  if (moverA === id) throw new ErrorApi("VALIDACION", "moverA: debe ser otra categoría.");
  await ctx.prisma.$transaction(async (tx) => {
    const previa = await tx.categoriaProducto.findUnique({ where: { id } });
    if (previa === null) throw noEncontrado("La categoría");
    let movidos = 0;
    let destino: string | null = null;
    if (moverA === undefined) {
      const productos = await tx.producto.count({ where: { categoriaId: id } });
      if (productos > 0) throw new ErrorApi("VALIDACION", `La categoría tiene ${productos} producto(s): muévalos a otra antes de eliminarla.`);
    } else {
      const fila = await tx.categoriaProducto.findUnique({ where: { id: moverA } });
      if (fila === null) throw noEncontrado("La categoría de destino");
      destino = fila.nombre;
      movidos = (await tx.producto.updateMany({ where: { categoriaId: id }, data: { categoriaId: moverA } })).count;
    }
    await tx.categoriaProducto.delete({ where: { id } });
    await auditar(
      tx,
      {
        usuarioId: ctx.usuario.id,
        accion: "CATEGORIA_ELIMINADA",
        tipoEntidad: "CATEGORIA_PRODUCTO",
        entidadId: id,
        valorPrevio: { nombre: previa.nombre },
        valorNuevo: { productosMovidos: movidos, movidosA: destino },
      },
      ctx.ahora,
    );
  });
}

async function validarProducto(ctx: ContextoServicio, entrada: ProductoEntrada, id: string | null): Promise<void> {
  if ((await ctx.prisma.categoriaProducto.findUnique({ where: { id: entrada.categoriaId } })) === null) {
    throw noEncontrado("La categoría");
  }
  if (entrada.codigoBarras !== null) {
    const otro = await ctx.prisma.producto.findUnique({ where: { codigoBarras: entrada.codigoBarras } });
    if (otro !== null && otro.id !== id) {
      throw new ErrorApi("VALIDACION", "codigoBarras: ya lo usa otro producto (decisión 14 de contracts).");
    }
  }
  if (entrada.sku !== null) {
    const otro = await ctx.prisma.producto.findUnique({ where: { sku: entrada.sku } });
    if (otro !== null && otro.id !== id) {
      throw new ErrorApi("VALIDACION", `sku: ya lo usa ${otro.nombre} (decisión 31 de contracts).`);
    }
  }
  const unidadEntera = entrada.unidad === "UNIDAD";
  for (const [campo, valor] of [["stockMinimo", entrada.stockMinimo], ["stockOptimo", entrada.stockOptimo]] as const) {
    if (unidadEntera && valor !== null && valor % MILESIMAS_POR_UNIDAD !== 0) {
      throw new ErrorApi("VALIDACION", `${campo}: un producto por unidad lleva mínimos enteros.`);
    }
  }
}

/** Alta de producto (RF-53). Empieza sin stock: el stock solo entra por reposición (RN-25). */
export async function crearProducto(ctx: ContextoServicio, entrada: ProductoEntrada): Promise<Producto> {
  await validarProducto(ctx, entrada, null);
  return ctx.prisma.$transaction(async (tx) => {
    const producto = aProducto(await tx.producto.create({ data: { id: randomUUID(), ...entrada, stock: 0 } }));
    await auditar(
      tx,
      { usuarioId: ctx.usuario.id, accion: "PRODUCTO_CREADO", tipoEntidad: "PRODUCTO", entidadId: producto.id, valorNuevo: producto },
      ctx.ahora,
    );
    return producto;
  });
}

/**
 * Edición de producto (RF-53): datos y precios, nunca el stock. El cambio de precio queda auditado (RN-42). La unidad
 * solo cambia mientras el producto no tenga movimientos ni ventas: si no, el kardex y los tickets anteriores pasarían
 * a leerse en otra unidad (decisión 31).
 */
export async function editarProducto(ctx: ContextoServicio, id: string, entrada: ProductoEntrada): Promise<Producto> {
  await validarProducto(ctx, entrada, id);
  return ctx.prisma.$transaction(async (tx) => {
    const previa = await tx.producto.findUnique({ where: { id } });
    if (previa === null) throw noEncontrado("El producto");
    if (previa.unidad !== entrada.unidad) {
      const usado = (await tx.movimientoInventario.count({ where: { productoId: id } })) + (await tx.lineaTicket.count({ where: { productoId: id } }));
      if (usado > 0) {
        throw new ErrorApi("VALIDACION", "unidad: el producto ya tiene movimientos o ventas; para venderlo en otra unidad, cree un producto nuevo.");
      }
    }
    const producto = aProducto(await tx.producto.update({ where: { id }, data: entrada }));
    await auditar(
      tx,
      {
        usuarioId: ctx.usuario.id,
        accion: "PRODUCTO_EDITADO",
        tipoEntidad: "PRODUCTO",
        entidadId: id,
        valorPrevio: aProducto(previa),
        valorNuevo: producto,
      },
      ctx.ahora,
    );
    return producto;
  });
}

/** Aplica un movimiento manual de stock: el cambio, su línea de kardex y su auditoría, en una transacción. */
async function moverStock(
  ctx: ContextoServicio,
  id: string,
  stockVisto: number | null,
  accion: AccionAuditoria,
  calcular: (producto: Producto) => EfectoInventario,
): Promise<ReposicionRespuesta> {
  return ctx.prisma.$transaction(async (tx) => {
    const fila = await tx.producto.findUnique({ where: { id } });
    if (fila === null) throw noEncontrado("El producto");
    if (stockVisto !== null && stockVisto !== fila.stock) {
      throw new ErrorNegocio(
        "INVALID_STATE_TRANSITION",
        `El stock de ${fila.nombre} cambió de ${cantidadConUnidad(stockVisto, fila.unidad)} a ${cantidadConUnidad(fila.stock, fila.unidad)} mientras tanto. Revíselo y vuelva a intentar.`,
      );
    }
    const efecto = calcular(aProducto(fila));
    const [producto] = efecto.productos;
    const [movimiento] = efecto.movimientos;
    if (producto === undefined || movimiento === undefined) throw new Error("El dominio no devolvió el efecto del movimiento.");

    const { count } = await tx.producto.updateMany({ where: { id, stock: fila.stock }, data: { stock: producto.stock } });
    if (count === 0) throw new ErrorNegocio("INVALID_STATE_TRANSITION", "El stock cambió; vuelva a intentar.");
    const creado = await tx.movimientoInventario.create({
      data: { id: randomUUID(), ...movimiento, ticketId: null, creadoPorId: ctx.usuario.id, creadoEn: ctx.ahora },
    });
    await auditar(
      tx,
      {
        usuarioId: ctx.usuario.id,
        accion,
        tipoEntidad: "PRODUCTO",
        entidadId: id,
        valorPrevio: { stock: fila.stock },
        valorNuevo: {
          stock: producto.stock,
          cantidad: movimiento.cantidad,
          ...(movimiento.motivoSalida == null ? {} : { motivoSalida: movimiento.motivoSalida }),
        },
        // La auditoría exige motivo en una salida: el motivo fijo, con su detalle si lo tiene.
        motivo: [movimiento.motivoSalida, movimiento.motivo].filter((t) => t != null && t !== "").join(": ") || null,
      },
      ctx.ahora,
    );
    return { producto, movimiento: aMovimientoInventario(creado) };
  });
}

/** Ingreso de mercadería (CU-12, RN-25, RF-35). */
export function reponerProducto(ctx: ContextoServicio, id: string, cantidad: number): Promise<ReposicionRespuesta> {
  return moverStock(ctx, id, null, "MERCADERIA_INGRESADA", (p) => reponerStock(p, cantidad));
}

/** Salida de mercadería con su motivo fijo (decisiones 29 y 31). */
export function salidaDeStock(ctx: ContextoServicio, id: string, e: SalidaStockEntrada): Promise<ReposicionRespuesta> {
  return moverStock(ctx, id, e.stockVisto, "STOCK_SALIDA", (p) => registrarSalidaStock(p, e.cantidad, e.motivoSalida, e.motivo));
}

/** Conteo físico: el stock queda en lo contado (decisión 29). */
export function conteoDeStock(ctx: ContextoServicio, id: string, e: ConteoStockEntrada): Promise<ReposicionRespuesta> {
  return moverStock(ctx, id, e.stockVisto, "STOCK_CONTADO", (p) => aplicarConteoStock(p, e.contado, e.nota));
}

/**
 * Historial (kardex): los movimientos más recientes, de un producto o de todos. Para cada producto, el saldo se obtiene
 * desde su stock actual, deshaciendo los movimientos del más nuevo al más viejo.
 */
export async function listarMovimientosInventario(ctx: ContextoServicio, productoId: string | undefined): Promise<MovimientoHistorial[]> {
  const filas = await ctx.prisma.movimientoInventario.findMany({
    where: productoId === undefined ? {} : { productoId },
    orderBy: { creadoEn: "desc" },
    take: LIMITE_MOVIMIENTOS_INVENTARIO,
    include: {
      producto: { select: { nombre: true, stock: true, unidad: true } },
      creadoPor: { select: { nombreUsuario: true } },
      ticket: { select: { numero: true } },
    },
  });
  const saldos = new Map<string, number>();
  return filas.map((fila) => {
    const saldo = saldos.get(fila.productoId) ?? fila.producto.stock;
    saldos.set(fila.productoId, saldo - fila.cantidad);
    return {
      movimiento: aMovimientoInventario(fila),
      productoNombre: fila.producto.nombre,
      unidad: fila.producto.unidad,
      creadoPorNombre: fila.creadoPor.nombreUsuario,
      ticketNumero: fila.ticket?.numero ?? null,
      saldo,
    };
  });
}
