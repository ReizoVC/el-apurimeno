import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { EstadoActualizacionSchema, RUTAS, type EstadoActualizacion } from "@apurimeno/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { leerConfiguracionActualizacion } from "../src/actualizacion/configuracion.js";
import type { OpcionesActualizacion } from "../src/actualizacion/control.js";
import {
  estaFueraDelRepositorio,
  firmaValida,
  firmarManifiesto,
  generarClavesVersion,
  leerClavePrivadaVersion,
  leerClavePublicaVersion,
} from "../src/actualizacion/firma.js";
import type { PublicacionEncontrada } from "../src/actualizacion/github.js";
import { ultimaVersionCompleta } from "../src/actualizacion/ultima-completa.js";
import { leerArranque } from "../src/instancia.js";
import { ErrorClave } from "../src/respaldo/cifrado.js";
import { prepararEntorno, type Entorno } from "./entorno.js";

const claves = generarClavesVersion();
const privada = leerClavePrivadaVersion(claves.privada);
const publica = leerClavePublicaVersion(claves.publica);

const manifiesto = (version: string, extra: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      version,
      commit: "a".repeat(40),
      instaladorPos: { nombre: `ElApurimeno-POS-${version}.msi`, sha256: "A".repeat(64) },
      notas: "Arreglos en la tienda",
      ultimaCompleta: "0.1.0",
      publicadaEn: "2026-11-06T12:00:00.000Z",
      ...extra,
    }),
    "utf8",
  );
const publicacion = (version: string, extra: Record<string, unknown> = {}): PublicacionEncontrada => {
  const bytes = manifiesto(version, extra);
  return { etiqueta: `v${version}`, manifiesto: bytes, firma: firmarManifiesto(bytes, privada) };
};

let e: Entorno | null = null;
afterEach(async () => {
  await e?.cerrar();
  e = null;
});

async function entorno(obtenerPublicacion: OpcionesActualizacion["obtenerPublicacion"], extra: Partial<OpcionesActualizacion> = {}) {
  e = await prepararEntorno(undefined, {
    actualizacion: { clavePublica: publica, versionInstalada: "0.3.0", problema: null, obtenerPublicacion, ...extra },
  });
  return e;
}
const estado = async (en: Entorno): Promise<EstadoActualizacion> => {
  const r = await en.llamar("GET", RUTAS.estadoActualizacion, await en.login("admin"));
  expect(r.statusCode).toBe(200);
  return EstadoActualizacionSchema.parse(r.json());
};
async function revisarCon(p: PublicacionEncontrada | null) {
  const en = await entorno(() => Promise.resolve(p));
  await en.app.actualizacion.revisar();
  return estado(en);
}

describe("Firma de versiones (decisión 30)", () => {
  it("una firma buena pasa; un byte cambiado, otra clave o basura no", () => {
    const bytes = manifiesto("0.4.0");
    const firma = firmarManifiesto(bytes, privada);
    expect(firmaValida(bytes, firma, publica)).toBe(true);
    expect(firmaValida(manifiesto("0.5.0"), firma, publica)).toBe(false);
    expect(firmaValida(bytes, firma, leerClavePublicaVersion(generarClavesVersion().publica))).toBe(false);
    expect(firmaValida(bytes, "no es una firma", publica)).toBe(false);
    expect(firmaValida(bytes, "", publica)).toBe(false);
  });

  it("una clave mal copiada se detecta, y una de respaldos no sirve", () => {
    expect(() => leerClavePublicaVersion(`${claves.publica.slice(0, -2)}xx`)).toThrow(ErrorClave);
    expect(() => leerClavePublicaVersion("apr-publica-abc")).toThrow(ErrorClave);
  });

  it("la clave privada no se acepta dentro del repositorio", () => {
    expect(estaFueraDelRepositorio(join(process.cwd(), "clave.txt"))).toBe(false);
    expect(estaFueraDelRepositorio(join(tmpdir(), "clave.txt"))).toBe(true);
  });
});

