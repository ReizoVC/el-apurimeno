import type { CrearUsuarioEntrada, EditarUsuarioEntrada, Rango, RangoEntrada, Usuario } from "@apurimeno/contracts";
import { validarEdicionPropia } from "@apurimeno/domain";
import { hashContrasena } from "../auth.js";
import { auditar } from "../auditoria.js";
import type { Transaccion } from "../db.js";
import { ErrorApi, esViolacionUnica } from "../errores.js";
import { INCLUIR_USUARIO, aRango, aRangos, aUsuario } from "../mapeo.js";
import { contextoDominio, noEncontrado, type ContextoServicio } from "./contexto.js";

// Gestión de cuentas (CU-23; RN-40, RF-45). La contraseña solo entra como texto para calcular su hash:
// nunca se guarda en claro, nunca vuelve en una respuesta y nunca aparece en la auditoría.

const nombreRepetido = () => new ErrorApi("VALIDACION", "nombreUsuario: ya existe un usuario con ese nombre.");

export async function listarUsuarios(ctx: ContextoServicio): Promise<Usuario[]> {
  const filas = await ctx.prisma.usuario.findMany({ include: INCLUIR_USUARIO, orderBy: { nombreUsuario: "asc" } });
  return filas.map(aUsuario);
}

/** Rangos disponibles para asignar (CU-23) y administrar (CU-24). */
export async function listarRangos(ctx: ContextoServicio): Promise<Rango[]> {
  const filas = await ctx.prisma.rango.findMany({ include: { permisos: true }, orderBy: { nombre: "asc" } });
  return filas.map(aRango);
}

/** Los rangos pedidos, con sus permisos; 404 si alguno no existe. */
async function exigirRangos(tx: Transaccion, rangoIds: readonly string[]): Promise<Rango[]> {
  const rangos = (await tx.rango.findMany({ where: { id: { in: [...rangoIds] } }, include: { permisos: true } })).map(aRango);
  const faltante = rangoIds.find((id) => !rangos.some((r) => r.id === id));
  if (faltante !== undefined) throw noEncontrado(`El rango ${faltante}`);
  return rangos;
}

/** Alta de una cuenta individual (RN-40), activa y con al menos un rango. */
export async function crearUsuarioServicio(ctx: ContextoServicio, entrada: CrearUsuarioEntrada, costoBcrypt: number): Promise<Usuario> {
  const contrasenaHash = await hashContrasena(entrada.contrasena, costoBcrypt);
  const id = contextoDominio(ctx.ahora).generarId();
  try {
    return await ctx.prisma.$transaction(async (tx) => {
      await exigirRangos(tx, entrada.rangoIds);
      const fila = await tx.usuario.create({
        data: {
          id,
          nombreUsuario: entrada.nombreUsuario,
          activo: true,
          contrasenaHash,
          rangos: { create: entrada.rangoIds.map((rangoId) => ({ rangoId })) },
        },
        include: INCLUIR_USUARIO,
      });
      const usuario = aUsuario(fila);
      await auditar(
        tx,
        { usuarioId: ctx.usuario.id, accion: "USUARIO_CREADO", tipoEntidad: "USUARIO", entidadId: id, valorNuevo: usuario },
        ctx.ahora,
      );
      return usuario;
    });
  } catch (error) {
    if (esViolacionUnica(error)) throw nombreRepetido();
    throw error;
  }
}

/**
 * Edición, desactivación y asignación de rangos (RF-45). Nada se elimina: un usuario desactivado no inicia
 * sesión ni opera, y su historial queda intacto. Los permisos se leen en cada solicitud, así que el cambio
 * rige en la siguiente operación del usuario (RF-63). Cada tipo de cambio deja su propio registro.
 */
