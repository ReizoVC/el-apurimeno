import { esClaveSupabasePrivilegiada } from "@apurimeno/contracts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Un solo cliente para toda la app, creado al primer uso (en el navegador). Solo con la clave publicable: lo que se
// puede leer lo deciden las políticas de row-level security del proyecto, no esta app.

let cliente: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (cliente !== null) return cliente;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const clave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (url === "" || clave === "")
    throw new Error(
      "La app no está configurada: falta la URL o la clave de Supabase.",
    );
  if (esClaveSupabasePrivilegiada(clave))
    throw new Error(
      "La app está configurada con una clave secreta; no se usa.",
    );
  cliente = createClient(url, clave, {
    auth: {
      // La sesión queda en el celular: así no pide contraseña y código cada vez que se abre la app. "Salir" la cierra.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return cliente;
}
