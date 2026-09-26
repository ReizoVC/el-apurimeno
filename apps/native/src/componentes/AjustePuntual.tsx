import { useEffect, useState } from "react";
import type { AjusteEntrada } from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import { Input } from "@apurimeno/ui/components/input";
import { leerSoles, soles } from "../lib/formato";
import { Campo } from "./Campo";

interface Props {
  /** Total calculado automáticamente: el ajuste no puede quedar por debajo (RN-18). */
  minimo: number;
  onCambio: (ajuste: AjusteEntrada | null) => void;
}

/**
 * Ajuste puntual (CU-10): cerrado por defecto. Solo se muestra a quien tiene el permiso del ajuste; que el monto
 * no baje del mínimo y que haya motivo lo vuelve a validar el servidor (ADJUSTMENT_BELOW_MINIMUM, REASON_REQUIRED).
 */
export function AjustePuntual({ minimo, onCambio }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const centimos = leerSoles(monto);

  useEffect(() => {
    onCambio(
      abierto && centimos !== null ? { montoAjustado: centimos, motivo } : null,
    );
  }, [abierto, centimos, motivo, onCambio]);

  if (!abierto) {
    return (
      <Button
        type="button"
        variant="link"
        className="self-start px-0"
        onClick={() => setAbierto(true)}
      >
        Ajustar precio…
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between text-sm font-medium">
        Ajuste puntual
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAbierto(false)}
        >
          Quitar
        </Button>
      </div>
      <Campo
        etiqueta="Nuevo total (S/)"
        ayuda={`No puede ser menor a ${soles(minimo)}.`}
      >
        <Input
          inputMode="decimal"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
        />
      </Campo>
      <Campo etiqueta="Motivo (obligatorio)">
        <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Campo>
    </div>
  );
}
