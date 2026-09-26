import { randomUUID } from "node:crypto";
import {
  TurnoSchema,
  type AbrirTurnoEntrada,
  type CerrarTurnoEntrada,
  type ForzarCierreTurnoEntrada,
  type MovimientoCaja,
  type MovimientoCajaEntrada,
  type Turno,
} from "@apurimeno/contracts";
import {
  ErrorNegocio,
  calcularEfectivoEsperado,
  cerrarTurno,
  cierreExigeCodigo,
  forzarCierreTurno,
  prepararMovimientoCaja,
  validarCodigoAutorizacion,
} from "@apurimeno/domain";
import { auditar } from "../auditoria.js";
import type { Transaccion } from "../db.js";
import { ErrorApi, esViolacionUnica } from "../errores.js";
import { INCLUIR_TICKET, aMetodoPago, aMovimientoCaja, aTicket, aTurno, datosTurno } from "../mapeo.js";
import { MAX_INTENTOS_FALLIDOS, buscarCodigo, intentosFallidosRecientes, type SecretoCodigos } from "./codigos.js";
import { noEncontrado, type ContextoServicio } from "./contexto.js";

/** Turno abierto del usuario, o SHIFT_NOT_OPEN: ningún cobro sin turno (RN-32). */
export async function turnoAbiertoDe(tx: Transaccion, usuarioId: string): Promise<Turno> {
  const fila = await tx.turno.findFirst({ where: { usuarioId, estado: "ABIERTO" } });
  if (fila === null) throw new ErrorNegocio("SHIFT_NOT_OPEN");
  return aTurno(fila);
}

/** Turno abierto de quien consulta, o null (el POS lo pide al iniciar). */
export async function turnoActualServicio(ctx: ContextoServicio): Promise<Turno | null> {
  const fila = await ctx.prisma.turno.findFirst({ where: { usuarioId: ctx.usuario.id, estado: "ABIERTO" } });
  return fila === null ? null : aTurno(fila);
}

/** Abre el turno del cajero (CU-02, RF-32). Un solo turno abierto por usuario: índice único parcial. */
export async function abrirTurno(ctx: ContextoServicio, entrada: AbrirTurnoEntrada): Promise<Turno> {
  const turno = TurnoSchema.parse({
    id: randomUUID(),
    usuarioId: ctx.usuario.id,
    estado: "ABIERTO",
    abiertoEn: ctx.ahora.toISOString(),
    efectivoInicial: entrada.efectivoInicial,
    cerradoEn: null,
    cerradoPorId: null,
    cierreForzado: false,
    efectivoContado: null,
    efectivoEsperado: null,
    diferencia: null,
    comentarioCierre: null,
  });
  try {
    await ctx.prisma.$transaction(async (tx) => {
      await tx.turno.create({ data: datosTurno(turno) });
      await auditar(
        tx,
        { usuarioId: ctx.usuario.id, accion: "TURNO_ABIERTO", tipoEntidad: "TURNO", entidadId: turno.id, valorNuevo: turno },
        ctx.ahora,
      );
    });
  } catch (error) {
    if (esViolacionUnica(error)) {
      throw new ErrorNegocio("INVALID_STATE_TRANSITION", "Ya tiene un turno abierto.");
    }
    throw error;
  }
  return turno;
}

/** Efectivo esperado del turno (RN-33, RN-35): inicial + cobros en métodos que afectan caja ± movimientos. */
async function efectivoEsperadoDe(tx: Transaccion, turno: Turno): Promise<number> {
  const tickets = await tx.ticket.findMany({ where: { turnoId: turno.id }, include: INCLUIR_TICKET });
  const movimientos = await tx.movimientoCaja.findMany({ where: { turnoId: turno.id } });
  const metodos = await tx.metodoPago.findMany();
  return calcularEfectivoEsperado(turno, tickets.map(aTicket), movimientos.map(aMovimientoCaja), metodos.map(aMetodoPago));
}

/** Cuántos intentos de cierre de este turno se rechazaron por diferencia sin comentario (decisión 25). */
async function cierresRechazados(tx: Transaccion, turnoId: string): Promise<number> {
  return tx.registroAuditoria.count({ where: { accion: "CIERRE_TURNO_RECHAZADO", entidadId: turnoId } });
}

type ResultadoCierre =
  | { tipo: "cerrado"; turno: Turno }
  | { tipo: "rechazado"; error: ErrorNegocio; rechazos: number }
  | { tipo: "sin-autorizacion"; mensaje: string };

