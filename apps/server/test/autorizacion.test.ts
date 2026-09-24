import { LoginRespuestaSchema, RUTAS } from "@apurimeno/contracts";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registrarAutenticacion } from "../src/auth.js";
import { ID_RANGO } from "../src/semilla.js";
import { CONTRASENA, efectivo, prepararEntorno, type Entorno } from "./entorno.js";

let e: Entorno;

beforeEach(async () => {
  e = await prepararEntorno();
});
afterEach(() => e.cerrar());

const ingreso = { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] };

describe("Autenticación (RN-40, RF-31)", () => {
  it("inicia sesión con usuario y contraseña, y responde el usuario sin credenciales", async () => {
    const r = await e.app.inject({ method: "POST", url: RUTAS.login, payload: { nombreUsuario: "cajero", contrasena: CONTRASENA } });
    expect(r.statusCode).toBe(200);
    const cuerpo = LoginRespuestaSchema.parse(r.json());
    expect(cuerpo.permisos).toContain("rentals.checkin");
    expect(r.body).not.toContain("contrasenaHash");
  });

  it("la contraseña se guarda con hash bcrypt, nunca en claro", async () => {
    const usuario = await e.prisma.usuario.findUniqueOrThrow({ where: { nombreUsuario: "cajero" } });
    expect(usuario.contrasenaHash).toMatch(/^\$2[aby]\$/);
    expect(usuario.contrasenaHash).not.toContain(CONTRASENA);
  });

  it("una contraseña incorrecta o un usuario inexistente responden igual, y se auditan", async () => {
    const mal = await e.app.inject({ method: "POST", url: RUTAS.login, payload: { nombreUsuario: "cajero", contrasena: "otra" } });
    const nadie = await e.app.inject({ method: "POST", url: RUTAS.login, payload: { nombreUsuario: "fantasma", contrasena: "x" } });
    expect([mal.statusCode, nadie.statusCode]).toEqual([401, 401]);
    expect(mal.json()).toEqual(nadie.json());
    expect(await e.prisma.registroAuditoria.count({ where: { accion: "SESION_FALLIDA" } })).toBe(2);
  });

  it("sin token, o con un token inválido, responde 401", async () => {
    expect((await e.llamar("POST", RUTAS.abrirTurno, null, { efectivoInicial: 0 })).statusCode).toBe(401);
    expect((await e.llamar("POST", RUTAS.abrirTurno, "token-falso", { efectivoInicial: 0 })).json()).toMatchObject({
      codigo: "NO_AUTENTICADO",
    });
  });

  it("un usuario desactivado pierde el acceso aunque su token no haya vencido (RF-45)", async () => {
    const token = await e.login("cajero");
    await e.prisma.usuario.update({ where: { nombreUsuario: "cajero" }, data: { activo: false } });
    expect((await e.llamar("POST", RUTAS.abrirTurno, token, { efectivoInicial: 0 })).statusCode).toBe(401);
  });
});

describe("Autorización con puede() antes de cada ruta (RN-41, §22)", () => {
  it("Limpieza no puede registrar ingresos ni abrir turno: 403 y queda auditado", async () => {
    const token = await e.login("limpieza");
    const r = await e.llamar("POST", RUTAS.registrarIngreso, token, ingreso, "clave-limpieza-1");
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: "PERMISO_DENEGADO" });
    expect((await e.llamar("POST", RUTAS.abrirTurno, token, { efectivoInicial: 0 })).statusCode).toBe(403);
    expect(await e.prisma.registroAuditoria.count({ where: { accion: "ACCESO_DENEGADO" } })).toBe(2);
    expect(await e.prisma.alquiler.count()).toBe(0);
  });

  it("un cambio de rango rige en la siguiente solicitud, sin volver a iniciar sesión (RF-63)", async () => {
    const token = await e.login("limpieza");
    expect((await e.llamar("POST", RUTAS.abrirTurno, token, { efectivoInicial: 0 })).statusCode).toBe(403);
    await e.prisma.usuarioRango.create({ data: { usuarioId: "usuario-limpieza", rangoId: ID_RANGO.CAJERO } });
    expect((await e.llamar("POST", RUTAS.abrirTurno, token, { efectivoInicial: 0 })).statusCode).toBe(201);
  });

  it("el ajuste puntual exige su propio permiso además del de ingreso", async () => {
    await e.crearRango("rango-sin-ajuste", ["pos.access", "shifts.open", "rentals.checkin"]);
    await e.crearUsuario("aprendiz", ["rango-sin-ajuste"]);
    const token = await e.login("aprendiz");
    await e.llamar("POST", RUTAS.abrirTurno, token, { efectivoInicial: 0 });

    const conAjuste = { ...ingreso, ajuste: { montoAjustado: 5000, motivo: "x" }, pagos: [efectivo(5000)] };
    const r = await e.llamar("POST", RUTAS.registrarIngreso, token, conAjuste, "clave-aprendiz-1");
    expect(r.statusCode).toBe(403);
    expect(await e.prisma.alquiler.count()).toBe(0);
    expect((await e.llamar("POST", RUTAS.registrarIngreso, token, ingreso, "clave-aprendiz-2")).statusCode).toBe(201);
  });

  it("una ruta que no declara su operación impide que el servidor arranque", async () => {
    const app = Fastify();
    registrarAutenticacion(app, e.prisma, () => new Date());
    expect(() => app.get("/sin-permiso", async () => "x")).toThrow(/no declara operacion/);
    await app.close();
  });
});

describe("Validación de entrada", () => {
  it("un cuerpo que no cumple el contrato responde 400 VALIDACION", async () => {
    const token = await e.login("cajero");
    const r = await e.llamar("POST", RUTAS.abrirTurno, token, { efectivoInicial: 10.5 });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ codigo: "VALIDACION" });
  });
});
