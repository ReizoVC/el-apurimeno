import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CABECERA_IDEMPOTENCIA, RUTAS, RegistrarIngresoRespuestaSchema } from "@apurimeno/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { construirApp } from "../src/app.js";
import * as apps from "../../../packages/ui/src/lib/capacitacion.js";
import { CUENTAS_CAPACITACION, ErrorCapacitacion, PREFIJO_CAPACITACION, prepararCapacitacion, reiniciarCapacitacion } from "../src/capacitacion.js";
import { transporteArchivo } from "../src/impresion/transporte.js";
import {
  BASE_CAPACITACION,
  ESPEJO_DESACTIVADO_EN_CAPACITACION,
  PUERTO_CAPACITACION,
  instanciaDe,
  leerArranque,
} from "../src/instancia.js";
import { generarClaves } from "../src/respaldo/cifrado.js";
import { CONTRASENA, efectivo, prepararEntorno, ruta, type Entorno } from "./entorno.js";

// Instancia de capacitación (docs/INSTALACION_LOCAL.md): aislada de los datos reales, del espejo y de la carpeta
// sincronizada aunque su entorno traiga las variables de producción.

/** El entorno de producción completo, como si se hubiera copiado el .env del local a la capacitación. */
function entornoDeProduccion(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "file:C:/ElApurimeno/apps/server/datos/apurimeno.db",
    JWT_SECRET: "j".repeat(40),
    PORT: "3001",
    HOST: "0.0.0.0",
    CORS_ORIGINS: "http://192.168.1.50:3000,http://192.168.1.50:3002",
    IMPRESORA_DISPOSITIVO: "USB001",
    ESPEJO_SUPABASE_URL: "https://proyecto.supabase.co",
    ESPEJO_SUPABASE_ANON_KEY: "sb_publishable_abcdefghijklmnop",
    ESPEJO_SYNC_EMAIL: "servidor@example.com",
    ESPEJO_SYNC_PASSWORD: "una-contrasena-larga-del-servidor",
    RESPALDO_CARPETA_EXTERNA: "C:/RespaldosApurimeno",
    RESPALDO_CLAVE_PUBLICA: generarClaves().publica,
  };
}

describe("Arranque: qué instancia y con qué configuración", () => {
  it("solo el argumento --capacitacion elige la instancia de capacitación", () => {
    expect(instanciaDe([])).toBe("PRODUCCION");
    expect(instanciaDe(["--capacitacion"])).toBe("CAPACITACION");
  });

  it("con el .env de producción copiado, producción activaría el espejo y la copia externa…", () => {
    const produccion = leerArranque(entornoDeProduccion(), "PRODUCCION");
    expect(produccion.espejo.supabase).not.toBeNull();
    expect(produccion.respaldos.externo).not.toBeNull();
  });

  it("…pero la capacitación los ignora: sin espejo, sin carpeta sincronizada, base, puerto y secreto propios", () => {
    const a = leerArranque(entornoDeProduccion(), "CAPACITACION");
    expect(a.espejo).toEqual({ supabase: null, problema: ESPEJO_DESACTIVADO_EN_CAPACITACION, intervaloMinutos: 30 });
    expect(a.respaldos.externo).toBeNull();
    expect(a.respaldos.carpetaExternaConfigurada).toBeNull();
    expect(a.respaldos.carpetaLocal).toBe(resolve(BASE_CAPACITACION, "..", "respaldos"));
    expect(a.databaseUrl).toBe(`file:${BASE_CAPACITACION.replace(/\\/g, "/")}`);
    expect(a.jwtSecret).toBeUndefined();
    expect(a.puerto).toBe(PUERTO_CAPACITACION);
    // Sí usa lo que no lleva datos a ningún lado: la misma impresora, los mismos orígenes y el modo producción.
    expect(a).toMatchObject({ impresoraDispositivo: "USB001", corsOrigins: "http://192.168.1.50:3000,http://192.168.1.50:3002", produccion: true });
  });

  it("el servidor de producción no arranca con la base de capacitación", () => {
    const env = { ...entornoDeProduccion(), DATABASE_URL: `file:${BASE_CAPACITACION}` };
    expect(() => leerArranque(env, "PRODUCCION")).toThrow(/base de capacitación/);
  });
});

