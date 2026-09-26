"use client";

import { useCallback, useEffect, useState } from "react";
import type { Habitacion } from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@apurimeno/ui/components/card";
import {
  ErrorApi,
  marcarHabitacionLista,
  obtenerPendientes,
  reportarMantenimiento,
} from "./api";
import type { Sesion } from "./sesion";

/** Cada cuánto se vuelve a pedir la lista: las salidas del POS agregan habitaciones pendientes. */
const INTERVALO_ACTUALIZACION_MS = 30_000;

type Accion = (token: string, id: string) => Promise<void>;

interface Props {
  sesion: Sesion;
  /** El servidor respondió 401: la sesión venció o la cuenta fue desactivada. */
  onSesionInvalida: (aviso: string) => void;
  onCerrarSesion: () => void;
}

function mensajeDe(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "No se pudo completar la acción.";
}

/** Lista de habitaciones pendientes de limpieza (CU-15) con sus dos acciones (CU-16, CU-17). */
export function Pendientes({
  sesion,
  onSesionInvalida,
  onCerrarSesion,
}: Props) {
  const [habitaciones, setHabitaciones] = useState<Habitacion[] | null>(null);
  // Habitaciones con una acción en curso: sus botones quedan deshabilitados hasta la respuesta.
  const [enCurso, setEnCurso] = useState<ReadonlySet<string>>(new Set());
  const [aviso, setAviso] = useState<string | null>(null);

  /** Devuelve true si el error cerró la sesión (y ya se volvió al login). */
  const sesionCerrada = useCallback(
    (error: unknown) => {
      if (error instanceof ErrorApi && error.sesionInvalida) {
        onSesionInvalida(
          "La sesión venció o la cuenta fue desactivada. Vuelva a ingresar.",
        );
        return true;
      }
      return false;
    },
    [onSesionInvalida],
  );

  const cargar = useCallback(async () => {
    try {
      setHabitaciones(await obtenerPendientes(sesion.token));
    } catch (error) {
      if (!sesionCerrada(error)) setAviso(mensajeDe(error));
    }
  }, [sesion.token, sesionCerrada]);

  useEffect(() => {
    void cargar();
    const intervalo = window.setInterval(
      () => void cargar(),
      INTERVALO_ACTUALIZACION_MS,
    );
    return () => window.clearInterval(intervalo);
  }, [cargar]);

  // La tarjeta solo se quita cuando el servidor confirma la acción. Si falla, se avisa y se recarga
  // la lista: la tarjeta sigue ahí si la habitación sigue pendiente, o desaparece si otra persona
  // ya la atendió (el servidor responde 422 en ese caso).
  const ejecutar = async (accion: Accion, habitacion: Habitacion) => {
    setAviso(null);
    setEnCurso((prev) => new Set(prev).add(habitacion.id));
    try {
      await accion(sesion.token, habitacion.id);
      setHabitaciones(
        (prev) => prev?.filter((h) => h.id !== habitacion.id) ?? null,
      );
    } catch (error) {
      if (sesionCerrada(error)) return;
      setAviso(`Habitación ${habitacion.numero}: ${mensajeDe(error)}`);
      await cargar();
    } finally {
      setEnCurso((prev) => {
        const siguiente = new Set(prev);
        siguiente.delete(habitacion.id);
        return siguiente;
      });
    }
  };

  return (
    <main className="container mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Sesión:{" "}
          <span className="font-medium text-foreground">
            {sesion.nombreUsuario}
          </span>
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void cargar()}>
            Actualizar
          </Button>
          <Button variant="ghost" size="sm" onClick={onCerrarSesion}>
            Cerrar sesión
          </Button>
        </div>
      </header>
      {aviso !== null && (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span>{aviso}</span>
          <Button variant="ghost" size="sm" onClick={() => setAviso(null)}>
            Cerrar
          </Button>
        </div>
      )}
      {habitaciones === null ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Cargando…
        </p>
      ) : habitaciones.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No hay habitaciones pendientes de limpieza.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {habitaciones.map((habitacion) => {
            const ocupada = enCurso.has(habitacion.id);
            return (
              <Card
                key={habitacion.id}
                className="flex flex-col justify-between"
              >
                <CardHeader>
                  <CardTitle>Habitación {habitacion.numero}</CardTitle>
                  {habitacion.descripcion !== null && (
                    <CardDescription>{habitacion.descripcion}</CardDescription>
                  )}
                </CardHeader>
                <CardFooter className="flex flex-col gap-2">
                  <Button
                    className="w-full"
                    disabled={ocupada}
                    onClick={() =>
                      void ejecutar(marcarHabitacionLista, habitacion)
                    }
                  >
                    {ocupada ? "Enviando…" : "Marcar lista"}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={ocupada}
                    onClick={() =>
                      void ejecutar(reportarMantenimiento, habitacion)
                    }
                  >
                    Reportar mantenimiento
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
