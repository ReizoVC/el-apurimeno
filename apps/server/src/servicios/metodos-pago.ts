import type { MetodoPago, MetodoPagoEntrada } from "@apurimeno/contracts";
import { editarMetodoPago } from "@apurimeno/domain";
import { auditar } from "../auditoria.js";
import { ErrorApi, esViolacionUnica } from "../errores.js";
import { aMetodoPago } from "../mapeo.js";
import { contextoDominio, noEncontrado, type ContextoServicio } from "./contexto.js";

// Métodos de pago (RF-54). No hay acción de auditoría propia en §23.1: se registran como cambio de
// configuración, con `tipoEntidad` METODO_PAGO.

const nombreRepetido = () => new ErrorApi("VALIDACION", "nombre: ya existe un método de pago con ese nombre.");

/** Todos, habilitados o no: el POS ofrece solo los habilitados y el cobro rechaza los demás. */
export async function listarMetodosPago(ctx: ContextoServicio): Promise<MetodoPago[]> {
  return (await ctx.prisma.metodoPago.findMany({ orderBy: { nombre: "asc" } })).map(aMetodoPago);
}

export async function crearMetodoPago(ctx: ContextoServicio, entrada: MetodoPagoEntrada): Promise<MetodoPago> {
  const metodo: MetodoPago = { id: contextoDominio(ctx.ahora).generarId(), ...entrada };
  try {
    return await ctx.prisma.$transaction(async (tx) => {
      await tx.metodoPago.create({ data: metodo });
      await auditar(
        tx,
        { usuarioId: ctx.usuario.id, accion: "CONFIGURACION_CAMBIADA", tipoEntidad: "METODO_PAGO", entidadId: metodo.id, valorNuevo: metodo },
        ctx.ahora,
      );
      return metodo;
    });
  } catch (error) {
    if (esViolacionUnica(error)) throw nombreRepetido();
    throw error;
  }
}

/** Edición y habilitación (RF-54). `afectaCaja` no cambia (decisión 20 de contracts). */
export async function editarMetodoPagoServicio(ctx: ContextoServicio, id: string, entrada: MetodoPagoEntrada): Promise<MetodoPago> {
  try {
    return await ctx.prisma.$transaction(async (tx) => {
      const fila = await tx.metodoPago.findUnique({ where: { id } });
      if (fila === null) throw noEncontrado("El método de pago");
      const previo = aMetodoPago(fila);
      const metodo = editarMetodoPago(previo, entrada);
      await tx.metodoPago.update({ where: { id }, data: entrada });
      await auditar(
        tx,
        { usuarioId: ctx.usuario.id, accion: "CONFIGURACION_CAMBIADA", tipoEntidad: "METODO_PAGO", entidadId: id, valorPrevio: previo, valorNuevo: metodo },
        ctx.ahora,
      );
      return metodo;
    });
  } catch (error) {
    if (esViolacionUnica(error)) throw nombreRepetido();
    throw error;
  }
}
