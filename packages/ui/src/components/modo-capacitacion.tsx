import { useEffect, type ReactNode } from "react";

// Marca visible de una sesión de capacitación, en todas las pantallas: un banner fijo arriba, un marco fucsia
// alrededor de la ventana y el fondo de la página con franjas fucsia. Ningún estado real del sistema usa el fucsia
// ni un patrón de franjas (los estados son verde, celeste, violeta, gris, ámbar, naranja y rojo, lisos).

export const TEXTO_CAPACITACION =
  "MODO CAPACITACIÓN — ningún dato aquí es real";

const FONDO_FRANJAS =
  "repeating-linear-gradient(135deg, #fdf4ff 0px, #fdf4ff 24px, #f5d0fe 24px, #f5d0fe 48px)";

interface Props {
  activo: boolean;
  children: ReactNode;
}

export function MarcoCapacitacion({ activo, children }: Props) {
  useEffect(() => {
    if (!activo) return;
    const anterior = document.body.style.backgroundImage;
    document.body.style.backgroundImage = FONDO_FRANJAS;
    document.body.dataset["capacitacion"] = "si";
    return () => {
      document.body.style.backgroundImage = anterior;
      delete document.body.dataset["capacitacion"];
    };
  }, [activo]);

  if (!activo) return <>{children}</>;
  return (
    <>
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-[1000] bg-fuchsia-800 px-4 py-2 text-center text-sm font-bold uppercase tracking-wide text-white shadow-md"
      >
        {TEXTO_CAPACITACION}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[999] border-[6px] border-fuchsia-600"
      />
      {/* Deja lugar para el banner: nada de la pantalla queda debajo de él. */}
      <div aria-hidden="true" className="h-9" />
      {children}
    </>
  );
}
