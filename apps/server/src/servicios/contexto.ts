import { randomUUID } from "node:crypto";
import type { Contexto } from "@apurimeno/domain";
import type { UsuarioAutenticado } from "../auth.js";
import type { PrismaClient, Transaccion } from "../db.js";
import { ErrorApi } from "../errores.js";
import { aParametros } from "../mapeo.js";

export interface ContextoServicio {
  prisma: PrismaClient;
  usuario: UsuarioAutenticado;
  /** Hora del servidor (RF-07, §21): nunca la del dispositivo cliente. */
  ahora: Date;
}

export function contextoDominio(ahora: Date): Contexto {
  return { ahora: ahora.toISOString(), generarId: randomUUID };
}

export function noEncontrado(entidad: string): ErrorApi {
  return new ErrorApi("NO_ENCONTRADO", `${entidad} no existe.`);
}

export async function parametrosVigentes(tx: Transaccion) {
  const config = await tx.configuracionGlobal.findUnique({ where: { id: 1 } });
  if (config === null) throw new Error("Falta la configuración global: ejecute la semilla.");
  return {
    parametros: aParametros(config.parametrosAlquiler),
    permitirStockNegativo: config.permitirStockNegativo,
    minutosVigenciaCodigoAutorizacion: config.minutosVigenciaCodigoAutorizacion,
  };
}