describe("Las apps eligen el servidor por el usuario, antes de llamar a nada (packages/ui/src/lib/capacitacion.ts)", () => {
  it("usan el mismo prefijo y el mismo puerto que el servidor", () => {
    expect(apps.PREFIJO_CAPACITACION).toBe(PREFIJO_CAPACITACION);
    expect(apps.PUERTO_CAPACITACION).toBe(PUERTO_CAPACITACION);
    for (const { nombreUsuario } of CUENTAS_CAPACITACION) expect(apps.entornoDeUsuario(nombreUsuario)).toBe("CAPACITACION");
  });

  it("reconocen la cuenta aunque el teclado ponga mayúscula o se escriba con tilde, y la envían como está en su base", () => {
    expect(apps.entornoDeUsuario(" Capacitación.Cajero1 ")).toBe("CAPACITACION");
    expect(apps.usuarioParaEnviar(" Capacitación.Cajero1 ")).toBe("capacitacion.cajero1");
  });

  it("todas las demás cuentas van al servidor del local, sin cambiar cómo se escribieron", () => {
    for (const u of ["admin", "Juan", "capacitacionadmin", "cajero.capacitacion"]) expect(apps.entornoDeUsuario(u)).toBe("PRODUCCION");
    expect(apps.usuarioParaEnviar(" Juan ")).toBe("Juan");
  });

  it("la URL de capacitación es la del local en el puerto 3011, salvo que se configure otra", () => {
    expect(apps.urlCapacitacion("http://localhost:3001", undefined)).toBe("http://localhost:3011");
    expect(apps.urlCapacitacion("http://192.168.1.57:3001", "")).toBe("http://192.168.1.57:3011");
    expect(apps.urlCapacitacion("http://192.168.1.57:3001", "http://192.168.1.60:4000/")).toBe("http://192.168.1.60:4000");
  });

  it("una sesión guardada antes de la capacitación sigue siendo del local", () => {
    expect(apps.entornoGuardado(undefined)).toBe("PRODUCCION");
    expect(apps.entornoGuardado("CAPACITACION")).toBe("CAPACITACION");
  });
});

