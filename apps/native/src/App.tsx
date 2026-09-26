import { useCallback, useEffect, useState } from "react";
import type { Tablero as TableroApi } from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import { Aviso } from "./componentes/Aviso";
import {
  mensajeDe,
  registrarSesionInvalida,
  servidor,
  usarSesion,
} from "./lib/servidor";
import { sincronizarReloj } from "./lib/reloj";
import {
  borrarSesion,
  guardarSesion,
  leerSesion,
  type Sesion,
} from "./lib/sesion";
import { Login } from "./pantallas/Login";
import { Tablero } from "./pantallas/Tablero";

/** Cada cuánto se vuelve a pedir el tablero: las salidas y la limpieza cambian estados desde otros equipos. */
const INTERVALO_TABLERO_MS = 15_000;

type Estado =
  | { tipo: "sin-sesion"; aviso: string | null }
  | { tipo: "con-sesion"; sesion: Sesion };

export default function App() {
  const [estado, setEstado] = useState<Estado>(() => {
    const sesion = leerSesion();
    usarSesion(sesion);
    return sesion === null
      ? { tipo: "sin-sesion", aviso: null }
      : { tipo: "con-sesion", sesion };
  });

  const entrar = useCallback((sesion: Sesion) => {
    guardarSesion(sesion);
    usarSesion(sesion);
    setEstado({ tipo: "con-sesion", sesion });
  }, []);

  const salir = useCallback((aviso: string | null) => {
    borrarSesion();
    usarSesion(null);
    setEstado({ tipo: "sin-sesion", aviso });
  }, []);

  useEffect(() => {
    registrarSesionInvalida(() =>
      salir("La sesión venció o la cuenta fue desactivada. Vuelva a ingresar."),
    );
  }, [salir]);

  if (estado.tipo === "sin-sesion")
    return <Login avisoInicial={estado.aviso} onSesion={entrar} />;
  return <Principal sesion={estado.sesion} onSalir={() => salir(null)} />;
}

function Principal({
  sesion,
  onSalir,
}: {
  sesion: Sesion;
  onSalir: () => void;
}) {
  const [tablero, setTablero] = useState<TableroApi | null>(null);
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargarTablero = useCallback(async () => {
    try {
      const t = await servidor.tablero();
      sincronizarReloj(t.ahora);
      setTablero(t);
    } catch (error) {
      setAviso(mensajeDe(error));
    }
  }, []);

  useEffect(() => {
    void cargarTablero();
    const id = window.setInterval(
      () => void cargarTablero(),
      INTERVALO_TABLERO_MS,
    );
    return () => window.clearInterval(id);
  }, [cargarTablero]);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex items-center justify-between gap-4 border-b bg-background px-4 py-2">
        <span className="font-semibold">El Apurimeño · POS</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            Cajero:{" "}
            <span className="font-medium text-foreground">
              {sesion.usuario.nombreUsuario}
            </span>
          </span>
          <Button variant="ghost" size="sm" onClick={onSalir}>
            Cerrar sesión
          </Button>
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-3 p-4">
        {aviso !== null && (
          <Aviso tipo="error" onCerrar={() => setAviso(null)}>
            {aviso}
          </Aviso>
        )}
        {tablero === null ? (
          <p className="text-sm text-muted-foreground">
            Cargando habitaciones…
          </p>
        ) : (
          <Tablero
            tablero={tablero}
            seleccionada={seleccionada}
            onSeleccionar={setSeleccionada}
          />
        )}
      </main>
    </div>
  );
}
