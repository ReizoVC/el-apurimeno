import { createHmac } from "node:crypto";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import { CABECERA_IDEMPOTENCIA } from "@apurimeno/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import { COSTO_BCRYPT, registrarAutenticacion } from "./auth.js";
import type { PrismaClient } from "./db.js";
import { manejarError } from "./errores.js";
import { registrarRutas } from "./rutas.js";
import { registrarRutasClientes } from "./rutas-clientes.js";
import { registrarRutasHabitaciones } from "./rutas-habitaciones.js";
import { registrarRutasUsuarios } from "./rutas-usuarios.js";

export interface OpcionesApp {
  prisma: PrismaClient;
  /** Al menos 32 caracteres. */
  jwtSecret: string;
  /** Reloj del servidor; las pruebas lo controlan para simular el paso del tiempo. */
  ahora?: () => Date;
  logger?: boolean;
  /** Costo bcrypt de las contraseñas nuevas; las pruebas usan uno bajo. */
  costoBcrypt?: number;
  /** Lista blanca de orígenes de navegador (CORS); ver cors.ts. Por defecto, ninguno. */
  origenesPermitidos?: readonly string[];
}

export async function construirApp(opciones: OpcionesApp): Promise<FastifyInstance> {
  if (opciones.jwtSecret.length < 32) throw new Error("jwtSecret debe tener al menos 32 caracteres.");
  const ahora = opciones.ahora ?? (() => new Date());

  const app = Fastify({ logger: opciones.logger ?? false });
  // Un turno de trabajo cabe en la vigencia del token.
  // Antes que la autenticación: la ruta OPTIONS del preflight es pública y la responde este plugin.
  await app.register(fastifyCors, {
    origin: [...(opciones.origenesPermitidos ?? [])],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["authorization", "content-type", CABECERA_IDEMPOTENCIA],
    exposedHeaders: ["idempotent-replayed"],
  });
  await app.register(fastifyJwt, { secret: opciones.jwtSecret, sign: { expiresIn: "12h" } });
  app.setErrorHandler(manejarError);
  registrarAutenticacion(app, opciones.prisma, ahora);
  // Secreto de los códigos de autorización, derivado del de JWT para no exigir otra variable de entorno.
  const secretoCodigos = createHmac("sha256", opciones.jwtSecret).update("codigos-autorizacion").digest();
  registrarRutas(app, opciones.prisma, ahora, secretoCodigos);
  registrarRutasHabitaciones(app, opciones.prisma, ahora);
  registrarRutasClientes(app, opciones.prisma, ahora);
  registrarRutasUsuarios(app, opciones.prisma, ahora, opciones.costoBcrypt ?? COSTO_BCRYPT);
  await app.ready();
  return app;
}
