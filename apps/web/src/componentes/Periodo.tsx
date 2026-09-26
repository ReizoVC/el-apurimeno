"use client";

import { useState } from "react";
import { Button } from "@apurimeno/ui/components/button";
import { Input } from "@apurimeno/ui/components/input";
import { diaLima, sumarDias } from "../lib/fechas";
import { Campo } from "./comunes";

export interface Dias {
  desde: string;
  hasta: string;
}

/** Hoy en Lima según el reloj del equipo: solo sirve para proponer fechas; el filtro se aplica en el servidor. */
export function hoyLima(): string {
  return diaLima(new Date());
}

function atajos(): { etiqueta: string; dias: Dias }[] {
  const hoy = hoyLima();
  return [
    { etiqueta: "Hoy", dias: { desde: hoy, hasta: hoy } },
    {
      etiqueta: "Ayer",
      dias: { desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) },
    },
    {
      etiqueta: "Últimos 7 días",
      dias: { desde: sumarDias(hoy, -6), hasta: hoy },
    },
    {
      etiqueta: "Este mes",
      dias: { desde: `${hoy.slice(0, 8)}01`, hasta: hoy },
    },
  ];
}

/**
 * Periodo en días de Lima, ambos incluidos. Se aplica al pulsar "Consultar" (o un atajo), no con cada
 * tecla, para no pedir reportes a medio escribir.
 */
export function SelectorPeriodo({
  valor,
  onCambio,
}: {
  valor: Dias;
  onCambio: (dias: Dias) => void;
}) {
  const [desde, setDesde] = useState(valor.desde);
  const [hasta, setHasta] = useState(valor.hasta);
  const valido = desde !== "" && hasta !== "" && desde <= hasta;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Campo etiqueta="Desde">
        <Input
          type="date"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
        />
      </Campo>
      <Campo etiqueta="Hasta (incluido)">
        <Input
          type="date"
          value={hasta}
          onChange={(e) => setHasta(e.target.value)}
        />
      </Campo>
      <Button disabled={!valido} onClick={() => onCambio({ desde, hasta })}>
        Consultar
      </Button>
      <div className="flex flex-wrap gap-1">
        {atajos().map((a) => (
          <Button
            key={a.etiqueta}
            variant="outline"
            size="sm"
            onClick={() => {
              setDesde(a.dias.desde);
              setHasta(a.dias.hasta);
              onCambio(a.dias);
            }}
          >
            {a.etiqueta}
          </Button>
        ))}
      </div>
    </div>
  );
}
