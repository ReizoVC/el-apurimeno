"use client";

import { useEffect, useState } from "react";
import { EstadoHabitacion, type Habitacion } from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import {
  Card,
  CardContent,
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
    <main className="container mx-auto max-w-2xl p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {habitaciones.map((habitacion) => (
          <Card key={habitacion.id}>
            <CardHeader>
              <CardTitle>Habitación {habitacion.numero}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Piso {habitacion.numero.charAt(0)}
              </p>
            </CardContent>
            <CardFooter className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="w-full sm:w-auto"
                onClick={() => handleMarcarLista(habitacion.id)}
              >
                Marcar lista
              </Button>
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => handleReportarMantenimiento(habitacion.id)}
              >
                Reportar mantenimiento
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </main>
  );
}