describe("Base de capacitación: cuentas, ejemplos y reinicio", () => {
  let e: Entorno;
  let app: FastifyInstance | null = null;
  beforeEach(async () => {
    e = await prepararEntorno("2026-10-01T15:00:00.000Z");
    await prepararCapacitacion(e.prisma, "clave-de-capacitacion", 4);
  });
  afterEach(async () => {
    await app?.close();
    app = null;
    await e.cerrar();
  });

  const login = async (nombreUsuario: string, contrasena = "clave-de-capacitacion") => {
    const r = await e.app.inject({ method: "POST", url: RUTAS.login, payload: { nombreUsuario, contrasena } });
    return r;
  };

  it("crea las tres cuentas con sus rangos, y los productos de ejemplo", async () => {
    const cuentas = await e.prisma.usuario.findMany({
      where: { nombreUsuario: { startsWith: "capacitacion." } },
      include: { rangos: true },
      orderBy: { nombreUsuario: "asc" },
    });
    expect(cuentas.map((c) => [c.nombreUsuario, c.rangos.map((r) => r.rangoId)])).toEqual([
      ["capacitacion.admin", ["rango-administrador"]],
      ["capacitacion.cajero1", ["rango-cajero"]],
      ["capacitacion.cajero2", ["rango-cajero"]],
    ]);
    for (const { nombreUsuario } of CUENTAS_CAPACITACION) expect((await login(nombreUsuario)).statusCode).toBe(200);
    expect(await e.prisma.producto.count()).toBe(8);
    expect(await e.prisma.habitacion.count()).toBe(17);
  });

  it("el reinicio borra lo operativo y lo practicado, recarga los ejemplos y deja las tres cuentas intactas", async () => {
    const antes = await e.prisma.usuario.findMany({ where: { nombreUsuario: { startsWith: "capacitacion." } }, orderBy: { id: "asc" } });
    const cajero = (await login("capacitacion.cajero1")).json<{ token: string }>().token;
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 10000 });
    const ingreso = await e.llamar(
      "POST",
      RUTAS.registrarIngreso,
      cajero,
      { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
      "clave-capacitacion-1",
    );
    expect(ingreso.statusCode).toBe(201);
    await e.llamar(
      "POST",
      RUTAS.registrarVenta,
      cajero,
      { items: [{ productoId: "cap-prod-gaseosa", cantidad: 2 }], esHuesped: false, habitacionReferenciaId: null, ajuste: null, pagos: [efectivo(700)] },
      "clave-capacitacion-2",
    );
    await e.prisma.habitacion.update({ where: { id: "hab-101" }, data: { precioBase: 9900 } });
    expect(await e.prisma.ticket.count()).toBe(2);

    const { borrados } = await reiniciarCapacitacion(e.prisma);
    expect(borrados).toMatchObject({ Ticket: 2, Alquiler: 1, Turno: 1 });
    for (const tabla of ["alquiler", "ticket", "pago", "turno", "movimientoCaja", "movimientoInventario", "registroAuditoria", "trabajoImpresion"] as const) {
      expect(await (e.prisma[tabla] as { count: () => Promise<number> }).count()).toBe(0);
    }
    const habitaciones = await e.prisma.habitacion.findMany();
    expect(habitaciones).toHaveLength(17);
    expect(habitaciones.every((h) => h.estado === "LIBRE")).toBe(true);
    expect(habitaciones.find((h) => h.id === "hab-101")?.precioBase).toBe(2500);
    expect((await e.prisma.producto.findUniqueOrThrow({ where: { id: "cap-prod-gaseosa" } })).stock).toBe(48);
    // Las tres cuentas, idénticas (misma contraseña y rangos); las del arnés de pruebas, creadas "al practicar", ya no.
    const despues = await e.prisma.usuario.findMany({ orderBy: { id: "asc" } });
    expect(despues).toEqual(antes);
    expect((await login("capacitacion.admin")).statusCode).toBe(200);
    // Se puede volver a atender desde cero: el ticket vuelve a ser el número 1.
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 });
    const otra = await e.llamar(
      "POST",
      RUTAS.registrarIngreso,
      cajero,
      { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
      "clave-capacitacion-3",
    );
    expect(RegistrarIngresoRespuestaSchema.parse(otra.json()).ticket.numero).toBe(1);
  });

  it("se niega a reiniciar una base que no tiene las tres cuentas, sin borrar nada", async () => {
    await e.prisma.usuarioRango.deleteMany({ where: { usuarioId: "usuario-capacitacion.cajero2" } });
    await e.prisma.usuario.delete({ where: { nombreUsuario: "capacitacion.cajero2" } });
    const cajero = await e.login("cajero");
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 });
    await expect(reiniciarCapacitacion(e.prisma)).rejects.toThrow(ErrorCapacitacion);
    expect(await e.prisma.turno.count()).toBe(1);
  });

  it("todo comprobante impreso por la instancia de capacitación dice CAPACITACIÓN; el de producción, no", async () => {
    const imprimir = async (capacitacion: boolean, clave: string) => {
      const archivo = join(mkdtempSync(join(tmpdir(), "impresora-")), "lp0");
      app = await construirApp({ prisma: e.prisma, jwtSecret: "s".repeat(32), ahora: () => e.reloj.ahora, costoBcrypt: 4, impresora: transporteArchivo(archivo), capacitacion });
      const token = (await app.inject({ method: "POST", url: RUTAS.login, payload: { nombreUsuario: "cajero", contrasena: CONTRASENA } })).json<{ token: string }>().token;
      const headers = { authorization: `Bearer ${token}` };
      await app.inject({ method: "POST", url: RUTAS.abrirTurno, headers, payload: { efectivoInicial: 0 } });
      const r = await app.inject({
        method: "POST",
        url: RUTAS.registrarIngreso,
        headers: { ...headers, [CABECERA_IDEMPOTENCIA]: clave },
        payload: { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
      });
      const { alquiler, ticket } = RegistrarIngresoRespuestaSchema.parse(r.json());
      // La reimpresión también: la copia de capacitación lleva las dos marcas.
      await app.inject({ method: "POST", url: ruta(RUTAS.reimprimirTicket, ticket.id), headers });
      await app.colaImpresion();
      await app.inject({ method: "POST", url: ruta(RUTAS.registrarSalida, alquiler.id), headers, payload: {} });
      await app.inject({ method: "POST", url: RUTAS.cerrarTurno, headers, payload: { efectivoContado: 4000, comentario: null } });
      await app.close();
      app = null;
      return readFileSync(archivo).toString("latin1");
    };
    const deCapacitacion = await imprimir(true, "clave-imp-cap");
    expect(deCapacitacion.split("*** CAPACITACI").length - 1).toBe(2);
    expect(deCapacitacion).toContain("*** COPIA ***");
    await e.prisma.habitacion.update({ where: { id: "hab-205" }, data: { estado: "LIBRE" } });
    const deProduccion = await imprimir(false, "clave-imp-prod");
    expect(deProduccion).not.toContain("CAPACITACI");
  });
});
