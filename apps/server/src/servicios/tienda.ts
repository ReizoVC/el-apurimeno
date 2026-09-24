import { randomUUID } from "node:crypto";
import type { RegistrarVentaEntrada, Ticket } from "@apurimeno/contracts";
import {
  ErrorNegocio,
  aplicarAjustePuntual,
  aplicarVentaAInventario,
  armarTicketCobro,
  cotizarVenta,
} from "@apurimeno/domain";
import { exigir } from "../auth.js";
import { auditar } from "../auditoria.js";
import { INCLUIR_TICKET, aProducto, aTicket, datosTicket } from "../mapeo.js";
import { construirPagos, siguienteNumeroTicket, unaSolaVez } from "./cobros.js";
import { contextoDominio, noEncontrado, parametrosVigentes, type ContextoServicio } from "./contexto.js";
import { turnoAbiertoDe } from "./turnos.js";

/**
 * Venta de tienda (CU-11). Todavía sin ruta HTTP: se expondrá junto con el resto de la tienda.
 * `esHuesped` llega explícito desde el cajero (RN-22); el servidor no lo infiere de los alquileres,
 * porque la tienda no conoce el hospedaje (RES-02). La habitación de referencia es opcional (RN-24).
 */
export async function registrarVentaServicio(ctx: ContextoServicio, entrada: RegistrarVentaEntrada, clave: string) {
  return unaSolaVez(
    ctx.prisma,
    clave,
    "VENTA_TIENDA",
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
