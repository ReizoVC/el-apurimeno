import { AuditoriaRespuestaSchema, RUTAS, type RegistroAuditoria } from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepararEntorno, ruta, type Entorno } from "./entorno.js";

let e: Entorno;
let admin: string;
let cajero: string;

beforeEach(async () => {
  e = await prepararEntorno();
  admin = await e.login("admin"); // 14:00 SESION_INICIADA
  cajero = await e.login("cajero"); // 14:00 SESION_INICIADA
  e.reloj.avanzarMinutos(60);
  await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 }); // 15:00 TURNO_ABIERTO
  e.reloj.avanzarMinutos(60);
  await e.llamar("POST", ruta(RUTAS.bloquearHabitacion, "hab-205"), admin, { motivo: "pintura" }); // 16:00
  e.reloj.avanzarMinutos(1);
  await e.llamar("POST", ruta(RUTAS.reactivarHabitacion, "hab-205"), admin); // 16:01
  e.reloj.avanzarMinutos(1);
  await e.llamar("GET", RUTAS.auditoria, cajero); // 16:02 ACCESO_DENEGADO
});
afterEach(() => e.cerrar());

const consultar = async (filtros: string) => {
  const r = await e.llamar("GET", `${RUTAS.auditoria}${filtros}`, admin);
  expect(r.statusCode).toBe(200);
  return AuditoriaRespuestaSchema.parse(r.json());
};
const acciones = (registros: RegistroAuditoria[]) => registros.map((r) => r.accion);

describe("Consulta de auditoría (CU-25, RF-46)", () => {
  it("sin filtros: del más reciente al más antiguo", async () => {
    const { registros, siguiente } = await consultar("");
    expect(acciones(registros)).toEqual([
      "ACCESO_DENEGADO",
      "HABITACION_ESTADO_CAMBIADO",
      "HABITACION_ESTADO_CAMBIADO",
      "TURNO_ABIERTO",
      // Mismo instante: el orden entre ambos lo decide el id, no el orden de inserción.
      "SESION_INICIADA",
      "SESION_INICIADA",
    ]);
    expect(siguiente).toBeNull();
  });

  it("los filtros se combinan: usuario, acción, entidad y periodo [desde, hasta)", async () => {
    expect(acciones((await consultar("?usuarioId=usuario-cajero")).registros)).toEqual(["ACCESO_DENEGADO", "TURNO_ABIERTO", "SESION_INICIADA"]);
    const porEntidad = (await consultar("?tipoEntidad=HABITACION&entidadId=hab-205")).registros;
    expect(porEntidad.map((r) => r.valorNuevo)).toEqual([{ estado: "LIBRE" }, { estado: "MANTENIMIENTO" }]);
    expect(porEntidad.find((r) => r.motivo !== null)?.motivo).toBe("pintura");
    expect(acciones((await consultar("?accion=SESION_INICIADA&usuarioId=usuario-admin")).registros)).toEqual(["SESION_INICIADA"]);
    const periodo = "?desde=2026-09-23T15:00:00.000Z&hasta=2026-09-23T16:00:00.000Z";
    expect(acciones((await consultar(periodo)).registros)).toEqual(["TURNO_ABIERTO"]);
  });

  it("paginación por cursor: recorre todo sin repetir ni saltar registros", async () => {
    const vistos: string[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const pagina = await consultar(`?limite=2${cursor === null ? "" : `&despuesDe=${cursor}`}`);
      vistos.push(...pagina.registros.map((r) => r.id));
      cursor = pagina.siguiente;
      paginas++;
    } while (cursor !== null);
    const todos = (await consultar("")).registros.map((r) => r.id);
    expect(paginas).toBe(3);
    expect(vistos).toEqual(todos);
  });

  it("filtros inválidos → 400; solo audit.view consulta, y la consulta no modifica el registro", async () => {
    expect((await e.llamar("GET", `${RUTAS.auditoria}?limite=0`, admin)).statusCode).toBe(400);
    expect((await e.llamar("GET", `${RUTAS.auditoria}?accion=BORRAR_TODO`, admin)).statusCode).toBe(400);
    expect((await e.llamar("GET", `${RUTAS.auditoria}?desde=2026-09-24T00:00:00.000Z&hasta=2026-09-23T00:00:00.000Z`, admin)).statusCode).toBe(400);
    const antes = await e.prisma.registroAuditoria.count();
    await consultar("");
    expect(await e.prisma.registroAuditoria.count()).toBe(antes);
    expect((await e.llamar("GET", RUTAS.auditoria, cajero)).statusCode).toBe(403);
  });
});
