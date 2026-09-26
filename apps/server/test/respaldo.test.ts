import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EstadoRespaldosSchema,
  RUTAS,
  RegistrarIngresoRespuestaSchema,
  RespaldoRespuestaSchema,
} from "@apurimeno/contracts";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cifrarArchivo, descifrarArchivo, ErrorClave, generarClaves, leerClavePrivada, leerClavePublica, publicaDePrivada } from "../src/respaldo/cifrado.js";
import { leerConfiguracionRespaldos, type ConfiguracionRespaldos } from "../src/respaldo/configuracion.js";
import { fechaDeCopia, nombreCopia, verificarBase } from "../src/respaldo/copia.js";
import { copiasDisponibles, restaurar } from "../src/respaldo/restauracion.js";
import { efectivo, prepararEntorno, type Entorno } from "./entorno.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "apurimeno-respaldo-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Cifrado de la copia externa", () => {
  const claves = generarClaves();

  it("lo cifrado con la pública solo se abre con la privada correspondiente", async () => {
    const original = join(dir, "original.bin");
    const contenido = Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(300_000, 7), Buffer.from("fin")]);
    writeFileSync(original, contenido);
    await cifrarArchivo(original, join(dir, "c"), leerClavePublica(claves.publica));
    const cifrado = readFileSync(join(dir, "c"));
    expect(cifrado.subarray(0, 8).toString()).toBe("APURESP1");
    expect(cifrado.includes(Buffer.from("SQLite format 3"))).toBe(false);

    await descifrarArchivo(join(dir, "c"), join(dir, "d"), leerClavePrivada(claves.privada));
    expect(readFileSync(join(dir, "d")).equals(contenido)).toBe(true);

    const otra = generarClaves();
    await expect(descifrarArchivo(join(dir, "c"), join(dir, "e"), leerClavePrivada(otra.privada))).rejects.toThrow(ErrorClave);
  });

  it("un archivo modificado no se descifra", async () => {
    writeFileSync(join(dir, "o"), Buffer.alloc(50_000, 1));
    await cifrarArchivo(join(dir, "o"), join(dir, "c"), leerClavePublica(claves.publica));
    const cifrado = readFileSync(join(dir, "c"));
    cifrado[cifrado.length - 100]! ^= 0xff;
    writeFileSync(join(dir, "c2"), cifrado);
    await expect(descifrarArchivo(join(dir, "c2"), join(dir, "d"), leerClavePrivada(claves.privada))).rejects.toThrow(ErrorClave);
  });

  it("detecta una clave mal copiada y deriva la pública de la privada", () => {
    expect(publicaDePrivada(claves.privada)).toBe(claves.publica);
    const cambiada = claves.privada.slice(0, -3) + (claves.privada.endsWith("AAA") ? "BBB" : "AAA");
    expect(() => leerClavePrivada(cambiada)).toThrow(/mal copiada/);
    expect(() => leerClavePrivada(claves.publica)).toThrow(/apr-privada-/);
    expect(() => leerClavePublica(claves.publica.slice(0, 20))).toThrow(ErrorClave);
  });
});

describe("Configuración de los respaldos", () => {
  const { publica, privada } = generarClaves();
  const base = join("C:", "local", "datos", "apurimeno.db");

  it("las copias locales van por defecto junto a la base; sin variables no hay externa ni problema", () => {
    const c = leerConfiguracionRespaldos({}, base);
    expect(c.carpetaLocal).toBe(join("C:", "local", "datos", "respaldos"));
    expect(c.externo).toBeNull();
    expect(c.problemaExterno).toBeNull();
  });

  it("la externa necesita carpeta completa y clave pública válida", () => {
    const externa = join(dir, "OneDrive");
    expect(leerConfiguracionRespaldos({ RESPALDO_CARPETA_EXTERNA: externa }, base).problemaExterno).toMatch(/RESPALDO_CLAVE_PUBLICA/);
    expect(leerConfiguracionRespaldos({ RESPALDO_CLAVE_PUBLICA: publica }, base).problemaExterno).toMatch(/RESPALDO_CARPETA_EXTERNA/);
    expect(leerConfiguracionRespaldos({ RESPALDO_CARPETA_EXTERNA: "respaldos", RESPALDO_CLAVE_PUBLICA: publica }, base).problemaExterno).toMatch(
      /ruta completa/,
    );
    expect(
      leerConfiguracionRespaldos({ RESPALDO_CARPETA_EXTERNA: externa, RESPALDO_CLAVE_PUBLICA: publica.slice(0, -2) }, base).problemaExterno,
    ).toMatch(/no es válida/);
    const bien = leerConfiguracionRespaldos({ RESPALDO_CARPETA_EXTERNA: externa, RESPALDO_CLAVE_PUBLICA: publica }, base);
    expect(bien.problemaExterno).toBeNull();
    expect(bien.externo?.carpeta).toBe(externa);
  });

  it("rechaza la clave privada puesta como pública, y la misma carpeta que las locales", () => {
    const externa = join(dir, "OneDrive");
    expect(leerConfiguracionRespaldos({ RESPALDO_CARPETA_EXTERNA: externa, RESPALDO_CLAVE_PUBLICA: privada }, base).problemaExterno).toMatch(
      /clave PRIVADA/,
    );
    expect(
      leerConfiguracionRespaldos(
        { RESPALDO_CARPETA_EXTERNA: externa, RESPALDO_CARPETA_LOCAL: externa, RESPALDO_CLAVE_PUBLICA: publica },
        base,
      ).problemaExterno,
    ).toMatch(/misma carpeta/);
  });
});

