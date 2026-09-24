import {
  LoginEntradaSchema,
  LoginRespuestaSchema,
  RUTAS,
  type Id,
  type Permiso,
} from "@apurimeno/contracts";
import { permisosEfectivos, puede, type Operacion } from "@apurimeno/domain";
import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditar } from "./auditoria.js";
import type { PrismaClient } from "./db.js";
import { ErrorApi, validar } from "./errores.js";
import { INCLUIR_USUARIO, aRangos, aUsuario } from "./mapeo.js";

export interface UsuarioAutenticado {
  id: Id;
  nombreUsuario: string;
  permisos: Permiso[];
}

declare module "fastify" {
  interface FastifyContextConfig {
    /**
     * Operación de `PERMISO_POR_OPERACION` que la ruta exige; con una lista, basta cualquiera de ellas.
     * Toda ruta declara esto o `publica`.
     */
    operacion?: Operacion | readonly Operacion[];
    publica?: boolean;
  }
  interface FastifyRequest {
    usuario: UsuarioAutenticado | null;
  }
}

export const COSTO_BCRYPT = 12;

export function hashContrasena(contrasena: string, costo = COSTO_BCRYPT): Promise<string> {
  return bcrypt.hash(contrasena, costo);
}

// Se compara contra este hash cuando el usuario no existe, para que la respuesta tarde lo mismo
// y no revele qué nombres de usuario existen (RF-31).
const HASH_DE_RELLENO = bcrypt.hashSync("usuario-inexistente", COSTO_BCRYPT);

/** El usuario autenticado de una ruta protegida; el middleware garantiza que existe. */
export function usuarioDe(request: FastifyRequest): UsuarioAutenticado {
  if (request.usuario === null) throw new ErrorApi("NO_AUTENTICADO", "Se requiere iniciar sesión.");
  return request.usuario;
}

/** Comprueba un permiso adicional dentro de una ruta (por ejemplo, el ajuste puntual). */
export function exigir(usuario: UsuarioAutenticado, operacion: Operacion): void {
  if (!puede(usuario.permisos, operacion)) {
    throw new ErrorApi("PERMISO_DENEGADO", `No tiene permiso para ${operacion}.`);
  }
}

/**
 * Autenticación por JWT (Bearer) y autorización con `puede()` de @apurimeno/domain antes de cada ruta.
 * Los permisos se leen de la base en cada solicitud, así que un cambio de rango rige en la siguiente
 * operación (RF-63). Toda ruta debe declarar `config.operacion` o `config.publica`: si no, el servidor
 * no arranca.
 */
export function registrarAutenticacion(app: FastifyInstance, prisma: PrismaClient, ahora: () => Date): void {
  app.decorateRequest("usuario", null);

  app.addHook("onRoute", (ruta) => {
    const config = ruta.config as { operacion?: Operacion | readonly Operacion[]; publica?: boolean } | undefined;
    if (config?.publica !== true && config?.operacion === undefined) {
      throw new Error(`La ruta ${ruta.method} ${ruta.url} no declara operacion ni publica.`);
    }
  });

  app.addHook("onRequest", async (request) => {
    const { operacion, publica } = request.routeOptions.config;
    if (publica === true || operacion === undefined) return;

    let sub: string;
    try {
      sub = (await request.jwtVerify<{ sub: string }>()).sub;
    } catch {
      throw new ErrorApi("NO_AUTENTICADO", "Se requiere iniciar sesión.");
    }
    const fila = await prisma.usuario.findUnique({ where: { id: sub }, include: INCLUIR_USUARIO });
    if (fila === null || !fila.activo) throw new ErrorApi("NO_AUTENTICADO", "La sesión no es válida.");

    const permisos = permisosEfectivos(aUsuario(fila), aRangos(fila));
    request.usuario = { id: fila.id, nombreUsuario: fila.nombreUsuario, permisos };
    const alternativas: readonly Operacion[] = typeof operacion === "string" ? [operacion] : operacion;
    if (!alternativas.some((o) => puede(permisos, o))) {
      await auditar(
        prisma,
        {
          usuarioId: fila.id,
          accion: "ACCESO_DENEGADO",
          tipoEntidad: "SESION",
          entidadId: null,
          valorNuevo: { operacion, metodo: request.method, ruta: request.url },
        },
        ahora(),
      );
      throw new ErrorApi("PERMISO_DENEGADO", `No tiene permiso para ${alternativas.join(" ni ")}.`);
    }
  });

  app.post(RUTAS.login, { config: { publica: true } }, async (request) => {
    const { nombreUsuario, contrasena } = validar(LoginEntradaSchema, request.body);
    const fila = await prisma.usuario.findUnique({ where: { nombreUsuario }, include: INCLUIR_USUARIO });
    const coincide = await bcrypt.compare(contrasena, fila?.contrasenaHash ?? HASH_DE_RELLENO);

    if (fila === null || !coincide || !fila.activo) {
      await auditar(
        prisma,
        { usuarioId: null, accion: "SESION_FALLIDA", tipoEntidad: "SESION", entidadId: null, valorNuevo: { nombreUsuario } },
        ahora(),
      );
      throw new ErrorApi("NO_AUTENTICADO", "Usuario o contraseña incorrectos.");
    }

    const usuario = aUsuario(fila);
    await auditar(
      prisma,
      { usuarioId: usuario.id, accion: "SESION_INICIADA", tipoEntidad: "SESION", entidadId: usuario.id },
      ahora(),
    );
    return LoginRespuestaSchema.parse({
      token: await app.jwt.sign({ sub: usuario.id }),
      usuario,
      permisos: permisosEfectivos(usuario, aRangos(fila)),
    });
  });
}
