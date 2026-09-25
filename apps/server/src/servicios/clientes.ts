import type {
  Cliente,
  ClienteEntrada,
  CrearPrecioEspecialEntrada,
  PrecioEspecialCliente,
} from "@apurimeno/contracts";
import { ErrorNegocio, crearPrecioEspecial, editarPrecioEspecial } from "@apurimeno/domain";
import { auditar } from "../auditoria.js";
import type { Transaccion } from "../db.js";
import { ErrorApi, esViolacionUnica } from "../errores.js";
import { aCliente, aPrecioEspecial } from "../mapeo.js";
import { contextoDominio, noEncontrado, type ContextoServicio } from "./contexto.js";

/** Tope de resultados de una búsqueda: el cajero afina el texto si no ve al cliente. */
const LIMITE_BUSQUEDA = 20;

const documentoRepetido = () =>
  new ErrorApi("VALIDACION", "documento: ya existe un cliente con ese documento (decisión 17 de contracts).");

/**
 * Búsqueda parcial por documento o nombre (RF-34, CU-09). En SQLite, `contains` usa LIKE, que no distingue
 * mayúsculas en texto ASCII. Sin texto, devuelve los primeros clientes por nombre.
 */
export async function buscarClientes(ctx: ContextoServicio, q: string | undefined): Promise<Cliente[]> {
  const filas = await ctx.prisma.cliente.findMany({
    where: q === undefined ? {} : { OR: [{ documento: { contains: q } }, { nombre: { contains: q } }] },
    orderBy: [{ nombre: "asc" }, { documento: "asc" }],
    take: LIMITE_BUSQUEDA,
  });
  return filas.map(aCliente);
}

/**
 * Alta de cliente: el cajero al tomar sus datos en un ingreso (CU-04) o el Administrador antes de fijarle un
 * precio especial (CU-08). No se audita: §23.1 no lo pide y no mueve dinero ni cambia permisos.
 */
export async function crearClienteServicio(ctx: ContextoServicio, entrada: ClienteEntrada): Promise<Cliente> {
  const cliente = { id: contextoDominio(ctx.ahora).generarId(), ...entrada };
  try {
    return aCliente(await ctx.prisma.cliente.create({ data: cliente }));
  } catch (error) {
    if (esViolacionUnica(error)) throw documentoRepetido();
    throw error;
  }
}

/** Corrección de documento o nombre. Los precios especiales siguen asociados al mismo cliente. */
export async function editarClienteServicio(ctx: ContextoServicio, id: string, entrada: ClienteEntrada): Promise<Cliente> {
  if ((await ctx.prisma.cliente.findUnique({ where: { id } })) === null) throw noEncontrado("El cliente");
  try {
    return aCliente(await ctx.prisma.cliente.update({ where: { id }, data: entrada }));
  } catch (error) {
    if (esViolacionUnica(error)) throw documentoRepetido();
    throw error;
  }
}

// --- Precios especiales (CU-08; RF-16 a RF-18; RN-14 a RN-16) ---

async function exigirCliente(tx: Transaccion, clienteId: string): Promise<void> {
  if ((await tx.cliente.findUnique({ where: { id: clienteId } })) === null) throw noEncontrado("El cliente");
}

async function precioDe(tx: Transaccion, clienteId: string, habitacionId: string): Promise<PrecioEspecialCliente | null> {
  const fila = await tx.precioEspecialCliente.findUnique({ where: { clienteId_habitacionId: { clienteId, habitacionId } } });
  return fila === null ? null : aPrecioEspecial(fila);
}

export async function listarPreciosEspeciales(ctx: ContextoServicio, clienteId: string): Promise<PrecioEspecialCliente[]> {
  await exigirCliente(ctx.prisma, clienteId);
  const filas = await ctx.prisma.precioEspecialCliente.findMany({
    where: { clienteId },
    orderBy: { habitacion: { numero: "asc" } },
  });
  return filas.map(aPrecioEspecial);
}

/** Alta (RF-16). Si la combinación ya existe, CLIENT_ROOM_PRICE_ALREADY_EXISTS: se edita la existente. */
export async function crearPrecioEspecialServicio(
  ctx: ContextoServicio,
  clienteId: string,
  entrada: CrearPrecioEspecialEntrada,
): Promise<PrecioEspecialCliente> {
  try {
    return await ctx.prisma.$transaction(async (tx) => {
      await exigirCliente(tx, clienteId);
      if ((await tx.habitacion.findUnique({ where: { id: entrada.habitacionId } })) === null) throw noEncontrado("La habitación");
      const precio = crearPrecioEspecial(
        await precioDe(tx, clienteId, entrada.habitacionId),
        { clienteId, habitacionId: entrada.habitacionId, precio: entrada.precio, creadoPorId: ctx.usuario.id },
        contextoDominio(ctx.ahora),
      );
      await tx.precioEspecialCliente.create({ data: { ...precio, creadoEn: ctx.ahora } });
      await auditar(
        tx,
        { usuarioId: ctx.usuario.id, accion: "PRECIO_ESPECIAL_CREADO", tipoEntidad: "PRECIO_ESPECIAL_CLIENTE", entidadId: precio.id, valorNuevo: precio },
        ctx.ahora,
      );
      return precio;
    });
  } catch (error) {
    // Dos altas simultáneas de la misma combinación: el índice único rechaza la segunda.
    if (esViolacionUnica(error)) throw new ErrorNegocio("CLIENT_ROOM_PRICE_ALREADY_EXISTS");
    throw error;
  }
}

/** Edición del monto (RF-18). Rige para los ingresos siguientes; los abiertos conservan su precio (RN-44). */
export async function editarPrecioEspecialServicio(
  ctx: ContextoServicio,
  clienteId: string,
  habitacionId: string,
  precio: number,
): Promise<PrecioEspecialCliente> {
  return ctx.prisma.$transaction(async (tx) => {
    const previo = await precioDe(tx, clienteId, habitacionId);
    if (previo === null) throw noEncontrado("El precio especial");
    const editado = editarPrecioEspecial(previo, precio);
    await tx.precioEspecialCliente.update({ where: { id: previo.id }, data: { precio: editado.precio } });
    await auditar(
      tx,
      {
        usuarioId: ctx.usuario.id,
        accion: "PRECIO_ESPECIAL_EDITADO",
        tipoEntidad: "PRECIO_ESPECIAL_CLIENTE",
        entidadId: previo.id,
        valorPrevio: previo,
        valorNuevo: editado,
      },
      ctx.ahora,
    );
    return editado;
  });
}

/** Eliminación (RF-18, CU-08 E1): desde ahora esa combinación vuelve al precio de lista. */
export async function eliminarPrecioEspecialServicio(ctx: ContextoServicio, clienteId: string, habitacionId: string): Promise<void> {
  await ctx.prisma.$transaction(async (tx) => {
    const previo = await precioDe(tx, clienteId, habitacionId);
    if (previo === null) throw noEncontrado("El precio especial");
    await tx.precioEspecialCliente.delete({ where: { id: previo.id } });
    await auditar(
      tx,
      { usuarioId: ctx.usuario.id, accion: "PRECIO_ESPECIAL_ELIMINADO", tipoEntidad: "PRECIO_ESPECIAL_CLIENTE", entidadId: previo.id, valorPrevio: previo },
      ctx.ahora,
    );
  });
}
