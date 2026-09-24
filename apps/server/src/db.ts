import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { PrismaClient } from "./generated/prisma/client.js";

export { PrismaClient };
export type Transaccion = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

export function rutaDesdeUrl(url: string): string {
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

/**
 * Abre la base SQLite en modo WAL: lectores y el escritor no se bloquean entre sí, y un corte de energía
 * no corrompe el archivo. WAL queda grabado en el archivo, así que basta activarlo una vez al abrir.
 */
export function crearPrisma(url: string): PrismaClient {
  const ruta = rutaDesdeUrl(url);
  if (ruta !== ":memory:") {
    const db = new Database(ruta);
    try {
      db.pragma("journal_mode = WAL");
    } finally {
      db.close();
    }
  }
  const adapter = new PrismaBetterSqlite3({ url: ruta, timeout: 5_000 });
  return new PrismaClient({ adapter });
}
