import type { ReactNode } from "react";
import { Button } from "@apurimeno/ui/components/button";

interface Props {
  tipo: "error" | "exito";
  children: ReactNode;
  onCerrar?: () => void;
}

/** Aviso en línea: errores del servidor (con su mensaje en castellano) o la confirmación de una operación. */
export function Aviso({ tipo, children, onCerrar }: Props) {
  const estilos =
    tipo === "error"
      ? "border-destructive/50 bg-destructive/10 text-destructive"
      : "border-emerald-600/40 bg-emerald-50 text-emerald-900";
  return (
    <div
      role={tipo === "error" ? "alert" : "status"}
      className={`flex items-start justify-between gap-3 rounded-md border p-3 text-sm ${estilos}`}
    >
      <div>{children}</div>
      {onCerrar !== undefined && (
        <Button variant="ghost" size="sm" onClick={onCerrar}>
          Cerrar
        </Button>
      )}
    </div>
  );
}
