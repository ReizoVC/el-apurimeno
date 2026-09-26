import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CABECERA_IDEMPOTENCIA, RUTAS, type RangoSchema } from "@apurimeno/contracts";
import Database from "better-sqlite3";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { z } from "zod";
import { construirApp, type OpcionesApp } from "../src/app.js";
import { hashContrasena } from "../src/auth.js";
import { crearPrisma, type PrismaClient } from "../src/db.js";
import { ID_RANGO, sembrar } from "../src/semilla.js";

const MIGRACIONES = fileURLToPath(new URL("../prisma/migrations", import.meta.url));

/** Aplica las migraciones del repositorio, en orden, sobre una base vacía. */
function aplicarMigraciones(ruta: string): void {
  const db = new Database(ruta);
  try {
    for (const carpeta of readdirSync(MIGRACIONES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
      db.exec(readFileSync(join(MIGRACIONES, carpeta, "migration.sql"), "utf8"));
    }
  } finally {
    db.close();
  }
}

export interface Entorno {
  app: FastifyInstance;
  prisma: PrismaClient;
  ruta: string;
  /** Reloj del servidor, controlado por la prueba. */
  reloj: { ahora: Date; avanzarMinutos(minutos: number): void };
  crearUsuario(nombreUsuario: string, rangoIds: string[], activo?: boolean): Promise<void>;
  crearRango(id: string, permisos: z.infer<typeof RangoSchema>["permisos"]): Promise<void>;
  login(nombreUsuario: string): Promise<string>;
  llamar(metodo: "GET" | "POST" | "PUT" | "DELETE", url: string, token: string | null, cuerpo?: unknown, clave?: string): Promise<LightMyRequestResponse>;
  cerrar(): Promise<void>;
}

export const CONTRASENA = "contrasena-de-prueba";

/** Base SQLite real en un archivo temporal, migrada y sembrada, con la app lista para recibir solicitudes. */
export async function prepararEntorno(
  inicio = "2026-09-23T14:00:00.000Z",
  extra: Pick<OpcionesApp, "espejo"> = {},
): Promise<Entorno> {
  const dir = mkdtempSync(join(tmpdir(), "apurimeno-"));
  const ruta = join(dir, "prueba.db");
  aplicarMigraciones(ruta);
  const prisma = crearPrisma(`file:${ruta}`);
  await sembrar(prisma, { admin: { nombreUsuario: "admin", contrasena: CONTRASENA }, costoBcrypt: 4 });

  const reloj = {
    ahora: new Date(inicio),
    avanzarMinutos(minutos: number) {
      this.ahora = new Date(this.ahora.getTime() + minutos * 60_000);
    },
  };
  const app = await construirApp({ prisma, jwtSecret: "s".repeat(32), ahora: () => reloj.ahora, costoBcrypt: 4, ...extra });

  const entorno: Entorno = {
    app,
    prisma,
    ruta,
    reloj,
    async crearUsuario(nombreUsuario, rangoIds, activo = true) {
      await prisma.usuario.create({
        data: {
          id: `usuario-${nombreUsuario}`,
          nombreUsuario,
          activo,
          contrasenaHash: await hashContrasena(CONTRASENA, 4),
          rangos: { create: rangoIds.map((rangoId) => ({ rangoId })) },
        },
      });
    },
    async crearRango(id, permisos) {
      await prisma.rango.create({ data: { id, nombre: id, permisos: { create: permisos.map((permiso) => ({ permiso })) } } });
    },
    async login(nombreUsuario) {
      const r = await app.inject({ method: "POST", url: RUTAS.login, payload: { nombreUsuario, contrasena: CONTRASENA } });
      if (r.statusCode !== 200) throw new Error(`login de ${nombreUsuario} falló: ${r.body}`);
      return r.json<{ token: string }>().token;
    },
    llamar(metodo, url, token, cuerpo, clave) {
      const headers: Record<string, string> = {};
      if (token !== null) headers["authorization"] = `Bearer ${token}`;
      if (clave !== undefined) headers[CABECERA_IDEMPOTENCIA] = clave;
      return app.inject({ method: metodo, url, headers, ...(cuerpo === undefined ? {} : { payload: cuerpo as object }) });
    },
    async cerrar() {
      await app.close();
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  await entorno.crearUsuario("cajero", [ID_RANGO.CAJERO]);
  await entorno.crearUsuario("limpieza", [ID_RANGO.LIMPIEZA]);
  return entorno;
}

export const efectivo = (monto: number, montoRecibido: number | null = null) => ({
  metodoPagoId: "metodo-efectivo",
  monto,
  montoRecibido,
  referencia: null,
});

export const yape = (monto: number) => ({ metodoPagoId: "metodo-yape", monto, montoRecibido: null, referencia: "0001" });

export function ruta(plantilla: string, id: string): string {
  return plantilla.replace(":id", id);
}
