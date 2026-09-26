import { createHmac, randomInt } from "node:crypto";
import type { CodigoAutorizacion, GenerarCodigoAutorizacionRespuesta, OperacionAutorizable } from "@apurimeno/contracts";
import { crearCodigoAutorizacion } from "@apurimeno/domain";
import { auditar } from "../auditoria.js";
import type { Transaccion } from "../db.js";
import { aCodigoAutorizacion, fecha } from "../mapeo.js";
import { contextoDominio, parametrosVigentes, type ContextoServicio } from "./contexto.js";

// Códigos de autorización temporales (RN-46, RF-65): generación, búsqueda y límite de intentos. Los usan la
// anulación de cobros y el reintento de un cierre de turno (decisión 25).

const DIGITOS_CODIGO = 6;
/** Contra la fuerza bruta: con 6 dígitos, 5 intentos cada 15 minutos dan 1 en 200 000 de acertar. */
export const MAX_INTENTOS_FALLIDOS = 5;
const VENTANA_INTENTOS_MS = 15 * 60_000;

/** Secreto del servidor con el que se firman los códigos (HMAC-SHA256). */
export type SecretoCodigos = Buffer;

export function hashCodigo(secreto: SecretoCodigos, codigo: string): string {
  return createHmac("sha256", secreto).update(codigo.trim()).digest("hex");
}

/**
 * Genera un código de autorización temporal (CU-21, RN-46, RF-65): 6 dígitos de una fuente criptográfica,
 * de un solo uso, vigente los minutos configurados. Solo se guarda su HMAC; el código en claro se devuelve
 * esta única vez para que el Administrador se lo comunique al cajero.
 */
export async function generarCodigoServicio(
  ctx: ContextoServicio,
  secreto: SecretoCodigos,
  operacion: OperacionAutorizable,
): Promise<GenerarCodigoAutorizacionRespuesta> {
  return ctx.prisma.$transaction(async (tx) => {
    const { minutosVigenciaCodigoAutorizacion } = await parametrosVigentes(tx);
    // Dos códigos vigentes iguales serían ambiguos al validar: se regenera hasta que no choque.
    let codigo: string;
    let hash: string;
    do {
      codigo = randomInt(0, 10 ** DIGITOS_CODIGO).toString().padStart(DIGITOS_CODIGO, "0");
      hash = hashCodigo(secreto, codigo);
    } while ((await tx.codigoAutorizacion.findFirst({ where: { codigoHash: hash, usadoEn: null, expiraEn: { gt: ctx.ahora } } })) !== null);

    const registro = crearCodigoAutorizacion(
      { codigo: hash, operacion, generadoPorId: ctx.usuario.id, minutosVigencia: minutosVigenciaCodigoAutorizacion },
      contextoDominio(ctx.ahora),
    );
    await tx.codigoAutorizacion.create({
      data: {
        id: registro.id,
        codigoHash: hash,
        operacion: registro.operacion,
        generadoPorId: registro.generadoPorId,
        generadoEn: fecha(registro.generadoEn),
        expiraEn: fecha(registro.expiraEn),
      },
    });
    await auditar(
      tx,
      {
        usuarioId: ctx.usuario.id,
        accion: "CODIGO_AUTORIZACION_GENERADO",
        tipoEntidad: "CODIGO_AUTORIZACION",
        entidadId: registro.id,
        valorNuevo: { operacion: registro.operacion, expiraEn: registro.expiraEn },
      },
      ctx.ahora,
    );
    return { id: registro.id, codigo, operacion: registro.operacion, expiraEn: registro.expiraEn };
  });
}

export async function intentosFallidosRecientes(tx: Transaccion, usuarioId: string, ahora: Date): Promise<number> {
  return tx.registroAuditoria.count({
    where: {
      usuarioId,
      accion: "ACCESO_DENEGADO",
      tipoEntidad: "CODIGO_AUTORIZACION",
      ocurridoEn: { gt: new Date(ahora.getTime() - VENTANA_INTENTOS_MS) },
    },
  });
}

/** Busca el código ingresado por el cajero; null si no corresponde a ningún código sin usar. */
export async function buscarCodigo(
  tx: Transaccion,
  secreto: SecretoCodigos,
  valorIngresado: string | null,
): Promise<{ codigo: CodigoAutorizacion; valorIngresado: string } | null> {
  if (valorIngresado === null || valorIngresado.trim() === "") return null;
  const hash = hashCodigo(secreto, valorIngresado);
  const fila = await tx.codigoAutorizacion.findFirst({
    where: { codigoHash: hash, usadoEn: null },
    orderBy: { generadoEn: "desc" },
  });
  return fila === null ? null : { codigo: aCodigoAutorizacion(fila), valorIngresado: hash };
}
