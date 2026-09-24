import { MENSAJE_ERROR_NEGOCIO, type CodigoErrorApi, type RespuestaError } from "@apurimeno/contracts";
import { ErrorNegocio } from "@apurimeno/domain";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { ZodType, ZodTypeDef } from "zod";
import { Prisma } from "./generated/prisma/client.js";

const ESTADO_HTTP: Record<CodigoErrorApi, number> = {
  VALIDACION: 400,
  NO_AUTENTICADO: 401,
  PERMISO_DENEGADO: 403,
  NO_ENCONTRADO: 404,
  CLAVE_IDEMPOTENCIA_REUTILIZADA: 409,
  ERROR_INTERNO: 500,
};

/** Error técnico de la API (no de negocio). */
export class ErrorApi extends Error {
  readonly codigo: CodigoErrorApi;
  readonly estado: number;

  constructor(codigo: CodigoErrorApi, mensaje: string) {
    super(mensaje);
    this.name = "ErrorApi";
    this.codigo = codigo;
    this.estado = ESTADO_HTTP[codigo];
  }
}

/** Valida la forma de una entrada con su esquema de contracts. */
export function validar<T>(esquema: ZodType<T, ZodTypeDef, unknown>, datos: unknown): T {
  const resultado = esquema.safeParse(datos);
  if (resultado.success) return resultado.data;
  const detalle = resultado.error.issues
    .map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`)
    .join("; ");
  throw new ErrorApi("VALIDACION", detalle);
}

export function esViolacionUnica(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Un error de negocio responde 422 con su `codigo` estable (§24.2). Datos que violan el contrato
 * fuera de la validación de entrada (ZodError, RangeError) son defectos: responden 500 y se registran.
 */
export function manejarError(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  let estado: number;
  let cuerpo: RespuestaError;

  if (error instanceof ErrorNegocio) {
    estado = 422;
    cuerpo = { codigo: error.codigo, mensaje: error.message || MENSAJE_ERROR_NEGOCIO[error.codigo] };
  } else if (error instanceof ErrorApi) {
    estado = error.estado;
    cuerpo = { codigo: error.codigo, mensaje: error.message };
  } else if ("statusCode" in error && typeof error.statusCode === "number" && error.statusCode < 500) {
    // Errores de Fastify antes de llegar a la ruta: JSON mal formado, cuerpo vacío, etc.
    estado = 400;
    cuerpo = { codigo: "VALIDACION", mensaje: error.message };
  } else {
    request.log.error({ err: error }, "Error interno");
    estado = 500;
    cuerpo = { codigo: "ERROR_INTERNO", mensaje: "Error interno del servidor." };
  }
  void reply.status(estado).send(cuerpo);
}
