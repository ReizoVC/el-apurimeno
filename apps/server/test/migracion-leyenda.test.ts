import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { aConfiguracion } from "../src/mapeo.js";

const MIGRACIONES = fileURLToPath(new URL("../prisma/migrations", import.meta.url));
const carpetas = readdirSync(MIGRACIONES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const LEYENDA = carpetas.find((c) => c.endsWith("_leyenda_comprobante_configurable"));
const aplicar = (db: Database.Database, carpeta: string) => db.exec(readFileSync(join(MIGRACIONES, carpeta, "migration.sql"), "utf8"));

let dir: string | null = null;
afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

/** Una base migrada hasta la versión anterior, con la configuración tal como la dejaba la semilla de entonces. */
function baseAnterior(comprobante: object): Database.Database {
  dir = mkdtempSync(join(tmpdir(), "migracion-"));
  const db = new Database(join(dir, "anterior.db"));
  for (const carpeta of carpetas.filter((c) => LEYENDA !== undefined && c < LEYENDA)) aplicar(db, carpeta);
  db.prepare(
    `INSERT INTO "ConfiguracionGlobal" ("id", "parametrosAlquiler", "comprobante", "impresora", "permitirStockNegativo", "minutosVigenciaCodigoAutorizacion")
     VALUES (1, ?, ?, ?, 0, 5)`,
  ).run(
    JSON.stringify({ horasBase: 8, minutosAviso: 10, minutosCortesia: 15, precioHoraAdicional: 800 }),
    JSON.stringify(comprobante),
    JSON.stringify({ anchoPapelMm: 80, conexion: "USB" }),
  );
  return db;
}

function leer(db: Database.Database) {
  const fila = db.prepare(`SELECT * FROM "ConfiguracionGlobal" WHERE id = 1`).get() as Record<string, unknown>;
  const json = (c: string) => JSON.parse(String(fila[c])) as unknown;
  return aConfiguracion({
    id: 1,
    parametrosAlquiler: json("parametrosAlquiler"),
    comprobante: json("comprobante"),
    impresora: json("impresora"),
    permitirStockNegativo: fila["permitirStockNegativo"] === 1,
    minutosVigenciaCodigoAutorizacion: Number(fila["minutosVigenciaCodigoAutorizacion"]),
  } as never);
}

describe("Migración: leyenda del comprobante configurable (decisión 21)", () => {
  it("la migración existe", () => {
    expect(LEYENDA).toBeDefined();
  });

  it("la configuración de la semilla anterior recibe la leyenda y deja de repetirla como dato adicional", () => {
    const db = baseAnterior({ nombreNegocio: "El Apurimeño", datosAdicionales: "Documento interno sin valor tributario" });
    expect(() => leer(db)).toThrow(); // Antes de migrar, el contrato nuevo la rechaza: le falta la leyenda.
    aplicar(db, LEYENDA ?? "");
    expect(leer(db).comprobante).toEqual({
      nombreNegocio: "El Apurimeño",
      datosAdicionales: "Gracias por su preferencia.",
      leyenda: "Documento interno sin valor tributario.",
    });
    db.close();
  });

  it("un dato adicional que ya se había personalizado no se toca", () => {
    const db = baseAnterior({ nombreNegocio: "Hospedaje El Apurimeño", datosAdicionales: "Jr. Lima 123, Andahuaylas" });
    aplicar(db, LEYENDA ?? "");
    expect(leer(db).comprobante).toEqual({
      nombreNegocio: "Hospedaje El Apurimeño",
      datosAdicionales: "Jr. Lima 123, Andahuaylas",
      leyenda: "Documento interno sin valor tributario.",
    });
    db.close();
  });
});
