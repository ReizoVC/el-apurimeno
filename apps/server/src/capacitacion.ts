import { COSTO_BCRYPT, hashContrasena } from "./auth.js";
import type { PrismaClient } from "./db.js";
import { ID_RANGO, sembrar } from "./semilla.js";

// Datos de la instancia de capacitación (instancia.ts): tres cuentas fijas y un juego de habitaciones y productos de
// ejemplo. Nada de esto va nunca a la base de producción: los scripts que lo usan abren solo BASE_CAPACITACION.

/** Prefijo de las cuentas de capacitación: las apps lo miran en el login para conectarse a esta instancia. */
export const PREFIJO_CAPACITACION = "capacitacion.";

export const CUENTAS_CAPACITACION = [
  { nombreUsuario: "capacitacion.admin", rangoId: ID_RANGO.ADMINISTRADOR },
  { nombreUsuario: "capacitacion.cajero1", rangoId: ID_RANGO.CAJERO },
  { nombreUsuario: "capacitacion.cajero2", rangoId: ID_RANGO.CAJERO },
] as const;

const NOMBRES_CUENTAS: string[] = CUENTAS_CAPACITACION.map((c) => c.nombreUsuario);

// Productos de ejemplo. Los códigos de barras usan el prefijo 20, que GS1 reserva para uso interno: no coinciden
// con los de productos reales.
const CATEGORIAS = [
  { id: "cap-cat-bebidas", nombre: "Bebidas" },
  { id: "cap-cat-snacks", nombre: "Snacks" },
  { id: "cap-cat-higiene", nombre: "Higiene" },
];
const PRODUCTOS: [id: string, categoriaId: string, nombre: string, codigo: string, huesped: number, publico: number, stock: number][] = [
  ["cap-prod-gaseosa", "cap-cat-bebidas", "Gaseosa 500 ml", "2000000000011", 300, 350, 48],
  ["cap-prod-agua", "cap-cat-bebidas", "Agua 625 ml", "2000000000028", 200, 250, 48],
  ["cap-prod-cerveza", "cap-cat-bebidas", "Cerveza lata 355 ml", "2000000000035", 600, 700, 24],
  ["cap-prod-energizante", "cap-cat-bebidas", "Bebida energizante", "2000000000042", 500, 600, 12],
  ["cap-prod-papas", "cap-cat-snacks", "Papas fritas 45 g", "2000000000059", 250, 300, 30],
  ["cap-prod-galletas", "cap-cat-snacks", "Galletas", "2000000000066", 150, 200, 30],
  ["cap-prod-preservativos", "cap-cat-higiene", "Preservativos x3", "2000000000073", 800, 1000, 20],
  ["cap-prod-cepillo", "cap-cat-higiene", "Cepillo de dientes", "2000000000080", 300, 400, 10],
];

/** Habitaciones (las 17 de la semilla) y productos de ejemplo. Supone que no hay ninguno cargado. */
async function cargarEjemplos(prisma: PrismaClient): Promise<void> {
  for (const categoria of CATEGORIAS) await prisma.categoriaProducto.create({ data: categoria });
  for (const [id, categoriaId, nombre, codigoBarras, precioHuesped, precioPublico, stock] of PRODUCTOS) {
    await prisma.producto.create({
      data: { id, categoriaId, nombre, codigoBarras, precioHuesped, precioPublico, controlaStock: true, stock, activo: true },
    });
  }
}

/**
 * Prepara una base de capacitación nueva (ya migrada): configuración, rangos, habitaciones, las tres cuentas con
 * `contrasena` y los productos de ejemplo. Es idempotente: no cambia la contraseña de una cuenta que ya existe.
 */
export async function prepararCapacitacion(prisma: PrismaClient, contrasena: string, costoBcrypt = COSTO_BCRYPT): Promise<void> {
  const [admin, ...resto] = CUENTAS_CAPACITACION;
  await sembrar(prisma, { admin: { nombreUsuario: admin.nombreUsuario, contrasena }, costoBcrypt });
  for (const { nombreUsuario, rangoId } of resto) {
    if ((await prisma.usuario.findUnique({ where: { nombreUsuario } })) !== null) continue;
    await prisma.usuario.create({
      data: {
        id: `usuario-${nombreUsuario}`,
        nombreUsuario,
        activo: true,
        contrasenaHash: await hashContrasena(contrasena, costoBcrypt),
        rangos: { create: { rangoId } },
      },
    });
  }
  if ((await prisma.producto.count()) === 0 && (await prisma.categoriaProducto.count()) === 0) await cargarEjemplos(prisma);
}

