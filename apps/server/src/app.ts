import { createHmac } from "node:crypto";
import fastifyJwt from "@fastify/jwt";
import Fastify, { type FastifyInstance } from "fastify";
import { registrarAutenticacion } from "./auth.js";
import type { PrismaClient } from "./db.js";
import { manejarError } from "./errores.js";
import { registrarRutas } from "./rutas.js";

export interface OpcionesApp {
  prisma: PrismaClient;
  /** Al menos 32 caracteres. */
  jwtSecret: string;
  /** Reloj del servidor; las pruebas lo controlan para simular el paso del tiempo. */
  ahora?: () => Date;
  logger?: boolean;
}

export async function construirApp(opciones: OpcionesApp): Promise<FastifyInstance> {
  if (opciones.jwtSecret.length < 32) throw new Error("jwtSecret debe tener al menos 32 caracteres.");
  const ahora = opciones.ahora ?? (() => new Date());

  const app = Fastify({ logger: opciones.logger ?? false });
  // Un turno de trabajo cabe en la vigencia del token.
  await app.register(fastifyJwt, { secret: opciones.jwtSecret, sign: { expiresIn: "12h" } });
  app.setErrorHandler(manejarError);
  registrarAutenticacion(app, opciones.prisma, ahora);
  // Secreto de los códigos de autorización, derivado del de JWT para no exigir otra variable de entorno.
  const secretoCodigos = createHmac("sha256", opciones.jwtSecret).update("codigos-autorizacion").digest();
  registrarRutas(app, opciones.prisma, ahora, secretoCodigos);
  await app.ready();
  return app;
}