describe("Nombres de las copias", () => {
  it("llevan la hora UTC de la foto y se leen de vuelta", () => {
    const t = new Date("2026-09-26T09:00:05.123Z");
    expect(nombreCopia("LOCAL", t)).toBe("apurimeno-20260926T090005Z.db");
    expect(nombreCopia("EXTERNO", t)).toBe("apurimeno-20260926T090005Z.db.gz.cifrado");
    expect(fechaDeCopia("EXTERNO", nombreCopia("EXTERNO", t))?.toISOString()).toBe("2026-09-26T09:00:05.000Z");
    expect(fechaDeCopia("LOCAL", "apurimeno-20260926T090005Z.db.parcial")).toBeNull();
    expect(fechaDeCopia("LOCAL", "otra-cosa.db")).toBeNull();
  });
});

describe("Respaldos desde el servidor (Planos §14.3)", () => {
  let e: Entorno;
  const claves = generarClaves();
  let local: string;
  let externa: string;
  afterEach(() => e.cerrar());

  const configurar =
    (conExterna: boolean) =>
    (rutaBase: string): ConfiguracionRespaldos =>
      leerConfiguracionRespaldos(
        {
          RESPALDO_CARPETA_LOCAL: local,
          ...(conExterna ? { RESPALDO_CARPETA_EXTERNA: externa, RESPALDO_CLAVE_PUBLICA: claves.publica } : {}),
        },
        rutaBase,
      );

  /** Un ingreso cobrado: queda en el WAL, no todavía en el archivo principal de la base. */
  async function unIngreso(): Promise<string> {
    const cajero = await e.login("cajero");
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 10000 });
    const r = await e.llamar(
      "POST",
      RUTAS.registrarIngreso,
      cajero,
      { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
      "clave-ingreso-respaldo",
    );
    return RegistrarIngresoRespuestaSchema.parse(r.json()).ticket.creadoEn;
  }

  async function copiar(destino: "LOCAL" | "EXTERNO") {
    const admin = await e.login("admin");
    const r = await e.llamar("POST", RUTAS.respaldar, admin, { destino });
    return { status: r.statusCode, cuerpo: r.statusCode === 200 ? RespaldoRespuestaSchema.parse(r.json()) : r.json() };
  }

  beforeEach(() => {
    local = join(dir, "respaldos");
    externa = join(dir, "OneDrive-Respaldos");
  });

  it("la copia local es una base completa y verificada, con lo que todavía estaba en el WAL", async () => {
    e = await prepararEntorno("2026-09-26T15:00:00.000Z", { respaldos: configurar(false) });
    const creadoEn = await unIngreso();
    const { status, cuerpo } = await copiar("LOCAL");
    expect(status).toBe(200);
    expect(cuerpo.exito).toBe(true);
    expect(cuerpo.estado.local).toMatchObject({
      configurado: true,
      carpeta: local,
      ultimoExitoEn: "2026-09-26T15:00:00.000Z",
      ultimoArchivo: "apurimeno-20260926T150000Z.db",
      copiasGuardadas: 1,
      ultimoError: null,
    });
    const resumen = verificarBase(join(local, "apurimeno-20260926T150000Z.db"));
    expect(resumen).toMatchObject({ tickets: 1, ultimoTicketEn: creadoEn, alquileresAbiertos: 1, turnosAbiertos: 1 });
    expect(readdirSync(local)).toEqual(["apurimeno-20260926T150000Z.db"]);

    const auditoria = await e.prisma.registroAuditoria.findFirstOrThrow({ where: { accion: "RESPALDO_MANUAL" } });
    expect(auditoria).toMatchObject({ usuarioId: "usuario-admin", tipoEntidad: "RESPALDO" });
  });

  it("sin carpeta externa configurada, la externa responde 409 y el estado lo dice", async () => {
    e = await prepararEntorno("2026-09-26T15:00:00.000Z", { respaldos: configurar(false) });
    const { status, cuerpo } = await copiar("EXTERNO");
    expect(status).toBe(409);
    expect(cuerpo).toMatchObject({ codigo: "RESPALDO_NO_CONFIGURADO" });
    const admin = await e.login("admin");
    const estado = EstadoRespaldosSchema.parse((await e.llamar("GET", RUTAS.estadoRespaldos, admin)).json());
    expect(estado.externo).toMatchObject({ configurado: false, problemaConfiguracion: null, copiasGuardadas: 0 });
  });

  it("solo quien tiene settings.manage ve el estado o pide una copia", async () => {
    e = await prepararEntorno("2026-09-26T15:00:00.000Z", { respaldos: configurar(false) });
    const cajero = await e.login("cajero");
    expect((await e.llamar("GET", RUTAS.estadoRespaldos, cajero)).statusCode).toBe(403);
    expect((await e.llamar("POST", RUTAS.respaldar, cajero, { destino: "LOCAL" })).statusCode).toBe(403);
  });

  it("la copia externa sale cifrada: en la carpeta sincronizada no queda nada legible", async () => {
    e = await prepararEntorno("2026-09-26T15:00:00.000Z", { respaldos: configurar(true) });
    const { mkdirSync } = await import("node:fs");
    mkdirSync(externa);
    const creadoEn = await unIngreso();
    const { status, cuerpo } = await copiar("EXTERNO");
    expect(status).toBe(200);
    expect(cuerpo.exito).toBe(true);
    expect(readdirSync(externa)).toEqual(["apurimeno-20260926T150000Z.db.gz.cifrado"]);
    // La foto temporal sin cifrar ya no está en ninguna parte.
    expect(readdirSync(local)).toEqual([]);
    const archivo = join(externa, "apurimeno-20260926T150000Z.db.gz.cifrado");
    expect(readFileSync(archivo).includes(Buffer.from("SQLite format 3"))).toBe(false);

    await descifrarArchivo(archivo, join(dir, "abierta.db"), leerClavePrivada(claves.privada));
    expect(verificarBase(join(dir, "abierta.db"))).toMatchObject({ tickets: 1, ultimoTicketEn: creadoEn });
  });

  it("si la carpeta externa no está, la copia falla sin afectar al local y el estado lo muestra", async () => {
    e = await prepararEntorno("2026-09-26T15:00:00.000Z", { respaldos: configurar(true) });
    const { status, cuerpo } = await copiar("EXTERNO");
    expect(status).toBe(200);
    expect(cuerpo.exito).toBe(false);
    expect(cuerpo.estado.externo.ultimoError).toMatchObject({ codigo: "DESTINO_INACCESIBLE", ocurridoEn: "2026-09-26T15:00:00.000Z" });
    expect(cuerpo.estado.externo.ultimoExitoEn).toBeNull();
    expect(readdirSync(local)).toEqual([]);
    // El POS sigue cobrando.
    await unIngreso();
  });

  it("borra las copias que pasaron la retención: 24 h las locales, 30 días las externas", async () => {
    e = await prepararEntorno("2026-09-26T15:00:00.000Z", { respaldos: configurar(true) });
    const { mkdirSync } = await import("node:fs");
    mkdirSync(local);
    mkdirSync(externa);
    const viejas = {
      local: ["apurimeno-20260925T144500Z.db", "apurimeno-20260925T151500Z.db"],
      externa: ["apurimeno-20260826T090000Z.db.gz.cifrado", "apurimeno-20260828T090000Z.db.gz.cifrado"],
    };
    for (const n of viejas.local) writeFileSync(join(local, n), "x");
    for (const n of viejas.externa) writeFileSync(join(externa, n), "x");
    writeFileSync(join(externa, "notas-de-la-propietaria.txt"), "no es una copia");

    await copiar("LOCAL");
    await copiar("EXTERNO");
    expect(readdirSync(local).sort()).toEqual(["apurimeno-20260925T151500Z.db", "apurimeno-20260926T150000Z.db"]);
    expect(readdirSync(externa).sort()).toEqual([
      "apurimeno-20260828T090000Z.db.gz.cifrado",
      "apurimeno-20260926T150000Z.db.gz.cifrado",
      "notas-de-la-propietaria.txt",
    ]);
  });

  it("programa la externa al encender si falta la del día, y después para las 04:00 de Lima", async () => {
    e = await prepararEntorno("2026-09-26T15:00:00.000Z", { respaldos: configurar(true) });
    const { mkdirSync } = await import("node:fs");
    mkdirSync(externa);
    e.app.respaldos.iniciar();
    const admin = await e.login("admin");
    const leer = async () => EstadoRespaldosSchema.parse((await e.llamar("GET", RUTAS.estadoRespaldos, admin)).json());
    expect((await leer()).externo.proximaEn).toBe("2026-09-26T15:00:00.000Z");
    expect((await leer()).local.proximaEn).toBe("2026-09-26T15:00:00.000Z");
    await copiar("EXTERNO");
    await copiar("LOCAL");
    const estado = await leer();
    expect(estado.externo.proximaEn).toBe("2026-09-27T09:00:00.000Z"); // 04:00 de Lima
    expect(estado.local.proximaEn).toBe("2026-09-26T15:15:00.000Z");
    e.app.respaldos.detener();
  });
});

