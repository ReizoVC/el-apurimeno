import { PERMISOS, RUTAS, RangoSchema } from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepararEntorno, ruta, type Entorno } from "./entorno.js";

let e: Entorno;
let admin: string;

beforeEach(async () => {
  e = await prepararEntorno();
  admin = await e.login("admin");
});
afterEach(() => e.cerrar());

const crearRango = async (nombre: string, permisos: string[]) => {
  const r = await e.llamar("POST", RUTAS.rangos, admin, { nombre, permisos });
  expect(r.statusCode).toBe(201);
  return RangoSchema.parse(r.json());
};

describe("Rangos (CU-24; RN-41, RF-62, RF-63)", () => {
  it("un rango nuevo se asigna y sus permisos rigen de inmediato; editarlo también", async () => {
    const recepcion = await crearRango("Recepción limpieza", ["cleaning.access", "cleaning.mark_ready"]);
    await e.crearUsuario("rosa", ["rango-cajero"]);
    const rosa = await e.login("rosa");
    expect((await e.llamar("GET", RUTAS.habitacionesPendientesLimpieza, rosa)).statusCode).toBe(403);

    await e.llamar("PUT", ruta(RUTAS.usuario, "usuario-rosa"), admin, {
      nombreUsuario: "rosa",
      activo: true,
      rangoIds: ["rango-cajero", recepcion.id],
    });
    expect((await e.llamar("GET", RUTAS.habitacionesPendientesLimpieza, rosa)).statusCode).toBe(200);

    const editado = await e.llamar("PUT", ruta(RUTAS.rango, recepcion.id), admin, { nombre: "Recepción", permisos: ["cleaning.mark_ready"] });
    expect(RangoSchema.parse(editado.json())).toEqual({ id: recepcion.id, nombre: "Recepción", permisos: ["cleaning.mark_ready"] });
    expect((await e.llamar("GET", RUTAS.habitacionesPendientesLimpieza, rosa)).statusCode).toBe(403);

    const acciones = (await e.prisma.registroAuditoria.findMany({ where: { tipoEntidad: "RANGO" }, orderBy: { ocurridoEn: "asc" } })).map((r) => r.accion);
    expect(acciones).toEqual(["RANGO_CREADO", "RANGO_EDITADO"]);
    expect(await e.prisma.registroAuditoria.findFirst({ where: { accion: "RANGO_EDITADO" } })).toMatchObject({
      valorPrevio: expect.objectContaining({ permisos: ["cleaning.access", "cleaning.mark_ready"] }),
    });
  });

  it("el nombre es único; los permisos deben ser del catálogo fijo", async () => {
    await crearRango("Supervisor", ["reports.view"]);
    expect((await e.llamar("POST", RUTAS.rangos, admin, { nombre: "Supervisor", permisos: [] })).json()).toMatchObject({ codigo: "VALIDACION" });
    expect((await e.llamar("POST", RUTAS.rangos, admin, { nombre: "Otro", permisos: ["todo.todo"] })).statusCode).toBe(400);
    expect((await e.llamar("PUT", ruta(RUTAS.rango, "rango-x"), admin, { nombre: "X", permisos: [] })).statusCode).toBe(404);
  });

  it("quien edita no puede quitarse users.manage a sí mismo por la vía del rango (decisión 19)", async () => {
    const sinUsuarios = PERMISOS.filter((p) => p !== "users.manage");
    const r = await e.llamar("PUT", ruta(RUTAS.rango, "rango-administrador"), admin, { nombre: "Administrador", permisos: sinUsuarios });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: "SELF_LOCKOUT_FORBIDDEN" });
    const fila = await e.prisma.rangoPermiso.findUnique({ where: { rangoId_permiso: { rangoId: "rango-administrador", permiso: "users.manage" } } });
    expect(fila).not.toBeNull();

    // Si conserva users.manage por otro rango, sí puede.
    const gestor = await crearRango("Gestor de cuentas", ["users.manage"]);
    await e.llamar("PUT", ruta(RUTAS.usuario, "usuario-admin"), admin, {
      nombreUsuario: "admin",
      activo: true,
      rangoIds: ["rango-administrador", gestor.id],
    });
    expect((await e.llamar("PUT", ruta(RUTAS.rango, "rango-administrador"), admin, { nombre: "Administrador", permisos: sinUsuarios })).statusCode).toBe(200);
  });

  it("solo users.manage gestiona rangos", async () => {
    const cajero = await e.login("cajero");
    expect((await e.llamar("POST", RUTAS.rangos, cajero, { nombre: "X", permisos: [] })).statusCode).toBe(403);
    expect((await e.llamar("GET", RUTAS.rangos, cajero)).statusCode).toBe(403);
  });
});
