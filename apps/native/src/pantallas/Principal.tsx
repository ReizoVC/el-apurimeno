import { useCallback, useEffect, useState } from "react";
import type { MetodoPago, Tablero as TableroApi } from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apurimeno/ui/components/card";
import { Aviso } from "../componentes/Aviso";
import { ESTADO_HABITACION } from "../componentes/estados";
import { sincronizarReloj } from "../lib/reloj";
import { mensajeDe, servidor } from "../lib/servidor";
import type { Sesion } from "../lib/sesion";
import { HabitacionOcupada } from "./HabitacionOcupada";
import { Ingreso } from "./Ingreso";
import { Tablero } from "./Tablero";

/** Cada cuánto se vuelve a pedir el tablero: las salidas y la limpieza cambian estados desde otros equipos. */
const INTERVALO_TABLERO_MS = 15_000;

interface Props {
  sesion: Sesion;
  onSalir: () => void;
}

/** Pantalla de trabajo del cajero: el tablero y, al elegir una habitación, su panel de acciones a la derecha. */
export function Principal({ sesion, onSalir }: Props) {
  const [tablero, setTablero] = useState<TableroApi | null>(null);
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [metodos, setMetodos] = useState<MetodoPago[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

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

  useEffect(() => {
    servidor
      .metodosPago()
      .then(setMetodos, (e: unknown) => setAviso(mensajeDe(e)));
  }, []);

  /** Tras una operación: aviso de éxito, se cierra el panel y se recarga el tablero. */
  const terminar = useCallback(
    (mensaje: string) => {
      setExito(mensaje);
      setSeleccionada(null);
      void cargarTablero();
    },
    [cargarTablero],
  );

  const elegida =
    tablero?.habitaciones.find((h) => h.habitacion.id === seleccionada) ?? null;

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
        {exito !== null && (
          <Aviso tipo="exito" onCerrar={() => setExito(null)}>
            {exito}
          </Aviso>
        )}
        {tablero === null ? (
          <p className="text-sm text-muted-foreground">
            Cargando habitaciones…
          </p>
        ) : (
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <Tablero
                tablero={tablero}
                seleccionada={seleccionada}
                onSeleccionar={(id) => {
                  setExito(null);
                  setSeleccionada(id);
                }}
              />
            </div>
            {elegida !== null && (
              <aside className="sticky top-4 w-[26rem] shrink-0">
                {elegida.habitacion.estado === "LIBRE" ? (
                  <Ingreso
                    key={elegida.habitacion.id}
                    habitacion={elegida.habitacion}
                    sesion={sesion}
                    metodos={metodos}
                    onRegistrado={terminar}
                    onCancelar={() => setSeleccionada(null)}
                  />
                ) : elegida.alquiler !== null ? (
                  <HabitacionOcupada
                    key={elegida.alquiler.alquiler.id}
                    habitacion={elegida.habitacion}
                    ocupacion={elegida.alquiler}
                    sesion={sesion}
                    metodos={metodos}
                    onTerminado={terminar}
                    onCerrar={() => setSeleccionada(null)}
                  />
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        Habitación {elegida.habitacion.numero}
                      </CardTitle>
                      <CardDescription>
                        {ESTADO_HABITACION[elegida.habitacion.estado].etiqueta}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                )}
              </aside>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