export async function editarUsuarioServicio(ctx: ContextoServicio, id: string, entrada: EditarUsuarioEntrada): Promise<Usuario> {
  try {
    return await ctx.prisma.$transaction(async (tx) => {
      const fila = await tx.usuario.findUnique({ where: { id }, include: INCLUIR_USUARIO });
      if (fila === null) throw noEncontrado("El usuario");
      const rangos = await exigirRangos(tx, entrada.rangoIds);
      const previo = aUsuario(fila);
      // Nadie se desactiva ni se quita users.manage a sí mismo (decisión 19 de contracts).
      validarEdicionPropia(ctx.usuario.id, { id, ...entrada }, rangos);

      await tx.usuarioRango.deleteMany({ where: { usuarioId: id } });
      const actualizada = await tx.usuario.update({
        where: { id },
        data: {
          nombreUsuario: entrada.nombreUsuario,
          activo: entrada.activo,
          rangos: { create: entrada.rangoIds.map((rangoId) => ({ rangoId })) },
        },
        include: INCLUIR_USUARIO,
      });
      const usuario = aUsuario(actualizada);

      const evento = { usuarioId: ctx.usuario.id, tipoEntidad: "USUARIO", entidadId: id } as const;
      if (previo.nombreUsuario !== usuario.nombreUsuario || (!previo.activo && usuario.activo)) {
        await auditar(
          tx,
          {
            ...evento,
            accion: "USUARIO_EDITADO",
            valorPrevio: { nombreUsuario: previo.nombreUsuario, activo: previo.activo },
            valorNuevo: { nombreUsuario: usuario.nombreUsuario, activo: usuario.activo },
          },
          ctx.ahora,
        );
      }
      if (previo.activo && !usuario.activo) {
        await auditar(tx, { ...evento, accion: "USUARIO_DESACTIVADO", valorPrevio: { activo: true }, valorNuevo: { activo: false } }, ctx.ahora);
      }
      const mismosRangos =
        previo.rangoIds.length === usuario.rangoIds.length && previo.rangoIds.every((r) => usuario.rangoIds.includes(r));
      if (!mismosRangos) {
        await auditar(
          tx,
          { ...evento, accion: "USUARIO_RANGOS_ASIGNADOS", valorPrevio: { rangoIds: previo.rangoIds }, valorNuevo: { rangoIds: usuario.rangoIds } },
          ctx.ahora,
        );
      }
      return usuario;
    });
  } catch (error) {
    if (esViolacionUnica(error)) throw nombreRepetido();
    throw error;
  }
}

/** Nueva contraseña fijada por el Administrador. Se audita el hecho, nunca el valor. */
export async function cambiarContrasenaServicio(ctx: ContextoServicio, id: string, contrasena: string, costoBcrypt: number): Promise<void> {
  const contrasenaHash = await hashContrasena(contrasena, costoBcrypt);
  await ctx.prisma.$transaction(async (tx) => {
    if ((await tx.usuario.findUnique({ where: { id } })) === null) throw noEncontrado("El usuario");
    await tx.usuario.update({ where: { id }, data: { contrasenaHash } });
    await auditar(
      tx,
      { usuarioId: ctx.usuario.id, accion: "USUARIO_EDITADO", tipoEntidad: "USUARIO", entidadId: id, valorNuevo: { contrasena: "cambiada" } },
      ctx.ahora,
    );
  });
}

// --- Rangos (CU-24; RN-41, RF-62) ---

const nombreRangoRepetido = () => new ErrorApi("VALIDACION", "nombre: ya existe un rango con ese nombre.");

/** Alta de un rango como combinación del catálogo fijo de permisos (RF-62). */
export async function crearRangoServicio(ctx: ContextoServicio, entrada: RangoEntrada): Promise<Rango> {
  const rango: Rango = { id: contextoDominio(ctx.ahora).generarId(), ...entrada };
  try {
    return await ctx.prisma.$transaction(async (tx) => {
      await tx.rango.create({
        data: { id: rango.id, nombre: rango.nombre, permisos: { create: rango.permisos.map((permiso) => ({ permiso })) } },
      });
      await auditar(
        tx,
        { usuarioId: ctx.usuario.id, accion: "RANGO_CREADO", tipoEntidad: "RANGO", entidadId: rango.id, valorNuevo: rango },
        ctx.ahora,
      );
      return rango;
    });
  } catch (error) {
    if (esViolacionUnica(error)) throw nombreRangoRepetido();
    throw error;
  }
}

/**
 * Edición de nombre y permisos (CU-24 A1). Rige de inmediato para todos los usuarios que tienen el rango,
 * porque los permisos se leen en cada solicitud (RF-63). Quien edita no puede quitarse a sí mismo
 * `users.manage` por esta vía (decisión 19 de contracts).
 */
export async function editarRangoServicio(ctx: ContextoServicio, id: string, entrada: RangoEntrada): Promise<Rango> {
  try {
    return await ctx.prisma.$transaction(async (tx) => {
      const fila = await tx.rango.findUnique({ where: { id }, include: { permisos: true } });
      if (fila === null) throw noEncontrado("El rango");
      const previo = aRango(fila);
      const rango: Rango = { id, ...entrada };

      const solicitante = await tx.usuario.findUniqueOrThrow({ where: { id: ctx.usuario.id }, include: INCLUIR_USUARIO });
      const rangosResultantes = aRangos(solicitante).map((r) => (r.id === id ? rango : r));
      validarEdicionPropia(ctx.usuario.id, aUsuario(solicitante), rangosResultantes);

      await tx.rangoPermiso.deleteMany({ where: { rangoId: id } });
      await tx.rango.update({
        where: { id },
        data: { nombre: rango.nombre, permisos: { create: rango.permisos.map((permiso) => ({ permiso })) } },
      });
      await auditar(
        tx,
        { usuarioId: ctx.usuario.id, accion: "RANGO_EDITADO", tipoEntidad: "RANGO", entidadId: id, valorPrevio: previo, valorNuevo: rango },
        ctx.ahora,
      );
      return rango;
    });
  } catch (error) {
    if (esViolacionUnica(error)) throw nombreRangoRepetido();
    throw error;
  }
}
