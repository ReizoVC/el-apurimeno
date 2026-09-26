"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@apurimeno/ui/components/alert";
import { Acceso } from "../src/componentes/Acceso";
import { Resumen } from "../src/componentes/Resumen";
import { mensajeDe, pasoActual, salir, type Paso } from "../src/lib/acceso";
import { supabase } from "../src/lib/supabase";

/**
 * Vista remota de la propietaria (CU-28): ingreso → verificación en dos pasos → resumen. Una sola página que avanza
 * por estados; el resumen solo se monta con la sesión en el nivel aal2.
 */
export default function Pagina() {
  const [paso, setPaso] = useState<Paso | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revisar = useCallback(async () => {
    try {
      setPaso(await pasoActual());
      setError(null);
    } catch (e) {
      setError(mensajeDe(e));
      setPaso({ tipo: "ingreso" });
    }
  }, []);

  useEffect(() => {
    void revisar();
    // Sesión vencida o cerrada en otra pestaña: volver al ingreso.
    const { data } = supabase().auth.onAuthStateChange((evento) => {
      if (evento === "SIGNED_OUT") setPaso({ tipo: "ingreso" });
    });
    return () => data.subscription.unsubscribe();
  }, [revisar]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">El Apurimeño</h1>
          <p className="text-sm text-muted-foreground">Resumen del negocio</p>
        </div>
        {(paso?.tipo === "resumen" ||
          paso?.tipo === "codigo" ||
          paso?.tipo === "alta") && (
          <button
            type="button"
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => void salir()}
          >
            Salir
          </button>
        )}
      </header>
      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {paso === null ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : paso.tipo === "resumen" ? (
        <Resumen />
      ) : (
        <Acceso paso={paso} onPaso={setPaso} />
      )}
    </main>
  );
}
