import type { ReactNode } from "react";
import { Alert } from "@apurimeno/ui/components/alert";
import { Button } from "@apurimeno/ui/components/button";

/** Etiqueta con su control debajo; la ayuda va al pie. */
export function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string;
  ayuda?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {etiqueta}
      {children}
      {ayuda !== undefined && (
        <span className="text-xs font-normal text-muted-foreground">
          {ayuda}
        </span>
      )}
    </label>
  );
}

/** Aviso en línea: error del servidor (con su mensaje) o confirmación. */
export function Aviso({
  tipo,
  children,
  onCerrar,
}: {
  tipo: "error" | "exito";
  children: ReactNode;
  onCerrar?: () => void;
}) {
  return (
    <Alert
      variant={tipo === "error" ? "destructive" : "success"}
      className="flex items-start justify-between gap-3"
    >
      <div>{children}</div>
      {onCerrar !== undefined && (
        <Button variant="ghost" size="sm" onClick={onCerrar}>
          Cerrar
        </Button>
      )}
    </Alert>
  );
}

/** Encabezado de cada sección. */
export function Encabezado({
  titulo,
  descripcion,
  children,
}: {
  titulo: string;
  descripcion?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descripcion !== undefined && (
          <p className="text-sm text-muted-foreground">{descripcion}</p>
        )}
      </div>
      {children}
    </div>
  );
}

/** Select nativo con el estilo de Input de packages/ui. */
export const CLASE_SELECT =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
