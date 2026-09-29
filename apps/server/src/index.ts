import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { construirApp } from "./app.js";
import { leerOrigenesPermitidos } from "./cors.js";
import { transporteArchivo } from "./impresion/transporte.js";
import { crearPrisma } from "./db.js";
import { transporteSupabase } from "./espejo/supabase.js";
import { instanciaDe, leerArranque } from "./instancia.js";
import { registroRotativo } from "./registro.js";

// `--capacitacion` arranca la instancia de capacitación (ver instancia.ts); sin él, la de producción.
const arranque = leerArranque(process.env, instanciaDe(process.argv.slice(2)));
const capacitacion = arranque.instancia === "CAPACITACION";
const { produccion } = arranque;

// Vacío es lo mismo que sin definir: así se puede copiar .env.example tal cual.
let jwtSecret = arranque.jwtSecret;
if (jwtSecret === undefined) {
  if (produccion && !capacitacion) throw new Error("JWT_SECRET es obligatorio en producción (al menos 32 caracteres).");
  // En desarrollo (y en capacitación, que nunca usa el de producción), un secreto por arranque: las sesiones se
  // invalidan al reiniciar.
  jwtSecret = randomBytes(32).toString("hex");
}

const prisma = crearPrisma(arranque.databaseUrl);
const origenesPermitidos = leerOrigenesPermitidos(arranque.corsOrigins, produccion);
const dispositivo = arranque.impresoraDispositivo;
const paginaCodigos = arranque.impresoraPaginaCodigos === "WPC1252" ? "WPC1252" : "PC850";
const impresora = dispositivo === undefined || dispositivo === "" ? null : transporteArchivo(dispositivo);
const configuracionEspejo = arranque.espejo;
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const espejo = {
  transporte: configuracionEspejo.supabase === null ? null : transporteSupabase(configuracionEspejo.supabase),
  problemaConfiguracion: configuracionEspejo.problema,
  intervaloMinutos: configuracionEspejo.intervaloMinutos,
  versionServidor: version,
};
const respaldos = arranque.respaldos;
// El servicio de Windows fija REGISTRO_ARCHIVO: el registro va a ese archivo y rota por tamaño. Sin ella, a la consola.
const archivoRegistro = process.env["REGISTRO_ARCHIVO"] || undefined;
const logger = archivoRegistro === undefined ? true : { stream: registroRotativo(archivoRegistro) };
const app = await construirApp({ prisma, jwtSecret, logger, origenesPermitidos, impresora, paginaCodigos, espejo, respaldos, capacitacion });
if (capacitacion) {
  app.log.warn({ base: respaldos.rutaBase, puerto: arranque.puerto }, "INSTANCIA DE CAPACITACIÓN: ningún dato de esta base es real");
}
app.log.info({ impresora: impresora?.descripcion ?? "sin configurar", paginaCodigos }, "Impresora de comprobantes");
app.log.info({ origenesPermitidos }, "Orígenes permitidos (CORS)");
if (espejo.transporte !== null) {
  app.log.info({ destino: espejo.transporte.descripcion, intervaloMinutos: espejo.intervaloMinutos }, "Espejo en la nube");
} else if (espejo.problemaConfiguracion !== null) {
  if (capacitacion) app.log.info(espejo.problemaConfiguracion);
  else app.log.error(`Espejo en la nube apagado: ${espejo.problemaConfiguracion}`);
} else {
  app.log.info("Espejo en la nube sin configurar (variables ESPEJO_*): el servidor funciona igual, sin sincronizar.");
}

app.log.info({ carpeta: respaldos.carpetaLocal }, "Respaldo local cada 15 minutos");
if (respaldos.externo !== null) {
  app.log.info({ carpeta: respaldos.externo.carpeta }, "Respaldo externo cifrado, diario a las 04:00 de Lima");
} else if (respaldos.problemaExterno !== null) {
  app.log.error(`Respaldo externo apagado: ${respaldos.problemaExterno}`);
} else if (capacitacion) {
  app.log.info("Instancia de capacitación: sin respaldo externo; solo copias locales junto a su base.");
} else {
  app.log.warn("Respaldo externo sin configurar (RESPALDO_CARPETA_EXTERNA y RESPALDO_CLAVE_PUBLICA): solo hay copias en este equipo.");
}

const cerrar = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);

// 0.0.0.0: el POS, el Dashboard y la app de limpieza se conectan desde la red local (RES-04).
await app.listen({ host: arranque.host, port: arranque.puerto });
app.espejo.iniciar();
app.respaldos.iniciar();
