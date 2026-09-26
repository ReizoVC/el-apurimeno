import { createHmac } from "node:crypto";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import { CABECERA_IDEMPOTENCIA } from "@apurimeno/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import { COSTO_BCRYPT, registrarAutenticacion } from "./auth.js";
import type { PrismaClient } from "./db.js";
import { SIN_ESPEJO, crearControlEspejo, type ControlEspejo, type OpcionesEspejo } from "./espejo/control.js";
import { manejarError } from "./errores.js";
import { despacharPendientes } from "./impresion/cola.js";
import { OPCIONES_ESCPOS_POR_DEFECTO, type PaginaCodigos } from "./impresion/escpos.js";
import type { TransporteImpresora } from "./impresion/transporte.js";
import { registrarRutas } from "./rutas.js";
import { registrarRutasClientes } from "./rutas-clientes.js";
import { registrarRutasConfiguracion } from "./rutas-configuracion.js";
import { registrarRutasEspejo } from "./rutas-espejo.js";
import { registrarRutasHabitaciones } from "./rutas-habitaciones.js";
import { registrarRutasUsuarios } from "./rutas-usuarios.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Promesa del último envío a la impresora: las pruebas la esperan antes de revisar el resultado. */
    colaImpresion: () => Promise<void>;
    /** Sincronización con el espejo en la nube; `index.ts` la inicia, las pruebas la llaman a mano. */
    espejo: ControlEspejo;
  }
}

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
  /** Transporte a la impresora (ADR-05). Sin él, los comprobantes quedan en cola (PENDIENTE). */
  impresora?: TransporteImpresora | null;
  /** Página de códigos de la impresora; por defecto PC850. */
  paginaCodigos?: PaginaCodigos;
  /** Espejo en la nube (ADR-06). Sin él, el servidor funciona igual, sin sincronizar. */
  espejo?: OpcionesEspejo;
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
  // Un envío a la vez: dos cobros casi simultáneos no deben mezclar sus bytes en la misma impresora.
  const opcionesEscPos = { ...OPCIONES_ESCPOS_POR_DEFECTO, paginaCodigos: opciones.paginaCodigos ?? OPCIONES_ESCPOS_POR_DEFECTO.paginaCodigos };
  let cola: Promise<void> = Promise.resolve();
  const imprimir = (ticketId: string) => {
    cola = cola
      .then(() => despacharPendientes(opciones.prisma, opciones.impresora ?? null, ticketId, app.log, opcionesEscPos))
      .catch((err: unknown) => app.log.error({ err, ticketId }, "Error en la cola de impresión"));
  };
  app.decorate("colaImpresion", () => cola);
  registrarRutas(app, opciones.prisma, ahora, secretoCodigos, imprimir);
  registrarRutasHabitaciones(app, opciones.prisma, ahora);
  registrarRutasClientes(app, opciones.prisma, ahora);
  registrarRutasConfiguracion(app, opciones.prisma, ahora);
  registrarRutasUsuarios(app, opciones.prisma, ahora, opciones.costoBcrypt ?? COSTO_BCRYPT);
  const espejo = crearControlEspejo(opciones.prisma, ahora, opciones.espejo ?? SIN_ESPEJO, app.log);
  app.decorate("espejo", espejo);
  app.addHook("onClose", async () => espejo.detener());
  registrarRutasEspejo(app, opciones.prisma, ahora, espejo);
  await app.ready();
  return app;
}
