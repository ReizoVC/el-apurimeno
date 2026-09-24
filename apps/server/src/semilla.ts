import {
  ConfiguracionGlobalSchema,
  PARAMETROS_TIEMPO_PRECIO_INICIALES,
  RANGOS_INICIALES,
} from "@apurimeno/contracts";
import { COSTO_BCRYPT, hashContrasena } from "./auth.js";
import type { PrismaClient } from "./db.js";

// Habitaciones reales del negocio (SRS anexo §41.1).
const HABITACIONES: [numero: string, precio: number, descripcion: string][] = [
  ["101", 2500, "Sin baño propio"],
  ["102", 2500, "Sin baño propio"],
  ["103", 2500, "Sin baño propio"],
  ["104", 2500, "Sin baño propio"],
  ["105", 4000, "Grande, con baño propio"],
  ["106", 4000, "Grande, con baño propio"],
  ["107", 3000, "Con baño propio"],
  ["201", 2500, "Sin baño propio"],
  ["202", 3000, "Con baño propio"],
  ["203", 2500, "Sin baño propio"],
  ["204", 2500, "Sin baño propio"],
  ["205", 4000, "Grande, con baño propio"],
  ["206", 4000, "Grande, con baño propio"],
  ["301", 3000, "Con baño propio"],
  ["302", 2500, "Sin baño propio"],
  ["303", 3000, "Con baño propio"],
  ["304", 3000, "Con baño propio"],
];

// Planos §19.3. Transferencia queda creada pero inactiva (P-04).
const METODOS_PAGO = [
  { id: "metodo-efectivo", nombre: "Efectivo", afectaCaja: true, requiereReferencia: false, activo: true },
  { id: "metodo-yape", nombre: "Yape", afectaCaja: false, requiereReferencia: false, activo: true },
  { id: "metodo-plin", nombre: "Plin", afectaCaja: false, requiereReferencia: false, activo: true },
  { id: "metodo-transferencia", nombre: "Transferencia", afectaCaja: false, requiereReferencia: true, activo: false },
];

export const ID_RANGO = {
  ADMINISTRADOR: "rango-administrador",
  CAJERO: "rango-cajero",
  LIMPIEZA: "rango-limpieza",
} as const;

const CONFIGURACION = ConfiguracionGlobalSchema.parse({
  parametrosAlquiler: PARAMETROS_TIEMPO_PRECIO_INICIALES,
  comprobante: { nombreNegocio: "El Apurimeño", datosAdicionales: "Documento interno sin valor tributario" },
  impresora: { anchoPapelMm: 80, conexion: "USB" },
  permitirStockNegativo: false,
  // RF-65 pide "algunos minutos" sin fijar un valor: 5 es un valor inicial ajustable desde la configuración.
  minutosVigenciaCodigoAutorizacion: 5,
});

export interface OpcionesSemilla {
  admin: { nombreUsuario: string; contrasena: string };
  costoBcrypt?: number;
}

/** Carga los datos iniciales. Es idempotente: volver a ejecutarla no duplica ni pisa datos existentes. */
export async function sembrar(prisma: PrismaClient, opciones: OpcionesSemilla): Promise<void> {
  await prisma.configuracionGlobal.upsert({ where: { id: 1 }, create: { id: 1, ...CONFIGURACION }, update: {} });

  for (const metodo of METODOS_PAGO) {
    await prisma.metodoPago.upsert({ where: { id: metodo.id }, create: metodo, update: {} });
  }

  for (const [clave, id] of Object.entries(ID_RANGO) as [keyof typeof ID_RANGO, string][]) {
    const { nombre, permisos } = RANGOS_INICIALES[clave];
    await prisma.rango.upsert({
      where: { id },
      create: { id, nombre, permisos: { create: permisos.map((permiso) => ({ permiso })) } },
      update: {},
    });
  }

  for (const [numero, precioBase, descripcion] of HABITACIONES) {
    await prisma.habitacion.upsert({
      where: { numero },
      create: { id: `hab-${numero}`, numero, precioBase, descripcion, estado: "LIBRE" },
      update: {},
    });
  }

  const { nombreUsuario, contrasena } = opciones.admin;
  if ((await prisma.usuario.findUnique({ where: { nombreUsuario } })) === null) {
    await prisma.usuario.create({
      data: {
        id: `usuario-${nombreUsuario}`,
        nombreUsuario,
        activo: true,
        contrasenaHash: await hashContrasena(contrasena, opciones.costoBcrypt ?? COSTO_BCRYPT),
        rangos: { create: { rangoId: ID_RANGO.ADMINISTRADOR } },
      },
    });
  }
}