/**
 * Cierra el turno propio con arqueo ciego (CU-19; RN-33 a RN-35, PEND-05). El cajero envía lo contado;
 * el esperado se calcula aquí y solo se revela en la respuesta, ya cerrado.
 *
 * Cada intento queda en la auditoría con el monto contado (decisión 25): el aceptado como `TURNO_CERRADO`, el
 * rechazado por diferencia sin comentario como `CIERRE_TURNO_RECHAZADO` y el que llega sin un código válido cuando
 * hace falta como `ACCESO_DENEGADO`. Tras `MAX_CIERRES_RECHAZADOS_SIN_CODIGO` rechazos, cada intento consume un
 * código `REINTENTAR_CIERRE_TURNO` de un Administrador, así el "no coincide" no sirve para adivinar el esperado.
 * Rechazos y denegaciones se confirman en la transacción y el error se lanza después: el registro no se pierde y
 * un código consumido en un intento rechazado no vuelve a quedar disponible.
 */
export async function cerrarTurnoPropio(ctx: ContextoServicio, entrada: CerrarTurnoEntrada, secreto: SecretoCodigos): Promise<Turno> {
  const resultado = await ctx.prisma.$transaction(async (tx): Promise<ResultadoCierre> => {
    const turno = await turnoAbiertoDe(tx, ctx.usuario.id);
    const rechazosPrevios = await cierresRechazados(tx, turno.id);
    const ahora = ctx.ahora.toISOString();

    let codigoAutorizacionId: string | null = null;
    if (cierreExigeCodigo(rechazosPrevios)) {
      const denegar = async (mensaje: string): Promise<ResultadoCierre> => {
        await auditar(
          tx,
          {
            usuarioId: ctx.usuario.id,
            accion: "ACCESO_DENEGADO",
            tipoEntidad: "CODIGO_AUTORIZACION",
            entidadId: null,
            valorNuevo: { operacion: "REINTENTAR_CIERRE_TURNO", turnoId: turno.id, efectivoContado: entrada.efectivoContado },
          },
          ctx.ahora,
        );
        return { tipo: "sin-autorizacion", mensaje };
      };
      if ((await intentosFallidosRecientes(tx, ctx.usuario.id, ctx.ahora)) >= MAX_INTENTOS_FALLIDOS) {
        return denegar("Demasiados códigos incorrectos: espere 15 minutos.");
      }
      const sinCodigo = `Hubo ${rechazosPrevios} intentos de cierre con diferencia: para volver a intentar hace falta un código de autorización de un Administrador.`;
      const encontrado = await buscarCodigo(tx, secreto, entrada.codigoAutorizacion ?? null);
      if (encontrado === null) return denegar(sinCodigo);
      try {
        validarCodigoAutorizacion(encontrado.codigo, encontrado.valorIngresado, "REINTENTAR_CIERRE_TURNO", ahora);
      } catch (error) {
        if (error instanceof ErrorNegocio) return denegar(sinCodigo);
        throw error;
      }
      const consumido = await tx.codigoAutorizacion.updateMany({
        where: { id: encontrado.codigo.id, usadoEn: null },
        data: { usadoEn: ctx.ahora, usadoPorId: ctx.usuario.id, turnoId: turno.id },
      });
      if (consumido.count === 0) return denegar(sinCodigo);
      codigoAutorizacionId = encontrado.codigo.id;
    }

    const efectivoEsperado = await efectivoEsperadoDe(tx, turno);
    let cerrado: Turno;
    try {
      cerrado = cerrarTurno(turno, { efectivoContado: entrada.efectivoContado, efectivoEsperado, comentario: entrada.comentario, ahora });
    } catch (error) {
      if (error instanceof ErrorNegocio && error.codigo === "REASON_REQUIRED") {
        await auditar(
          tx,
          {
            usuarioId: ctx.usuario.id,
            accion: "CIERRE_TURNO_RECHAZADO",
            tipoEntidad: "TURNO",
            entidadId: turno.id,
            valorNuevo: { efectivoContado: entrada.efectivoContado, intento: rechazosPrevios + 1, codigoAutorizacionId },
          },
          ctx.ahora,
        );
        return { tipo: "rechazado", error, rechazos: rechazosPrevios + 1 };
      }
      throw error;
    }

    const { count } = await tx.turno.updateMany({
      where: { id: turno.id, estado: "ABIERTO" },
      data: datosTurno(cerrado),
    });
    if (count === 0) throw new ErrorNegocio("SHIFT_NOT_OPEN");
    await auditar(
      tx,
      {
        usuarioId: ctx.usuario.id,
        accion: "TURNO_CERRADO",
        tipoEntidad: "TURNO",
        entidadId: turno.id,
        valorPrevio: turno,
        valorNuevo: { ...cerrado, cierresRechazados: rechazosPrevios, codigoAutorizacionId },
        motivo: cerrado.comentarioCierre,
      },
      ctx.ahora,
    );
    return { tipo: "cerrado", turno: cerrado };
  });

  if (resultado.tipo === "sin-autorizacion") throw new ErrorNegocio("AUTH_CODE_INVALID", resultado.mensaje);
  if (resultado.tipo === "rechazado") {
    // Solo "no coincide": nunca por cuánto ni en qué sentido (RN-34).
    const aviso = cierreExigeCodigo(resultado.rechazos)
      ? " Desde ahora, cada intento necesita un código de autorización de un Administrador."
      : "";
    throw new ErrorNegocio("REASON_REQUIRED", `${resultado.error.message}${aviso}`);
  }
  return resultado.turno;
}

