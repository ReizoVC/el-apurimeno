"use client";

import { useCallback, useEffect, useState } from "react";
import { EstadoHabitacion, type Habitacion } from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@apurimeno/ui/components/card";
import {
  marcarHabitacionLista,
  obtenerHabitaciones,
  reportarMantenimiento,
} from "../src/api-mock";

type Accion = (id: string) => Promise<void>;

function mensajeDe(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "No se pudo completar la acción.";
}

export default function CleaningPage() {
  const [habitaciones, setHabitaciones] = useState<Habitacion[]>([]);
  // Habitaciones con una acción en curso: sus botones quedan deshabilitados hasta la respuesta.
  const [enCurso, setEnCurso] = useState<ReadonlySet<string>>(new Set());
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const data = await obtenerHabitaciones();
    setHabitaciones(
      data.filter((h) => h.estado === EstadoHabitacion.PENDIENTE_LIMPIEZA),
    );
  }, []);

  useEffect(() => {
    cargar().catch((error: unknown) => setAviso(mensajeDe(error)));
  }, [cargar]);

  // La tarjeta solo se quita cuando el servidor confirma la acción. Si falla, se avisa y se recarga
  // la lista: la tarjeta sigue ahí si la habitación sigue pendiente, o desaparece si otra persona
  // ya la atendió.
  const ejecutar = async (accion: Accion, habitacion: Habitacion) => {
    setAviso(null);
    setEnCurso((prev) => new Set(prev).add(habitacion.id));
    try {
      await accion(habitacion.id);
      setHabitaciones((prev) => prev.filter((h) => h.id !== habitacion.id));
    } catch (error) {
      setAviso(`Habitación ${habitacion.numero}: ${mensajeDe(error)}`);
      await cargar().catch(() => undefined);
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
      {habitaciones.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No hay habitaciones pendientes de limpieza.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {habitaciones.map((habitacion) => {
            const ocupada = enCurso.has(habitacion.id);
            return (
              <Card key={habitacion.id} className="flex flex-col justify-between">
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
                    onClick={() => void ejecutar(marcarHabitacionLista, habitacion)}
                  >
                    {ocupada ? "Enviando…" : "Marcar lista"}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={ocupada}
                    onClick={() => void ejecutar(reportarMantenimiento, habitacion)}
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