describe("Qué se ofrece al local (decisión 30)", () => {
  it("una versión posterior y firmada queda disponible", async () => {
    expect(await revisarCon(publicacion("0.4.0"))).toMatchObject({
      estado: "DISPONIBLE",
      instalada: "0.3.0",
      disponible: { version: "0.4.0", notas: "Arreglos en la tienda", completa: false },
      ultimaRevisionEn: expect.any(String),
    });
  });

  it("avisa si será completa", async () => {
    expect(await revisarCon(publicacion("0.4.0", { ultimaCompleta: "0.4.0" }))).toMatchObject({ disponible: { completa: true } });
  });

  it("la misma versión, una anterior o ninguna publicada: al día", async () => {
    expect((await revisarCon(publicacion("0.3.0"))).estado).toBe("AL_DIA");
    await e?.cerrar();
    expect((await revisarCon(publicacion("0.2.0"))).estado).toBe("AL_DIA");
    await e?.cerrar();
    expect(await revisarCon(null)).toMatchObject({ estado: "AL_DIA", disponible: null });
  });

  it.each([
    ["firma de otra clave", (() => {
      const bytes = manifiesto("0.4.0");
      return { etiqueta: "v0.4.0", manifiesto: bytes, firma: firmarManifiesto(bytes, leerClavePrivadaVersion(generarClavesVersion().privada)) };
    })()],
    ["manifiesto alterado", { ...publicacion("0.4.0"), manifiesto: manifiesto("0.9.0") }],
    ["sin firma", { ...publicacion("0.4.0"), firma: null }],
    ["sin manifiesto", { ...publicacion("0.4.0"), manifiesto: null }],
    ["etiqueta distinta de la versión firmada", { ...publicacion("0.4.0"), etiqueta: "v0.5.0" }],
    ["firmado pero con otro formato", (() => {
      const bytes = Buffer.from("{}", "utf8");
      return { etiqueta: "v0.4.0", manifiesto: bytes, firma: firmarManifiesto(bytes, privada) };
    })()],
  ])("no ofrece y alerta: %s", async (_caso, p) => {
    expect(await revisarCon(p)).toMatchObject({ estado: "FIRMA_INVALIDA", disponible: null });
  });

  it("un manifiesto con campos nuevos sigue siendo legible", async () => {
    expect((await revisarCon(publicacion("0.4.0", { campoFuturo: true }))).estado).toBe("DISPONIBLE");
  });

  it("sin internet conserva lo último, sin alerta", async () => {
    let conexion = true;
    const en = await entorno(() => (conexion ? Promise.resolve(publicacion("0.4.0")) : Promise.reject(new Error("sin internet"))));
    expect(await en.app.actualizacion.revisar()).toBe(true);
    const antes = await estado(en);
    conexion = false;
    en.reloj.avanzarMinutos(60);
    expect(await en.app.actualizacion.revisar()).toBe(false);
    expect(await estado(en)).toEqual(antes);
  });

  it("sin clave pública no consulta nada", async () => {
    let consultas = 0;
    const en = await entorno(() => {
      consultas++;
      return Promise.resolve(publicacion("0.4.0"));
    }, { clavePublica: null });
    expect(await en.app.actualizacion.revisar()).toBe(false);
    expect(consultas).toBe(0);
    expect(await estado(en)).toMatchObject({ estado: "SIN_CONFIGURAR", disponible: null });
  });
});

describe("Permiso y configuración (decisión 30)", () => {
  it("exige system.update: el Administrador lo tiene; Cajero y Limpieza, no", async () => {
    const en = await prepararEntorno();
    e = en;
    expect((await en.llamar("GET", RUTAS.estadoActualizacion, await en.login("admin"))).statusCode).toBe(200);
    expect((await en.llamar("GET", RUTAS.estadoActualizacion, await en.login("cajero"))).statusCode).toBe(403);
    expect((await en.llamar("GET", RUTAS.estadoActualizacion, await en.login("limpieza"))).statusCode).toBe(403);
    expect((await en.llamar("GET", RUTAS.estadoActualizacion, null)).statusCode).toBe(401);
  });

  it("la instancia de capacitación nunca revisa, aunque el .env traiga la clave", () => {
    const env = { ACTUALIZACION_CLAVE_PUBLICA: claves.publica };
    expect(leerArranque(env, "CAPACITACION").actualizacion.clavePublica).toBeNull();
    expect(leerArranque(env, "PRODUCCION").actualizacion.clavePublica).not.toBeNull();
  });

  it("sin clave queda apagada y sin problema; mal copiada, lo informa", () => {
    expect(leerConfiguracionActualizacion({})).toMatchObject({ clavePublica: null, problema: null });
    expect(leerConfiguracionActualizacion({ ACTUALIZACION_CLAVE_PUBLICA: "basura" })).toMatchObject({
      clavePublica: null,
      problema: expect.stringContaining("ACTUALIZACION_CLAVE_PUBLICA"),
    });
  });

  it("la migración da el permiso al Administrador de una base existente, y a nadie más", async () => {
    const en = await prepararEntorno();
    e = en;
    await en.prisma.rangoPermiso.delete({ where: { rangoId_permiso: { rangoId: "rango-administrador", permiso: "system.update" } } });
    const db = new Database(en.ruta);
    const sql = readFileSync(new URL("../prisma/migrations/20261106120000_permiso_actualizar_sistema/migration.sql", import.meta.url), "utf8");
    db.exec(sql);
    db.close();
    const conPermiso = await en.prisma.rangoPermiso.findMany({ where: { permiso: "system.update" } });
    expect(conPermiso.map((r) => r.rangoId)).toEqual(["rango-administrador"]);
  });
});

