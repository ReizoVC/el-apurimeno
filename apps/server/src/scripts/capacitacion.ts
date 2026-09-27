import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prepararCapacitacion, reiniciarCapacitacion, ErrorCapacitacion, CUENTAS_CAPACITACION } from "../capacitacion.js";
import { crearPrisma } from "../db.js";
import { BASE_CAPACITACION } from "../instancia.js";
import { preguntar } from "./entrada.js";

// Base de la instancia de capacitación (docs/INSTALACION_LOCAL.md, "Entorno de capacitación"):
//   pnpm preparar-capacitacion    crea la base, aplica las migraciones y crea las tres cuentas (pide su contraseña)
//   pnpm reiniciar-capacitacion   borra todo lo operativo y vuelve a cargar los ejemplos; las cuentas quedan
// Siempre trabaja sobre BASE_CAPACITACION: no lee DATABASE_URL, así que no puede tocar la base de producción.

const DIR_SERVIDOR = fileURLToPath(new URL("../..", import.meta.url));
const url = `file:${BASE_CAPACITACION.replace(/\\/g, "/")}`;
const accion = process.argv[2];

function fallar(mensaje: string): never {
  console.error(`\n${mensaje}`);
  process.exit(1);
}

function migrar(): void {
  mkdirSync(dirname(BASE_CAPACITACION), { recursive: true });
  const r = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: DIR_SERVIDOR,
    env: { ...process.env, DATABASE_URL: url },
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    fallar("No se pudieron aplicar las migraciones a la base de capacitación.");
  }
}

if (accion === "preparar") {
  migrar();
  let contrasena = process.env["CAPACITACION_CONTRASENA"] ?? "";
  if (contrasena === "") {
    contrasena = await preguntar(`Contraseña para ${CUENTAS_CAPACITACION.map((c) => c.nombreUsuario).join(", ")} (no se muestra): `, true);
    if (contrasena !== (await preguntar("Repítala: ", true))) fallar("Las contraseñas no coinciden: no se creó nada.");
  }
  if (contrasena.length < 8) fallar("La contraseña debe tener al menos 8 caracteres: no se creó nada.");
  const prisma = crearPrisma(url);
  try {
    await prepararCapacitacion(prisma, contrasena);
  } finally {
    await prisma.$disconnect();
  }
  console.log(`Base de capacitación lista en ${BASE_CAPACITACION}.
Cuentas: ${CUENTAS_CAPACITACION.map((c) => c.nombreUsuario).join(", ")} (si ya existían, conservan su contraseña).`);
} else if (accion === "reiniciar") {
  if (!existsSync(BASE_CAPACITACION)) fallar("No existe la base de capacitación: corra antes `pnpm preparar-capacitacion`.");
  migrar();
  const prisma = crearPrisma(url);
  try {
    const { borrados } = await reiniciarCapacitacion(prisma);
    const detalle = Object.entries(borrados)
      .filter(([, n]) => n > 0)
      .map(([tabla, n]) => `  ${tabla}: ${n}`)
      .join("\n");
    console.log(`Capacitación reiniciada: ${BASE_CAPACITACION}
Borrado:
${detalle === "" ? "  (no había nada que borrar)" : detalle}
Cargado de nuevo: 17 habitaciones libres y los productos de ejemplo. Las tres cuentas quedaron como estaban.`);
  } catch (error) {
    if (error instanceof ErrorCapacitacion) fallar(error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
} else {
  fallar("Uso: tsx src/scripts/capacitacion.ts preparar|reiniciar");
}
