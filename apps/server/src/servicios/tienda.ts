import { randomUUID } from "node:crypto";
import type {
  CategoriaProducto,
  CategoriaProductoEntrada,
  Producto,
  ProductoEntrada,
  RegistrarVentaEntrada,
  ReposicionRespuesta,
  Ticket,
} from "@apurimeno/contracts";
import {
  ErrorNegocio,
  aplicarAjustePuntual,
  aplicarVentaAInventario,
  armarTicketCobro,
  cotizarVenta,
  reponerStock,
} from "@apurimeno/domain";
import { exigir } from "../auth.js";
import { auditar } from "../auditoria.js";
import { ErrorApi, esViolacionUnica } from "../errores.js";
import { INCLUIR_TICKET, aCategoria, aMovimientoInventario, aProducto, aTicket, datosTicket } from "../mapeo.js";
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
          return { producto, cantidad: item.cantidad };
        });

        let cotizacion = cotizarVenta(items, entrada.esHuesped);
        if (entrada.ajuste !== null) {
          exigir(ctx.usuario, "AJUSTAR_PRECIO_TIENDA");
          cotizacion = aplicarAjustePuntual(cotizacion, entrada.ajuste.montoAjustado, entrada.ajuste.motivo);
        }
        const { permitirStockNegativo } = await parametrosVigentes(tx);
        const inventario = aplicarVentaAInventario(items, permitirStockNegativo);
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
        return ticket;
      }),
  );
}

// --- Catálogo (CU-29) e inventario (CU-12) ---

/** Catálogo de venta: productos activos, opcionalmente por código de barras (scanner USB). */
export async function listarProductos(ctx: ContextoServicio, codigoBarras: string | undefined): Promise<Producto[]> {
  const filas = await ctx.prisma.producto.findMany({
    where: { activo: true, ...(codigoBarras === undefined ? {} : { codigoBarras }) },
    orderBy: { nombre: "asc" },
  });
  return filas.map(aProducto);
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

/** Edición de producto (RF-53): datos y precios, nunca el stock. El cambio de precio queda auditado (RN-42). */
export async function editarProducto(ctx: ContextoServicio, id: string, entrada: ProductoEntrada): Promise<Producto> {
  await validarProducto(ctx, entrada, id);
  return ctx.prisma.$transaction(async (tx) => {
    const previa = await tx.producto.findUnique({ where: { id } });
    if (previa === null) throw noEncontrado("El producto");
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

/** Ingreso de mercadería (CU-12, RN-25, RF-35). */
export async function reponerProducto(ctx: ContextoServicio, id: string, cantidad: number): Promise<ReposicionRespuesta> {
  return ctx.prisma.$transaction(async (tx) => {
    const fila = await tx.producto.findUnique({ where: { id } });
    if (fila === null) throw noEncontrado("El producto");
    const efecto = reponerStock(aProducto(fila), cantidad);
    const [producto] = efecto.productos;
    const [movimiento] = efecto.movimientos;
    if (producto === undefined || movimiento === undefined) throw new Error("reponerStock no devolvió su efecto.");

    const { count } = await tx.producto.updateMany({ where: { id, stock: fila.stock }, data: { stock: producto.stock } });
    if (count === 0) throw new ErrorNegocio("INVALID_STATE_TRANSITION", "El stock cambió; vuelva a intentar.");
    const creado = await tx.movimientoInventario.create({
      data: { id: randomUUID(), ...movimiento, ticketId: null, creadoPorId: ctx.usuario.id, creadoEn: ctx.ahora },
    });
    await auditar(
      tx,
      {
        usuarioId: ctx.usuario.id,
        accion: "MERCADERIA_INGRESADA",
        tipoEntidad: "PRODUCTO",
        entidadId: id,
        valorPrevio: { stock: fila.stock },
        valorNuevo: { stock: producto.stock, cantidad },
      },
      ctx.ahora,
    );
    return { producto, movimiento: aMovimientoInventario(creado) };
  });
}