describe("Restauración completa (RNF-BKP-02)", () => {
  let e: Entorno;
  const claves = generarClaves();
  afterEach(() => e.cerrar());

  async function conDatos() {
    const local = join(dir, "respaldos");
    const externa = join(dir, "externa");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(externa);
    e = await prepararEntorno("2026-09-26T15:00:00.000Z", {
      respaldos: (rutaBase) =>
        leerConfiguracionRespaldos(
          { RESPALDO_CARPETA_LOCAL: local, RESPALDO_CARPETA_EXTERNA: externa, RESPALDO_CLAVE_PUBLICA: claves.publica },
          rutaBase,
        ),
    });
    const cajero = await e.login("cajero");
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 10000 });
    await e.llamar(
      "POST",
      RUTAS.registrarIngreso,
      cajero,
      { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
      "clave-restaurar-1",
    );
    expect(await e.app.respaldos.respaldar("LOCAL")).toBe(true);
    expect(await e.app.respaldos.respaldar("EXTERNO")).toBe(true);
    // Después de las copias: esto se pierde al restaurar.
    await e.llamar(
      "POST",
      RUTAS.registrarIngreso,
      cajero,
      { habitacionId: "hab-206", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
      "clave-restaurar-2",
    );
    await e.app.close();
    await e.prisma.$disconnect();
    return { local, externa };
  }

  const tickets = (ruta: string) => {
    const db = new Database(ruta, { readonly: true });
    try {
      return (db.prepare('select count(*) as n from "Ticket"').get() as { n: number }).n;
    } finally {
      db.close();
    }
  };

  it("desde la copia local: la base vuelve a ese momento y la anterior queda apartada", async () => {
    const { local } = await conDatos();
    expect(tickets(e.ruta)).toBe(2);
    const [copia] = await copiasDisponibles({ carpetaLocal: local, carpetaExternaConfigurada: null });
    const r = await restaurar(copia!.ruta, e.ruta, null, new Date("2026-09-26T16:00:00.000Z"));
    expect(r).toMatchObject({ tomadaEn: "2026-09-26T15:00:00.000Z", cifrada: false, resumen: { tickets: 1, alquileresAbiertos: 1 } });
    expect(tickets(e.ruta)).toBe(1);
    expect(existsSync(`${e.ruta}-wal`)).toBe(false);
    expect(r.baseAnteriorEn).not.toBeNull();
    expect(tickets(join(r.baseAnteriorEn!, "prueba.db"))).toBe(2);
  });

  it("desde la copia externa cifrada, con la clave privada", async () => {
    const { externa } = await conDatos();
    const disponibles = await copiasDisponibles({ carpetaLocal: join(dir, "disco-que-fallo"), carpetaExternaConfigurada: externa });
    expect(disponibles.map((c) => c.destino)).toEqual(["EXTERNO"]);
    const r = await restaurar(disponibles[0]!.ruta, e.ruta, claves.privada, new Date("2026-09-26T16:00:00.000Z"));
    expect(r).toMatchObject({ cifrada: true, resumen: { tickets: 1 } });
    expect(tickets(e.ruta)).toBe(1);
  });

  it("con la clave equivocada, o sin ella, no toca la base actual", async () => {
    const { externa } = await conDatos();
    const [copia] = await copiasDisponibles({ carpetaLocal: null, carpetaExternaConfigurada: externa });
    await expect(restaurar(copia!.ruta, e.ruta, generarClaves().privada, new Date())).rejects.toThrow(ErrorClave);
    await expect(restaurar(copia!.ruta, e.ruta, null, new Date())).rejects.toThrow(/clave privada/);
    expect(tickets(e.ruta)).toBe(2);
    expect(existsSync(`${e.ruta}.restaurando`)).toBe(false);
  });

  it("rechaza un archivo que no es una copia", async () => {
    await conDatos();
    writeFileSync(join(dir, "cualquier.db"), "no soy una base");
    await expect(restaurar(join(dir, "cualquier.db"), e.ruta, null, new Date())).rejects.toThrow(/no es una copia/);
    expect(tickets(e.ruta)).toBe(2);
  });
});
