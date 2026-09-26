import type { ReactNode } from "react";

/** Etiqueta con su control debajo; el texto de ayuda o el error van al pie. */
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
