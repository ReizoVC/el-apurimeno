import { z } from "zod";
import { IdSchema, TextoRequeridoSchema } from "./comun.js";
import { sonUnicos, problema } from "./interno.js";
import { PermisoSchema } from "./permisos.js";

/**
 * Cuenta individual; nunca compartida (RN-40). Se desactiva, no se elimina (RF-45).
 * Las credenciales no forman parte del contrato: nunca salen del backend.
 */
export const UsuarioSchema = z
  .object({
    id: IdSchema,
    /** Único (§21). */
    nombreUsuario: TextoRequeridoSchema,
    activo: z.boolean(),
    rangoIds: z.array(IdSchema).min(1),
  })
  .strict()
  .superRefine((u, ctx) => {
    if (!sonUnicos(u.rangoIds)) problema(ctx, ["rangoIds"], "Un rango no se asigna dos veces.");
  });
export type Usuario = z.infer<typeof UsuarioSchema>;

/** Combinación configurable de permisos del catálogo fijo (RN-41). */
export const RangoSchema = z
  .object({
    id: IdSchema,
    /** Único (RF-62). */
    nombre: TextoRequeridoSchema,
    permisos: z.array(PermisoSchema),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (!sonUnicos(r.permisos)) problema(ctx, ["permisos"], "Un permiso no se repite en un rango.");
  });
export type Rango = z.infer<typeof RangoSchema>;
