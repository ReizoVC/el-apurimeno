"use client";

import { useEffect } from "react";
import type {
  EstadoHabitacion,
  EstadoTemporalAlquiler,
} from "@apurimeno/contracts";
import { Badge } from "@apurimeno/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apurimeno/ui/components/card";
import { Aviso, Encabezado } from "../src/componentes/comunes";
import { useSesion } from "../src/componentes/Shell";
import { useCarga } from "../src/lib/carga";
import { nombresDeUsuarios } from "../src/lib/nombres";
import { diaLima, periodoDeDias } from "@apurimeno/formato";
import { fechaHora, hora, soles } from "@apurimeno/formato";
import { ORIGEN_TICKET } from "../src/lib/rotulos";
import { servidor } from "../src/lib/servidor";

const ESTADOS: { estado: EstadoHabitacion; etiqueta: string; color: string }[] =
  [
    { estado: "LIBRE", etiqueta: "Libres", color: "text-emerald-700" },
    { estado: "OCUPADA", etiqueta: "Ocupadas", color: "text-sky-700" },
    {
      estado: "PENDIENTE_LIMPIEZA",
      etiqueta: "Por limpiar",
      color: "text-violet-700",
    },
    {
      estado: "MANTENIMIENTO",
      etiqueta: "Mantenimiento",
      color: "text-zinc-600",
    },
  ];

const TEMPORAL: Record<
  EstadoTemporalAlquiler,
  { etiqueta: string; clase: string }
> = {
  A_TIEMPO: { etiqueta: "A tiempo", clase: "bg-sky-600 text-white" },
  POR_VENCER: { etiqueta: "Por vencer", clase: "bg-amber-500 text-black" },
  EN_CORTESIA: { etiqueta: "En cortesía", clase: "bg-orange-600 text-white" },
  EN_SOBRETIEMPO: { etiqueta: "Sobretiempo", clase: "bg-red-600 text-white" },
};

/**
 * Vista general: un vistazo al día, no un reporte. Ocupación de ahora (tablero), turnos abiertos e ingresos
 * de hoy (día de Lima según la hora del servidor, solo cobros vigentes, como en Reportes).
 */
export default function VistaGeneral() {
  const sesion = useSesion();
  const tablero = useCarga(() => servidor.tablero(), []);
  const turnos = useCarga(async () => {
    const [abiertos, nombre] = await Promise.all([
      servidor.turnosAbiertos(),
      nombresDeUsuarios(sesion),
    ]);
    return abiertos.map((t) => ({
      ...t,
      cajero: nombre.get(t.usuarioId) ?? t.usuarioId,
    }));
  }, [sesion]);
  const hoy =
    tablero.datos === null ? null : diaLima(new Date(tablero.datos.ahora));
  const ventas = useCarga(async () => {
    if (hoy === null) return null;
    const [reporte, metodos] = await Promise.all([
      servidor.reporteVentas(periodoDeDias(hoy, hoy)),
      servidor.metodosPago(),
    ]);
    return {
      reporte,
      nombreMetodo: new Map(metodos.map((m) => [m.id, m.nombre])),
    };
  }, [hoy]);

  const { recargar: recargarTablero } = tablero;
  const { recargar: recargarTurnos } = turnos;
  const { recargar: recargarVentas } = ventas;
  useEffect(() => {
    const id = window.setInterval(() => {
      void recargarTablero();
      void recargarTurnos();
      void recargarVentas();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [recargarTablero, recargarTurnos, recargarVentas]);

  const habitaciones = tablero.datos?.habitaciones ?? [];
  const ocupadas = habitaciones.filter((h) => h.alquiler !== null);

  return (
    <>
      <Encabezado
        titulo="Vista general"
        descripcion={
          tablero.datos === null
            ? "Cargando…"
            : `Hoy ${hoy ?? ""} · actualizado ${hora(tablero.datos.ahora)} (se refresca cada 30 s)`
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Ocupación ahora</CardTitle>
            <CardDescription>
              {habitaciones.length} habitaciones
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {tablero.error !== null && (
              <Aviso tipo="error">{tablero.error}</Aviso>
            )}
            <div className="grid grid-cols-4 gap-3">
              {ESTADOS.map(({ estado, etiqueta, color }) => (
                <div
                  key={estado}
                  className="rounded-lg border bg-background p-3"
                >
                  <p className={`text-3xl font-bold ${color}`}>
                    {
                      habitaciones.filter((h) => h.habitacion.estado === estado)
                        .length
                    }
                  </p>
                  <p className="text-sm text-muted-foreground">{etiqueta}</p>
                </div>
              ))}
            </div>
            {ocupadas.length > 0 && (
              <ul className="flex flex-col divide-y rounded-md border bg-background text-sm">
                {ocupadas.map(({ habitacion, alquiler }) =>
                  alquiler === null ? null : (
                    <li
                      key={habitacion.id}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                    >
                      <span className="font-medium">
                        Habitación {habitacion.numero}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          ingresó {hora(alquiler.alquiler.ingresoEn)} · sale{" "}
                          {hora(alquiler.alquiler.salidaProgramadaEn)}
                        </span>
                        <Badge
                          className={TEMPORAL[alquiler.estadoTemporal].clase}
                        >
                          {TEMPORAL[alquiler.estadoTemporal].etiqueta}
                        </Badge>
                      </span>
                    </li>
                  ),
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Turnos abiertos</CardTitle>
            <CardDescription>
              El efectivo esperado no se muestra hasta el cierre (RN-34).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {turnos.error !== null && (
              <Aviso tipo="error">{turnos.error}</Aviso>
            )}
            {turnos.datos !== null && turnos.datos.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No hay turnos abiertos.
              </p>
            )}
            <ul className="flex flex-col gap-2 text-sm">
              {turnos.datos?.map((t) => (
                <li
                  key={t.id}
                  className="rounded-md border bg-background px-3 py-2"
                >
                  <p className="font-medium">{t.cajero}</p>
                  <p className="text-muted-foreground">
                    Desde {fechaHora(t.abiertoEn)} ·{" "}
                    <span className="whitespace-nowrap">
                      inicial {soles(t.efectivoInicial)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Ingresos de hoy</CardTitle>
            <CardDescription>
              Solo cobros vigentes: los tickets anulados y sus devoluciones no
              cuentan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ventas.error !== null && (
              <Aviso tipo="error">{ventas.error}</Aviso>
            )}
            {ventas.datos !== null && ventas.datos !== undefined && (
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-3xl font-bold">
                    {soles(ventas.datos.reporte.total)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {ventas.datos.reporte.cantidadTickets} cobros
                  </p>
                </div>
                <dl className="flex flex-col gap-1 text-sm">
                  {ventas.datos.reporte.porOrigen.map((o) => (
                    <div key={o.origen} className="flex justify-between">
                      <dt>{ORIGEN_TICKET[o.origen]}</dt>
                      <dd className="font-medium">{soles(o.total)}</dd>
                    </div>
                  ))}
                </dl>
                <dl className="flex flex-col gap-1 text-sm">
                  {ventas.datos.reporte.porMetodoPago.map((m) => (
                    <div key={m.metodoPagoId} className="flex justify-between">
                      <dt>
                        {ventas.datos?.nombreMetodo.get(m.metodoPagoId) ??
                          m.metodoPagoId}
                      </dt>
                      <dd className="font-medium">{soles(m.total)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