export class ErrorCapacitacion extends Error {
  override name = "ErrorCapacitacion";
}

export interface ResultadoReinicio {
  borrados: Record<string, number>;
}

/**
 * Deja la base de capacitación como recién preparada: borra todo lo operativo (alquileres, tickets, pagos, turnos,
 * movimientos de caja e inventario, códigos, trabajos de impresión, auditoría), los clientes, las cuentas creadas al
 * practicar y el estado del espejo; vuelve a cargar las habitaciones y los productos de ejemplo. No toca las tres
 * cuentas (ni su contraseña, ni sus rangos), la configuración, los métodos de pago ni los rangos.
 *
 * Se niega a correr si la base no tiene las tres cuentas de capacitación: así nunca vacía otra base por error.
 */
export async function reiniciarCapacitacion(prisma: PrismaClient): Promise<ResultadoReinicio> {
  const cuentas = await prisma.usuario.findMany({ where: { nombreUsuario: { in: NOMBRES_CUENTAS } } });
  if (cuentas.length !== NOMBRES_CUENTAS.length) {
    throw new ErrorCapacitacion(
      "Esta base no tiene las tres cuentas de capacitación: no se reinicia. ¿Se corrió antes `pnpm preparar-capacitacion`?",
    );
  }
  const idsCuentas = cuentas.map((c) => c.id);
  const borrados: Record<string, number> = {};
  const contar = (tabla: string, r: { count: number }) => {
    borrados[tabla] = (borrados[tabla] ?? 0) + r.count;
  };

  await prisma.$transaction(async (tx) => {
    // En orden, de lo que depende de otro a lo que no depende de nada.
    contar("TrabajoImpresion", await tx.trabajoImpresion.deleteMany());
    contar("Pago", await tx.pago.deleteMany());
    contar("LineaTicket", await tx.lineaTicket.deleteMany());
    contar("MovimientoInventario", await tx.movimientoInventario.deleteMany());
    contar("CodigoAutorizacion", await tx.codigoAutorizacion.deleteMany());
    contar("HoraAdicional", await tx.horaAdicional.deleteMany());
    // Los compensatorios apuntan al ticket que anulan: primero ellos.
    contar("Ticket", await tx.ticket.deleteMany({ where: { ticketOriginalId: { not: null } } }));
    contar("Ticket", await tx.ticket.deleteMany());
    contar("Alquiler", await tx.alquiler.deleteMany());
    contar("MovimientoCaja", await tx.movimientoCaja.deleteMany());
    contar("Turno", await tx.turno.deleteMany());
    contar("RegistroAuditoria", await tx.registroAuditoria.deleteMany());
    contar("PrecioEspecialCliente", await tx.precioEspecialCliente.deleteMany());
    contar("Cliente", await tx.cliente.deleteMany());
    contar("Producto", await tx.producto.deleteMany());
    contar("CategoriaProducto", await tx.categoriaProducto.deleteMany());
    contar("Habitacion", await tx.habitacion.deleteMany());
    contar("EstadoEspejo", await tx.estadoEspejo.deleteMany());
    await tx.usuarioRango.deleteMany({ where: { usuarioId: { notIn: idsCuentas } } });
    contar("Usuario (creadas al practicar)", await tx.usuario.deleteMany({ where: { id: { notIn: idsCuentas } } }));
  });

  // Habitaciones de la semilla (sembrar no toca lo que ya existe: configuración, rangos, métodos y cuentas).
  await sembrar(prisma, { admin: { nombreUsuario: CUENTAS_CAPACITACION[0].nombreUsuario, contrasena: "no-se-usa-la-cuenta-ya-existe" } });
  await cargarEjemplos(prisma);
  return { borrados };
}
