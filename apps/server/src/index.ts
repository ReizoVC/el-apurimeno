import { randomBytes } from "node:crypto";
import { construirApp } from "./app.js";
import { leerOrigenesPermitidos } from "./cors.js";
import { transporteArchivo } from "./impresion/transporte.js";
import { crearPrisma } from "./db.js";

const produccion = process.env["NODE_ENV"] === "production";
const url = process.env["DATABASE_URL"] ?? "file:./datos/apurimeno.db";

let jwtSecret = process.env["JWT_SECRET"];
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
const app = await construirApp({ prisma, jwtSecret, logger: true, origenesPermitidos, impresora, paginaCodigos });
app.log.info({ impresora: impresora?.descripcion ?? "sin configurar", paginaCodigos }, "Impresora de comprobantes");
app.log.info({ origenesPermitidos }, "Orígenes permitidos (CORS)");

const cerrar = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);

// 0.0.0.0: el POS, el Dashboard y la app de limpieza se conectan desde la red local (RES-04).
await app.listen({ host: process.env["HOST"] ?? "0.0.0.0", port: Number(process.env["PORT"] ?? 3001) });
