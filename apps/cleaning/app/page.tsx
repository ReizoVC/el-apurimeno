"use client";

import { useEffect, useState } from "react";
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

export default function CleaningPage() {
  const [habitaciones, setHabitaciones] = useState<Habitacion[]>([]);

  useEffect(() => {
    obtenerHabitaciones().then((data) => {
      setHabitaciones(
        data.filter((h) => h.estado === EstadoHabitacion.PENDIENTE_LIMPIEZA),
      );
    });
  }, []);

  const handleMarcarLista = (id: string) => {
    setHabitaciones((prev) => prev.filter((h) => h.id !== id));
    void marcarHabitacionLista(id);
  };

  const handleReportarMantenimiento = (id: string) => {
    setHabitaciones((prev) => prev.filter((h) => h.id !== id));
    void reportarMantenimiento(id);
  };

  return (
    <main className="container mx-auto max-w-4xl p-4">
      {habitaciones.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No hay habitaciones pendientes de limpieza.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {habitaciones.map((habitacion) => (
            <Card key={habitacion.id} className="flex flex-col justify-between">
              <CardHeader>
                <CardTitle>Habitación {habitacion.numero}</CardTitle>
                <CardDescription>
                  Piso {habitacion.numero.charAt(0)}
                </CardDescription>
              </CardHeader>
              <CardFooter className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  onClick={() => handleMarcarLista(habitacion.id)}
                >
                  Marcar lista
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleReportarMantenimiento(habitacion.id)}
                >
                  Reportar mantenimiento
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
