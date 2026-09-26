import { useMemo } from "react";
import type { Tablero as TableroApi } from "@apurimeno/contracts";
import { calcularEstadoTemporal } from "@apurimeno/domain";
import { Badge } from "@apurimeno/ui/components/badge";
import { ESTADO_HABITACION, ESTADO_TEMPORAL } from "../componentes/estados";
import { duracion, hora, pisoDe } from "../lib/formato";
import { useAhoraServidor } from "../lib/reloj";

export type HabitacionEnTablero = TableroApi["habitaciones"][number];

interface Props {
  tablero: TableroApi;
  seleccionada: string | null;
  onSeleccionar: (habitacionId: string) => void;
}

/**
 * Grilla de habitaciones agrupadas por piso (el piso sale del número: 205 → piso 2). El estado de cada
 * habitación viene del servidor; el estado temporal de las ocupadas se recalcula cada segundo con la misma
 * regla del dominio (`calcularEstadoTemporal`, RN-11) sobre la hora del servidor, así cambia de color en vivo
 * entre una consulta y la siguiente.
 */
export function Tablero({ tablero, seleccionada, onSeleccionar }: Props) {
  const ahora = useAhoraServidor().toISOString();
  const pisos = useMemo(() => {
    const grupos = new Map<string, HabitacionEnTablero[]>();
    for (const h of tablero.habitaciones) {
      const piso = pisoDe(h.habitacion.numero);
      grupos.set(piso, [...(grupos.get(piso) ?? []), h]);
    }
    return [...grupos.entries()].sort(([a], [b]) =>
      a.localeCompare(b, "es", { numeric: true }),
    );
  }, [tablero]);

  return (
    <div className="flex flex-col gap-5">
      {pisos.map(([piso, habitaciones]) => (
        <section key={piso} aria-label={`Piso ${piso}`}>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            Piso {piso}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
            {habitaciones.map(({ habitacion, alquiler }) => {
              const temporal =
                alquiler === null
                  ? null
                  : calcularEstadoTemporal(alquiler.alquiler, ahora);
              const estilo =
                temporal === null
                  ? ESTADO_HABITACION[habitacion.estado]
                  : ESTADO_TEMPORAL[temporal];
              const restante =
                alquiler === null
                  ? 0
                  : Date.parse(alquiler.alquiler.salidaProgramadaEn) -
                    Date.parse(ahora);
              return (
                <button
                  key={habitacion.id}
                  type="button"
                  onClick={() => onSeleccionar(habitacion.id)}
                  aria-pressed={seleccionada === habitacion.id}
                  className={`flex min-h-28 flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-shadow hover:shadow-md ${estilo.tarjeta} ${
                    seleccionada === habitacion.id
                      ? "ring-2 ring-foreground ring-offset-2"
                      : ""
                  }`}
                >
                  <span className="text-2xl font-bold leading-none">
                    {habitacion.numero}
                  </span>
                  <Badge className={estilo.insignia}>
                    {temporal === null
                      ? estilo.etiqueta
                      : `Ocupada · ${estilo.etiqueta}`}
                  </Badge>
                  {alquiler !== null && (
                    <span className="text-xs text-foreground/80">
                      Sale {hora(alquiler.alquiler.salidaProgramadaEn)} ·{" "}
                      {restante >= 0
                        ? `faltan ${duracion(restante)}`
                        : `pasó ${duracion(restante)}`}
                    </span>
                  )}
                  {alquiler === null && habitacion.descripcion !== null && (
                    <span className="text-xs text-muted-foreground">
                      {habitacion.descripcion}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