/** Turnos abiertos de todo el personal, para detectar uno abandonado (CU-20). El esperado sigue oculto (RN-34). */
export async function listarTurnosAbiertos(ctx: ContextoServicio): Promise<Turno[]> {
  return (await ctx.prisma.turno.findMany({ where: { estado: "ABIERTO" }, orderBy: { abiertoEn: "asc" } })).map(aTurno);
}

/**
 * Cierre forzado de un turno ajeno (CU-20, RF-43), p. ej. un cajero que se fue sin cerrar. Queda marcado como
 * forzado y auditado aparte. Desde ese momento, el cajero no puede cobrar hasta abrir otro turno (RN-32).
 */
export async function forzarCierreTurnoServicio(ctx: ContextoServicio, turnoId: string, entrada: ForzarCierreTurnoEntrada): Promise<Turno> {
  return ctx.prisma.$transaction(async (tx) => {
    const fila = await tx.turno.findUnique({ where: { id: turnoId } });
    if (fila === null) throw noEncontrado("El turno");
    const turno = aTurno(fila);
    if (turno.estado !== "ABIERTO") throw new ErrorNegocio("SHIFT_NOT_OPEN");
    // El propio turno se cierra por la vía normal, con arqueo ciego (dominio: INVALID_STATE_TRANSITION).
    const cerrado = forzarCierreTurno(turno, {
      cerradoPorId: ctx.usuario.id,
      efectivoContado: entrada.efectivoContado,
      efectivoEsperado: await efectivoEsperadoDe(tx, turno),
      comentario: entrada.comentario,
      ahora: ctx.ahora.toISOString(),
    });

    const { count } = await tx.turno.updateMany({ where: { id: turno.id, estado: "ABIERTO" }, data: datosTurno(cerrado) });
    if (count === 0) throw new ErrorNegocio("SHIFT_NOT_OPEN");
    await auditar(
      tx,
      {
        usuarioId: ctx.usuario.id,
        accion: "TURNO_CIERRE_FORZADO",
        tipoEntidad: "TURNO",
        entidadId: turno.id,
        valorPrevio: turno,
        valorNuevo: cerrado,
        motivo: cerrado.comentarioCierre,
      },
      ctx.ahora,
    );
    return cerrado;
  });
}

/**
 * Ingreso o retiro manual de efectivo en el turno propio (CU-18, RF-42): motivo obligatorio, monto positivo y
 * turno abierto (RN-32). Entra en el efectivo esperado del arqueo (RN-33). Es idempotente por clave, como un
 * cobro: si la clave ya registró un movimiento de este usuario, se devuelve ese mismo sin crear otro.
 */
export async function registrarMovimientoCajaServicio(
  ctx: ContextoServicio,
  entrada: MovimientoCajaEntrada,
  clave: string,
): Promise<{ resultado: MovimientoCaja; repetido: boolean }> {
  const buscar = async () => {
    const previo = await ctx.prisma.movimientoCaja.findUnique({ where: { claveIdempotencia: clave } });
    if (previo !== null && previo.creadoPorId !== ctx.usuario.id) {
      throw new ErrorApi("CLAVE_IDEMPOTENCIA_REUTILIZADA", "La clave de idempotencia ya se usó en otra operación.");
    }
    return previo;
  };
  const previo = await buscar();
  if (previo !== null) return { resultado: aMovimientoCaja(previo), repetido: true };

  try {
    const resultado = await ctx.prisma.$transaction(async (tx) => {
      const turno = await turnoAbiertoDe(tx, ctx.usuario.id);
      const borrador = prepararMovimientoCaja(turno, entrada.tipo, entrada.monto, entrada.motivo);
      const movimiento = aMovimientoCaja(
        await tx.movimientoCaja.create({
          data: { id: randomUUID(), ...borrador, creadoPorId: ctx.usuario.id, creadoEn: ctx.ahora, claveIdempotencia: clave },
        }),
      );
      await auditar(
        tx,
        {
          usuarioId: ctx.usuario.id,
          accion: "MOVIMIENTO_CAJA_REGISTRADO",
          tipoEntidad: "MOVIMIENTO_CAJA",
          entidadId: movimiento.id,
          valorNuevo: movimiento,
          motivo: movimiento.motivo,
        },
        ctx.ahora,
      );
      return movimiento;
    });
    return { resultado, repetido: false };
  } catch (error) {
    // Dos envíos simultáneos con la misma clave: el índice único rechaza el segundo.
    if (!esViolacionUnica(error)) throw error;
    const ganador = await buscar();
    if (ganador === null) throw error;
    return { resultado: aMovimientoCaja(ganador), repetido: true };
  }
}
