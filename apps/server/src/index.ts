import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { construirApp } from "./app.js";
import { leerOrigenesPermitidos } from "./cors.js";
import { transporteArchivo } from "./impresion/transporte.js";
import { crearPrisma } from "./db.js";
import { leerConfiguracionEspejo } from "./espejo/configuracion.js";
import { transporteSupabase } from "./espejo/supabase.js";

const produccion = process.env["NODE_ENV"] === "production";
const url = process.env["DATABASE_URL"] ?? "file:./datos/apurimeno.db";

// Vacío es lo mismo que sin definir: así se puede copiar .env.example tal cual.
let jwtSecret = process.env["JWT_SECRET"] || undefined;
if (jwtSecret === undefined) {
  if (produccion) throw new Error("JWT_SECRET es obligatorio en producción (al menos 32 caracteres).");
  // En desarrollo, un secreto por arranque: las sesiones se invalidan al reiniciar.
  jwtSecret = randomBytes(32).toString("hex");
}

const prisma = crearPrisma(url);
const origenesPermitidos = leerOrigenesPermitidos(process.env["CORS_ORIGINS"], produccion);
const dispositivo = process.env["IMPRESORA_DISPOSITIVO"];
const paginaCodigos = process.env["IMPRESORA_PAGINA_CODIGOS"] === "WPC1252" ? "WPC1252" : "PC850";
const impresora = dispositivo === undefined || dispositivo === "" ? null : transporteArchivo(dispositivo);
const configuracionEspejo = leerConfiguracionEspejo(process.env);
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const espejo = {
  transporte: configuracionEspejo.supabase === null ? null : transporteSupabase(configuracionEspejo.supabase),
  problemaConfiguracion: configuracionEspejo.problema,
  intervaloMinutos: configuracionEspejo.intervaloMinutos,
  versionServidor: version,
};
const app = await construirApp({ prisma, jwtSecret, logger: true, origenesPermitidos, impresora, paginaCodigos, espejo });
app.log.info({ impresora: impresora?.descripcion ?? "sin configurar", paginaCodigos }, "Impresora de comprobantes");
app.log.info({ origenesPermitidos }, "Orígenes permitidos (CORS)");
if (espejo.transporte !== null) {
  app.log.info({ destino: espejo.transporte.descripcion, intervaloMinutos: espejo.intervaloMinutos }, "Espejo en la nube");
} else if (espejo.problemaConfiguracion !== null) {
  app.log.error(`Espejo en la nube apagado: ${espejo.problemaConfiguracion}`);
} else {
  app.log.info("Espejo en la nube sin configurar (variables ESPEJO_*): el servidor funciona igual, sin sincronizar.");
}

const cerrar = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);

// 0.0.0.0: el POS, el Dashboard y la app de limpieza se conectan desde la red local (RES-04).
await app.listen({ host: process.env["HOST"] ?? "0.0.0.0", port: Number(process.env["PORT"] ?? 3001) });
app.espejo.iniciar();
