import { z } from "zod";
import { CentimosSchema, IdSchema, TextoRequeridoSchema } from "./comun.js";
import { EstadoHabitacionSchema } from "./estados.js";

/** Una de las 17 habitaciones (§18.1). El precio es individual y no depende del piso (RN-13). */
export const HabitacionSchema = z
  .object({
    id: IdSchema,
    /** Único (§21). Ej. "205". */
    numero: TextoRequeridoSchema,
    /** Comodidades visibles, ej. "Grande, con baño propio" (anexo §41.1). */
    descripcion: TextoRequeridoSchema.nullable(),
    /** Precio de lista vigente. Los alquileres guardan su propia copia (RN-44). */
    precioBase: CentimosSchema,
    estado: EstadoHabitacionSchema,
  })
  .strict();
export type Habitacion = z.infer<typeof HabitacionSchema>;
