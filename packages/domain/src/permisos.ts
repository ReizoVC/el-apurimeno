import type { Id, OrigenTicket, Permiso, Rango, Usuario } from "@apurimeno/contracts";
import { ErrorNegocio } from "./errores.js";

/**
 * Permisos efectivos de un usuario: la unión de los permisos de sus rangos (RN-41).
 * Un usuario desactivado no tiene ninguno (RF-45). El código comprueba permisos, nunca nombres de rango.
 */
export function permisosEfectivos(usuario: Usuario, rangos: readonly Rango[]): Permiso[] {
  if (!usuario.activo) return [];
  const porId = new Map(rangos.map((r) => [r.id, r]));
  const permisos = new Set<Permiso>();
  for (const rangoId of usuario.rangoIds) {
    const rango = porId.get(rangoId);
    if (rango === undefined) throw new RangeError(`Rango desconocido: ${rangoId}`);
    for (const permiso of rango.permisos) permisos.add(permiso);
  }
  return [...permisos];
}

/** Permiso que exige cada operación (matriz §22). */
export const PERMISO_POR_OPERACION = {
  ABRIR_TURNO: "shifts.open",
  CERRAR_TURNO: "shifts.close",
  FORZAR_CIERRE_TURNO: "shifts.force_close",
  REGISTRAR_MOVIMIENTO_CAJA: "shifts.cash_movement",
  CONSULTAR_TABLERO: "pos.access",
  REGISTRAR_INGRESO: "rentals.checkin",
  BUSCAR_CLIENTE: "rentals.checkin",
  /** El cajero registra al cliente nuevo al tomar sus datos en el ingreso (CU-04 paso 3); el Administrador, en CU-08. */
  REGISTRAR_CLIENTE: "rentals.checkin",
  COBRAR_HORA_ADICIONAL: "rentals.extra_hour",
  REGISTRAR_SALIDA: "rentals.checkout",
  REGISTRAR_SALIDA_SIN_PAGO: "rentals.checkout",
  AJUSTAR_PRECIO_HABITACION: "rentals.manual_adjustment",
  AJUSTAR_PRECIO_TIENDA: "store.manual_adjustment",
  GESTIONAR_PRECIO_ESPECIAL: "client_pricing.manage",
  VENDER: "sales.sell",
  REPONER_INVENTARIO: "inventory.manage",
  GESTIONAR_PRODUCTOS: "inventory.manage",
  GESTIONAR_HABITACIONES: "rooms.manage",
  BLOQUEAR_O_REACTIVAR_HABITACION: "rooms.maintenance",
  VER_PENDIENTES_LIMPIEZA: "cleaning.access",
  MARCAR_HABITACION_LISTA: "cleaning.mark_ready",
  REPORTAR_MANTENIMIENTO: "cleaning.mark_ready",
  ANULAR_TICKET: "tickets.void",
  /** Vía del Cajero (RN-46): entra desde el POS y `anularTicket` le exige un código de autorización válido. */
  ANULAR_TICKET_CON_CODIGO: "pos.access",
  GENERAR_CODIGO_AUTORIZACION: "tickets.void",
  REIMPRIMIR_COMPROBANTE: "tickets.reprint",
  GESTIONAR_USUARIOS: "users.manage",
  GESTIONAR_RANGOS: "users.manage",
  CONSULTAR_AUDITORIA: "audit.view",
  CONSULTAR_REPORTES: "reports.view",
  CONFIGURAR_PARAMETROS: "settings.manage",
  CONFIGURAR_METODOS_PAGO: "settings.manage",
  CONSULTAR_RESUMEN_REMOTO: "dashboard.access",
  /** Estado y "sincronizar ahora" del espejo en la nube (ADR-06), junto al resto de la configuración del sistema. */
  CONSULTAR_ESTADO_ESPEJO: "settings.manage",
  SINCRONIZAR_ESPEJO: "settings.manage",
} as const satisfies Record<string, Permiso>;

export type Operacion = keyof typeof PERMISO_POR_OPERACION;

/**
 * ¿Puede ejecutar la operación? Para ANULAR_TICKET, un Cajero sin `tickets.void` todavía puede anular
 * con un código de autorización: eso lo resuelve `anularTicket`, no esta función.
 */
export function puede(permisos: readonly Permiso[], operacion: Operacion): boolean {
  return permisos.includes(PERMISO_POR_OPERACION[operacion]);
}

/** Permiso del ajuste puntual según el origen del ticket (decisión 9 de contracts). */
export function permisoAjustePuntual(origen: OrigenTicket): Permiso {
  return origen === "VENTA_TIENDA" ? "store.manual_adjustment" : "rentals.manual_adjustment";
}

/**
 * Al editar su propia cuenta, nadie puede desactivarse ni quitarse `users.manage` (CU-23, decisión 19 de
 * contracts): se quedaría sin poder deshacerlo. `editado` es la cuenta como quedaría y `rangos`, los rangos
 * que se le asignan. Si lo edita otro usuario, no hay restricción.
 */
export function validarEdicionPropia(solicitanteId: Id, editado: Usuario, rangos: readonly Rango[]): void {
  if (editado.id !== solicitanteId) return;
  if (!editado.activo) {
    throw new ErrorNegocio("SELF_LOCKOUT_FORBIDDEN", "No puede desactivar su propia cuenta.");
  }
  if (!permisosEfectivos(editado, rangos).includes("users.manage")) {
    throw new ErrorNegocio("SELF_LOCKOUT_FORBIDDEN", "No puede quitarse el permiso de gestionar usuarios.");
  }
}