describe("Última versión completa (decisión 30)", () => {
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "apurimeno-git-"));
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@ejemplo.test", ...a], { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    const commit = (archivo: string, etiqueta?: string) => {
      mkdirSync(dirname(join(dir, archivo)), { recursive: true });
      writeFileSync(join(dir, archivo), Math.random().toString());
      git("add", "-A");
      git("commit", "-q", "-m", archivo);
      if (etiqueta !== undefined) git("tag", etiqueta);
    };
    return { dir, commit };
  };

  it("la primera versión publicada cuenta como completa", () => {
    const { dir, commit } = repo();
    try {
      commit("a.txt");
      expect(ultimaVersionCompleta(dir, "0.2.0")).toBe("0.2.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("la propia versión, si trae una migración desde la anterior", () => {
    const { dir, commit } = repo();
    try {
      commit("a.txt", "v0.2.0");
      commit("apps/server/prisma/migrations/x/migration.sql");
      expect(ultimaVersionCompleta(dir, "0.3.0")).toBe("0.3.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("si no trae nada, la última que sí lo hizo, comparando números de versión", () => {
    const { dir, commit } = repo();
    try {
      commit("a.txt", "v0.9.0");
      commit("pnpm-lock.yaml", "v0.10.0");
      commit("b.txt", "v0.11.0");
      commit("c.txt");
      expect(ultimaVersionCompleta(dir, "0.12.0")).toBe("0.10.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("firmar-version (decisión 30)", () => {
  it("deja un manifiesto y una firma que el servidor acepta; sin clave no firma", () => {
    const dir = mkdtempSync(join(tmpdir(), "apurimeno-firma-"));
    try {
      const rutaClave = join(dir, "clave.txt");
      writeFileSync(rutaClave, `${claves.privada}\n`);
      const rutaBorrador = join(dir, "borrador.json");
      writeFileSync(
        rutaBorrador,
        JSON.stringify({
          version: "0.4.0",
          commit: "b".repeat(40),
          instaladorPos: { nombre: "ElApurimeno-POS-0.4.0.msi", sha256: "B".repeat(64) },
          notas: "Nota con ñ y acentos: habitación",
        }),
      );
      const tsx = [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), join("src", "scripts", "firmar-version.ts"), rutaBorrador];
      const salida = execFileSync(process.execPath, tsx, { encoding: "utf8", env: { ...process.env, ACTUALIZACION_CLAVE_PRIVADA_ARCHIVO: rutaClave } });
      const [rutaManifiesto, rutaFirma] = salida.trim().split(/\r?\n/);
      const bytes = readFileSync(rutaManifiesto!);
      expect(firmaValida(bytes, readFileSync(rutaFirma!, "utf8"), publica)).toBe(true);
      expect(JSON.parse(bytes.toString("utf8"))).toMatchObject({ version: "0.4.0", notas: "Nota con ñ y acentos: habitación", publicadaEn: expect.any(String) });

      expect(() =>
        execFileSync(process.execPath, tsx, { stdio: "pipe", env: { ...process.env, ACTUALIZACION_CLAVE_PRIVADA_ARCHIVO: "" } }),
      ).toThrow(/ACTUALIZACION_CLAVE_PRIVADA_ARCHIVO/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
