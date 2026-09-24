import { crearPrisma } from "../db.js";
import { sembrar } from "../semilla.js";

const contrasena = process.env["SEED_ADMIN_PASSWORD"];
if (contrasena === undefined || contrasena.length < 8) {
  throw new Error("Defina SEED_ADMIN_PASSWORD (al menos 8 caracteres) para crear el usuario administrador.");
}

const prisma = crearPrisma(process.env["DATABASE_URL"] ?? "file:./datos/apurimeno.db");
await sembrar(prisma, { admin: { nombreUsuario: process.env["SEED_ADMIN_USER"] ?? "admin", contrasena } });
await prisma.$disconnect();
console.log("Datos iniciales cargados.");
