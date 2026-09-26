import { useCallback, useEffect, useState } from "react";
import type {
  MetodoPago,
  Tablero as TableroApi,
  Turno,
} from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apurimeno/ui/components/card";
import { Aviso } from "../componentes/Aviso";
import { ESTADO_HABITACION } from "../componentes/estados";
import { fechaHora } from "../lib/formato";
import { sincronizarReloj } from "../lib/reloj";
import { mensajeDe, servidor } from "../lib/servidor";
import type { Sesion } from "../lib/sesion";
import { AbrirTurno, Caja } from "./Caja";
import { HabitacionOcupada } from "./HabitacionOcupada";
import { Ingreso } from "./Ingreso";
import { Tienda } from "./Tienda";
import { Tablero } from "./Tablero";

/** Cada cuánto se vuelve a pedir el tablero: las salidas y la limpieza cambian estados desde otros equipos. */
const INTERVALO_TABLERO_MS = 15_000;

interface Props {
  sesion: Sesion;
  onSalir: () => void;
}

type Pestana = "habitaciones" | "tienda" | "caja";

const PESTANAS: { id: Pestana; etiqueta: string }[] = [
  { id: "habitaciones", etiqueta: "Habitaciones" },
  { id: "tienda", etiqueta: "Tienda" },
  { id: "caja", etiqueta: "Caja" },
];

/** El turno se consulta al entrar y con cada recarga del tablero: si un Administrador lo cerró, se nota enseguida. */
type EstadoTurno =
  | { tipo: "consultando" }
  | { tipo: "sin-turno"; aviso: string | null }
  | { tipo: "abierto"; turno: Turno };

/**
 * Pantalla de trabajo del cajero, en pestañas. Habitaciones: el tablero y, al elegir una habitación, su panel de
 * acciones a la derecha. Tienda: la venta de productos.
 */
export function Principal({ sesion, onSalir }: Props) {
  const [tablero, setTablero] = useState<TableroApi | null>(null);
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [metodos, setMetodos] = useState<MetodoPago[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>("habitaciones");
  const [turno, setTurno] = useState<EstadoTurno>({ tipo: "consultando" });

  const cargarTablero = useCallback(async () => {
    try {
      const { turno: abierto } = await servidor.turnoActual();
      setTurno((previo) =>
        abierto !== null
          ? { tipo: "abierto", turno: abierto }
          : previo.tipo === "abierto"
            ? {
                tipo: "sin-turno",
                aviso:
                  "Su turno de caja fue cerrado. Abra uno nuevo para seguir cobrando.",
              }
            : previo.tipo === "sin-turno"
              ? previo
              : { tipo: "sin-turno", aviso: null },
      );
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
        <div className="flex items-center gap-4">
          <span className="font-semibold">El Apurimeño · POS</span>
          <nav
            className="flex gap-1"
            aria-label="Secciones"
            hidden={turno.tipo !== "abierto"}
          >
            {PESTANAS.map((p) => (
              <Button
                key={p.id}
                variant={pestana === p.id ? "secondary" : "ghost"}
                size="sm"
                aria-current={pestana === p.id ? "page" : undefined}
                onClick={() => setPestana(p.id)}
              >
                {p.etiqueta}
              </Button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {turno.tipo === "abierto" && (
            <span className="text-muted-foreground">
              Turno desde {fechaHora(turno.turno.abiertoEn)}
            </span>
          )}
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
        {turno.tipo === "consultando" && (
          <p className="text-sm text-muted-foreground">
            Consultando el turno de caja…
          </p>
        )}
        {turno.tipo === "sin-turno" && (
          <AbrirTurno
            aviso={turno.aviso}
            onAbierto={(abierto) =>
              setTurno({ tipo: "abierto", turno: abierto })
            }
          />
        )}
        {turno.tipo === "abierto" && pestana === "caja" && (
          <Caja
            key={turno.turno.id}
            turno={turno.turno}
            onCerrado={() => {
              setTurno({ tipo: "sin-turno", aviso: null });
              setPestana("habitaciones");
            }}
          />
        )}
        {turno.tipo === "abierto" && pestana === "tienda" && (
          <Tienda
            sesion={sesion}
            metodos={metodos}
            ocupadas={
              tablero?.habitaciones
                .filter((h) => h.alquiler !== null)
                .map((h) => h.habitacion) ?? []
            }
          />
        )}
        {turno.tipo === "abierto" &&
          pestana === "habitaciones" &&
          (tablero === null ? (
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
                          {
                            ESTADO_HABITACION[elegida.habitacion.estado]
                              .etiqueta
                          }
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  )}
                </aside>
              )}
            </div>
          ))}
      </main>
    </div>
  );
}
