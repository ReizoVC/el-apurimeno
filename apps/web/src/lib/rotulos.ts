import type {
  AccionAuditoria,
  CodigoErrorEspejo,
  CodigoErrorRespaldo,
  OrigenTicket,
  Permiso,
  TipoEntidadAuditada,
} from "@apurimeno/contracts";

// Textos en castellano para valores del contrato. Los tipos vienen de @apurimeno/contracts: si el catálogo
// cambia, TypeScript exige completar estos textos.

/** Descripción de cada permiso (Planos §5, anexo §41.3). */
export const PERMISO: Record<Permiso, string> = {
  "pos.access": "Entrar al POS",
  "dashboard.access": "Entrar al Dashboard",
  "cleaning.access": "Entrar a la app de limpieza",
  "shifts.open": "Abrir turno de caja",
  "shifts.close": "Cerrar turno de caja",
  "shifts.cash_movement": "Registrar ingresos y retiros de efectivo",
  "shifts.force_close": "Forzar el cierre de un turno ajeno",
  "rentals.checkin": "Registrar ingresos",
  "rentals.extra_hour": "Cobrar horas adicionales",
  "rentals.checkout": "Registrar salidas",
  "rentals.manual_adjustment": "Ajustar el precio de un alquiler",
  "rooms.manage": "Crear y editar habitaciones y sus precios",
  "rooms.maintenance": "Bloquear y reactivar habitaciones",
  "client_pricing.manage": "Gestionar precios especiales",
  "sales.sell": "Vender en la tienda",
  "store.manual_adjustment": "Ajustar el precio de una venta",
  "inventory.manage": "Gestionar productos e inventario",
  "cleaning.mark_ready": "Marcar habitaciones como listas",
  "tickets.void": "Anular cobros",
  "tickets.reprint": "Reimprimir comprobantes",
  "reports.view": "Ver reportes",
  "users.manage": "Gestionar usuarios y rangos",
  "settings.manage": "Configuración y métodos de pago",
  "audit.view": "Ver la auditoría",
};

export const ORIGEN_TICKET: Record<OrigenTicket, string> = {
  INGRESO_ALQUILER: "Ingreso",
  HORA_ADICIONAL: "Hora adicional",
  VENTA_TIENDA: "Tienda",
};

export const ACCION: Record<AccionAuditoria, string> = {
  SESION_INICIADA: "Inicio de sesión",
  SESION_CERRADA: "Cierre de sesión",
  SESION_FALLIDA: "Intento de sesión fallido",
  ACCESO_DENEGADO: "Acceso denegado",
  TURNO_ABIERTO: "Turno abierto",
  TURNO_CERRADO: "Turno cerrado",
  TURNO_CIERRE_FORZADO: "Cierre forzado de turno",
  MOVIMIENTO_CAJA_REGISTRADO: "Movimiento de caja",
  INGRESO_REGISTRADO: "Ingreso",
  HORA_ADICIONAL_COBRADA: "Hora adicional",
  SALIDA_REGISTRADA: "Salida",
  SALIDA_SIN_PAGO_REGISTRADA: "Salida sin pago",
  PRECIO_ESPECIAL_CREADO: "Precio especial creado",
  PRECIO_ESPECIAL_EDITADO: "Precio especial editado",
  PRECIO_ESPECIAL_ELIMINADO: "Precio especial eliminado",
  AJUSTE_PUNTUAL_APLICADO: "Ajuste puntual",
  VENTA_REGISTRADA: "Venta",
  MERCADERIA_INGRESADA: "Ingreso de mercadería",
  HABITACION_CREADA: "Habitación creada",
  HABITACION_EDITADA: "Habitación editada",
  HABITACION_ESTADO_CAMBIADO: "Cambio de estado de habitación",
  PRODUCTO_CREADO: "Producto creado",
  PRODUCTO_EDITADO: "Producto editado",
  TICKET_ANULADO: "Ticket anulado",
  CODIGO_AUTORIZACION_GENERADO: "Código de autorización generado",
  COMPROBANTE_REIMPRESO: "Comprobante reimpreso",
  USUARIO_CREADO: "Usuario creado",
  USUARIO_EDITADO: "Usuario editado",
  USUARIO_DESACTIVADO: "Usuario desactivado",
  USUARIO_RANGOS_ASIGNADOS: "Rangos asignados",
  RANGO_CREADO: "Rango creado",
  RANGO_EDITADO: "Rango editado",
  CONFIGURACION_CAMBIADA: "Configuración cambiada",
  ESPEJO_SINCRONIZADO: "Sincronización del espejo",
  RESPALDO_MANUAL: "Copia de respaldo manual",
};

export const ENTIDAD: Record<TipoEntidadAuditada, string> = {
  SESION: "Sesión",
  HABITACION: "Habitación",
  CLIENTE: "Cliente",
  PRECIO_ESPECIAL_CLIENTE: "Precio especial",
  ALQUILER: "Alquiler",
  HORA_ADICIONAL: "Hora adicional",
  TICKET: "Ticket",
  TURNO: "Turno",
  MOVIMIENTO_CAJA: "Movimiento de caja",
  PRODUCTO: "Producto",
  MOVIMIENTO_INVENTARIO: "Movimiento de inventario",
  USUARIO: "Usuario",
  RANGO: "Rango",
  CONFIGURACION: "Configuración",
  METODO_PAGO: "Método de pago",
  CODIGO_AUTORIZACION: "Código de autorización",
  TRABAJO_IMPRESION: "Impresión",
  ESPEJO: "Espejo en la nube",
  RESPALDO: "Respaldo",
};

/** Por qué falló la última sincronización con el espejo en la nube. */
export const ERROR_ESPEJO: Record<CodigoErrorEspejo, string> = {
  SIN_CONEXION: "Sin conexión con Supabase",
  CREDENCIALES_RECHAZADAS: "Supabase rechazó la cuenta de sincronización",
  RECHAZADO_POR_EL_ESPEJO: "Supabase rechazó los datos",
  ERROR_INTERNO: "Error interno del servidor",
};

/** Por qué falló la última copia de respaldo. */
export const ERROR_RESPALDO: Record<CodigoErrorRespaldo, string> = {
  DESTINO_INACCESIBLE: "No se pudo escribir en la carpeta de destino",
  SIN_ESPACIO: "No queda espacio en el disco",
  COPIA_INVALIDA: "La copia no pasó la verificación",
  ERROR_INTERNO: "Error interno del servidor",
};
