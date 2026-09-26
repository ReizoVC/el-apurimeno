import { RUTAS } from "@apurimeno/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { construirApp } from "../src/app.js";
import { ORIGENES_DESARROLLO, leerOrigenesPermitidos } from "../src/cors.js";
import { prepararEntorno, type Entorno } from "./entorno.js";

describe("CORS_ORIGINS", () => {
  it("lista blanca separada por comas, sin espacios sobrantes", () => {
    expect(
      leerOrigenesPermitidos(
        " http://192.168.1.50:3002 ,https://panel.local ",
        true,
      ),
    ).toEqual(["http://192.168.1.50:3002", "https://panel.local"]);
  });

  it("sin la variable: localhost y el POS en desarrollo; en producción, solo el POS de escritorio (Tauri)", () => {
    expect(leerOrigenesPermitidos(undefined, false)).toEqual(
      ORIGENES_DESARROLLO,
    );
    expect(leerOrigenesPermitidos(undefined, false)).toContain(
      "http://localhost:1420",
    );
    expect(leerOrigenesPermitidos(undefined, true)).toEqual([
      "tauri://localhost",
      "http://tauri.localhost",
    ]);
  });

  it("acepta los orígenes de Tauri en la lista explícita; otro esquema no web, no", () => {
    expect(
      leerOrigenesPermitidos("tauri://localhost,http://tauri.localhost", true),
    ).toEqual(["tauri://localhost", "http://tauri.localhost"]);
    expect(() => leerOrigenesPermitidos("tauri://otro", true)).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it.each([
    "*",
    "http://*.local:3002",
    "http://192.168.1.50:3002/",
    "192.168.1.50:3002",
    "ftp://x.local",
    "http://a:3002/ruta",
  ])("rechaza %s al arrancar", (valor) => {
    expect(() => leerOrigenesPermitidos(valor, false)).toThrow(/CORS_ORIGINS/);
  });
});

describe("CORS en la API", () => {
  let e: Entorno;
  let app: FastifyInstance;
  const permitido = "http://192.168.1.50:3002";

  beforeEach(async () => {
    e = await prepararEntorno();
    app = await construirApp({
      prisma: e.prisma,
      jwtSecret: "s".repeat(32),
      origenesPermitidos: [permitido],
    });
  });
  afterEach(async () => {
    await app.close();
    await e.cerrar();
  });

  const preflight = (origin: string) =>
    app.inject({
      method: "OPTIONS",
      url: RUTAS.habitacionesPendientesLimpieza,
      headers: {
        origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });

  it("un origen de la lista pasa el preflight y recibe la cabecera en la respuesta real", async () => {
    const r = await preflight(permitido);
    expect(r.statusCode).toBe(204);
    expect(r.headers["access-control-allow-origin"]).toBe(permitido);
    expect(String(r.headers["access-control-allow-headers"])).toContain(
      "authorization",
    );

    const login = await app.inject({
      method: "POST",
      url: RUTAS.login,
      headers: { origin: permitido },
      payload: {
        nombreUsuario: "limpieza",
        contrasena: "contrasena-de-prueba",
      },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["access-control-allow-origin"]).toBe(permitido);
  });

  it("un origen fuera de la lista no recibe permiso, ni refleja el origen", async () => {
    const r = await preflight("http://intruso.local:3002");
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    const salud = await app.inject({
      method: "GET",
      url: RUTAS.salud,
      headers: { origin: "http://intruso.local:3002" },
    });
    expect(salud.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
