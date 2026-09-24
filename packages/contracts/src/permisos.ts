import { z } from "zod";

/** Catálogo fijo de permisos (RN-41, anexo §41.3). Agregar uno requiere que exista una verificación real en el backend. */
export const PermisoSchema = z.enum([
  "pos.access",
  "dashboard.access",
  "cleaning.access",
  "shifts.open",
  "shifts.close",
  "shifts.cash_movement",
  "shifts.force_close",
  "rentals.checkin",
  "rentals.extra_hour",
  "rentals.checkout",
  "rentals.manual_adjustment",
  "rooms.manage",
  "rooms.maintenance",
  "client_pricing.manage",
  "sales.sell",
  "inventory.manage",
  "cleaning.mark_ready",
  "tickets.void",
  "tickets.reprint",
  "reports.view",
  "users.manage",
  "settings.manage",
  "audit.view",
]);
export type Permiso = z.infer<typeof PermisoSchema>;
export const PERMISOS = PermisoSchema.options;

interface DefinicionRango {
  readonly nombre: string;
  readonly permisos: readonly Permiso[];
}

/**
 * Rangos con los que arranca el sistema (§11.1, matriz §22). Son datos semilla, no un enum:
 * la propietaria puede editarlos o crear otros (RN-41).
 * El Cajero no tiene `tickets.void`: anula solo con código de autorización temporal (RN-46).
 * Limpieza reporta mantenimiento desde "Pendiente de limpieza" con `cleaning.mark_ready` (CU-17);
 * `rooms.maintenance` cubre el bloqueo y la reactivación administrativos (CU-14).
 */
export const RANGOS_INICIALES = {
  ADMINISTRADOR: {
    nombre: "Administrador",
    permisos: PERMISOS,
  },
  CAJERO: {
    nombre: "Cajero",
    permisos: [
      "pos.access",
      "shifts.open",
      "shifts.close",
      "shifts.cash_movement",
      "rentals.checkin",
      "rentals.extra_hour",
      "rentals.checkout",
      "rentals.manual_adjustment",
      "sales.sell",
      "tickets.reprint",
    ],
  },
  LIMPIEZA: {
    nombre: "Limpieza",
    permisos: ["cleaning.access", "cleaning.mark_ready"],
  },
} as const satisfies Record<string, DefinicionRango>;
