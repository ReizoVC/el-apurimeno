import { useEffect, useMemo, useState } from "react";
import type { MetodoPago, PagoEntrada } from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import { Input } from "@apurimeno/ui/components/input";
import { leerSoles, soles } from "@apurimeno/formato";
import { Campo } from "./Campo";

interface Props {
  total: number;
  metodos: readonly MetodoPago[];
  /** Pago listo para enviar, o null mientras falte un dato. */
  onCambio: (pago: PagoEntrada | null) => void;
}

/**
 * Un solo método de pago por cobro (decisión de UI: el contrato admite varios, pero el caso normal es uno).
 * En efectivo se pide lo recibido y se muestra el vuelto; los métodos que exigen número de operación lo piden.
 * Que el pago cubra el total y el vuelto correcto los valida el servidor igual (RF-04, PAYMENT_INSUFFICIENT).
 */
export function SelectorPago({ total, metodos, onCambio }: Props) {
  const activos = useMemo(() => metodos.filter((m) => m.activo), [metodos]);
  const [metodoId, setMetodoId] = useState<string | null>(null);
  const [recibido, setRecibido] = useState("");
  const [referencia, setReferencia] = useState("");
  const metodo = activos.find((m) => m.id === metodoId) ?? activos[0] ?? null;
  const montoRecibido = recibido.trim() === "" ? null : leerSoles(recibido);

  useEffect(() => {
    if (metodo === null) return onCambio(null);
    if (metodo.afectaCaja) {
      // Sin monto recibido se asume pago exacto.
      if (
        recibido.trim() !== "" &&
        (montoRecibido === null || montoRecibido < total)
      )
        return onCambio(null);
      return onCambio({
        metodoPagoId: metodo.id,
        monto: total,
        montoRecibido,
        referencia: null,
      });
    }
    if (metodo.requiereReferencia && referencia.trim() === "")
      return onCambio(null);
    onCambio({
      metodoPagoId: metodo.id,
      monto: total,
      montoRecibido: null,
      referencia: referencia.trim() === "" ? null : referencia.trim(),
    });
  }, [metodo, recibido, montoRecibido, referencia, total, onCambio]);

  if (activos.length === 0)
    return (
      <p className="text-sm text-destructive">
        No hay métodos de pago habilitados.
      </p>
    );

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-label="Método de pago"
      >
        {activos.map((m) => (
          <Button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={metodo?.id === m.id}
            variant={metodo?.id === m.id ? "default" : "outline"}
            onClick={() => setMetodoId(m.id)}
          >
            {m.nombre}
          </Button>
        ))}
      </div>
      {metodo?.afectaCaja === true && (
        <Campo
          etiqueta="Recibido (S/)"
          ayuda={
            montoRecibido !== null && montoRecibido >= total
              ? `Vuelto: ${soles(montoRecibido - total)}`
              : recibido.trim() === ""
                ? "Vacío: pago exacto."
                : `Debe cubrir ${soles(total)}.`
          }
        >
          <Input
            inputMode="decimal"
            value={recibido}
            onChange={(e) => setRecibido(e.target.value)}
            placeholder={(total / 100).toFixed(2)}
          />
        </Campo>
      )}
      {metodo !== null && !metodo.afectaCaja && (
        <Campo
          etiqueta={
            metodo.requiereReferencia
              ? "N.° de operación (obligatorio)"
              : "N.° de operación (opcional)"
          }
        >
          <Input
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
          />
        </Campo>
      )}
    </div>
  );
}
