"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrigenTicket, ResumenTurno } from "@apurimeno/contracts";
import {
  estaDesactualizado,
  resumirArqueosEspejo,
  sumarResumenesDia,
  type TotalesEspejo,
} from "@apurimeno/domain";
import {
  fechaHora,
  fechaHoraCorta,
  hace,
  nombreDia,
  soles,
} from "@apurimeno/formato";
import { Alert, AlertDescription } from "@apurimeno/ui/components/alert";
import { Badge } from "@apurimeno/ui/components/badge";
import { Button } from "@apurimeno/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@apurimeno/ui/components/card";
import {
  ErrorDatos,
  PERIODOS,
  leerResumen,
  type DatosResumen,
  type Periodo,
} from "../lib/espejo";

const RECARGA_AUTOMATICA_MS = 5 * 60_000;

const ORIGEN: Record<OrigenTicket, string> = {
  INGRESO_ALQUILER: "Ingresos a habitación",
  HORA_ADICIONAL: "Horas adicionales",
  VENTA_TIENDA: "Tienda",
};

type Pestana = "ventas" | "arqueos" | "ocupacion";
const PESTANAS: { id: Pestana; etiqueta: string }[] = [
  { id: "ventas", etiqueta: "Ventas" },
  { id: "arqueos", etiqueta: "Arqueos" },
  { id: "ocupacion", etiqueta: "Ocupación" },
];

/** El resumen publicado por el local (CU-28). Solo se monta con la sesión verificada en dos pasos. */
export function Resumen() {
  const [periodo, setPeriodo] = useState<Periodo>("hoy");
  const [pestana, setPestana] = useState<Pestana>("ventas");
  const [datos, setDatos] = useState<DatosResumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await leerResumen(periodo));
      setError(null);
    } catch (e) {
      setError(
        e instanceof ErrorDatos
          ? e.message
          : "No se pudo leer el resumen. Revise el internet del celular.",
      );
    } finally {
      setCargando(false);
    }
  }, [periodo]);

  useEffect(() => {
    void cargar();
    const id = window.setInterval(() => void cargar(), RECARGA_AUTOMATICA_MS);
    return () => window.clearInterval(id);
  }, [cargar]);

  return (
    <>
      <FranjaDatos
        datos={datos}
        cargando={cargando}
        onActualizar={() => void cargar()}
      />
      <div
        className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1"
        role="group"
        aria-label="Periodo"
      >
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={periodo === p.id}
            className={`rounded-md px-2 py-2 text-sm font-medium ${periodo === p.id ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            onClick={() => setPeriodo(p.id)}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>
      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {datos !== null && (
        <>
          <p className="-mt-2 text-center text-xs text-muted-foreground">
            {datos.desde === datos.hasta
              ? nombreDia(datos.desde)
              : `Del ${nombreDia(datos.desde)} al ${nombreDia(datos.hasta)}`}
          </p>
          <div className="flex border-b" role="tablist">
            {PESTANAS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={pestana === p.id}
                className={`flex-1 border-b-2 px-2 py-2 text-sm font-medium ${pestana === p.id ? "border-foreground" : "border-transparent text-muted-foreground"}`}
                onClick={() => setPestana(p.id)}
              >
                {p.etiqueta}
              </button>
            ))}
          </div>
          <div role="tabpanel">
            {pestana === "ventas" && <Ventas datos={datos} />}
            {pestana === "arqueos" && <Arqueos turnos={datos.turnos} />}
            {pestana === "ocupacion" && <Ocupacion datos={datos} />}
          </div>
        </>
      )}
    </>
  );
}

function FranjaDatos({
  datos,
  cargando,
  onActualizar,
}: {
  datos: DatosResumen | null;
  cargando: boolean;
  onActualizar: () => void;
}) {
  const estado = datos?.estado ?? null;
  const viejo =
    estado !== null &&
    estaDesactualizado(
      estado.ultimaSincronizacion,
      estado.intervaloMinutos,
      new Date(),
    );
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${viejo ? "border-amber-500/60 bg-amber-50 text-amber-950" : "bg-background"}`}
      role="status"
    >
      <div>
        {datos === null ? (
          <span className="text-muted-foreground">Cargando…</span>
        ) : estado === null ? (
          <span>Todavía no se publicó ningún dato del local.</span>
        ) : (
          <>
            <span className="font-medium">
              Datos al {fechaHora(estado.ultimaSincronizacion)}{" "}
              <span className="font-normal">(hora de Lima)</span>
            </span>
            <span className="block text-xs">
              {hace(estado.ultimaSincronizacion)}
              {viejo &&
                ` · desactualizados: el local publica cada ${estado.intervaloMinutos} min y no lo hace desde entonces`}
            </span>
          </>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={cargando}
        onClick={onActualizar}
      >
        {cargando ? "…" : "Actualizar"}
      </Button>
    </div>
  );
}

function SinDatos({
  texto = "No hay datos publicados para este periodo.",
}: {
  texto?: string;
}) {
  return (
    <p className="rounded-lg border bg-background p-4 text-center text-sm text-muted-foreground">
      {texto}
    </p>
  );
}

function Cifra({
  titulo,
  valor,
  detalle,
  tono,
}: {
  titulo: string;
  valor: string;
  detalle?: string;
  tono?: "bien" | "mal";
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p
        className={`text-2xl font-bold ${tono === "mal" ? "text-destructive" : tono === "bien" ? "text-emerald-700" : ""}`}
      >
        {valor}
      </p>
      {detalle !== undefined && (
        <p className="text-xs text-muted-foreground">{detalle}</p>
      )}
    </div>
  );
}

function Lista({
  titulo,
  filas,
}: {
  titulo: string;
  filas: {
    clave: string;
    etiqueta: string;
    valor: string;
    apagado?: boolean;
  }[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {filas.map((f) => (
            <li
              key={f.clave}
              className={`flex justify-between gap-3 py-2 ${f.apagado === true ? "text-muted-foreground" : ""}`}
            >
              <span>{f.etiqueta}</span>
              <span className="font-medium tabular-nums">{f.valor}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Ventas({ datos }: { datos: DatosResumen }) {
  if (datos.dias.length === 0) return <SinDatos />;
  const t: TotalesEspejo = sumarResumenesDia(datos.dias);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Cifra
          titulo="Total vendido"
          valor={soles(t.totalVentas)}
          detalle={`${t.cantidadCobros} ${t.cantidadCobros === 1 ? "cobro" : "cobros"}`}
        />
        <Cifra
          titulo="Anulados"
          valor={soles(t.anuladosTotal)}
          detalle={`${t.anuladosCantidad} ${t.anuladosCantidad === 1 ? "cobro anulado" : "cobros anulados"}`}
          tono={t.anuladosCantidad > 0 ? "mal" : undefined}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Solo cobros vigentes. Los anulados no suman en el total y se muestran
        aparte.
      </p>
      {t.porOrigen.length > 0 && (
        <Lista
          titulo="Por origen"
          filas={t.porOrigen.map((o) => ({
            clave: o.origen,
            etiqueta: ORIGEN[o.origen],
            valor: soles(o.total),
          }))}
        />
      )}
      {t.porMetodoPago.length > 0 && (
        <Lista
          titulo="Por método de pago"
          filas={t.porMetodoPago.map((m) => ({
            clave: m.metodoPagoId,
            etiqueta: m.nombre,
            valor: soles(m.total),
          }))}
        />
      )}
      {datos.cantidadDias > 1 && (
        <Lista
          titulo="Por día"
          filas={t.porDia
            .slice()
            .reverse()
            .map((d) => ({
              clave: d.dia,
              etiqueta: nombreDia(d.dia),
              valor: soles(d.total),
              apagado: d.total === 0,
            }))}
        />
      )}
    </div>
  );
}

function Arqueos({ turnos }: { turnos: readonly ResumenTurno[] }) {
  if (turnos.length === 0)
    return <SinDatos texto="No se cerró ningún turno en este periodo." />;
  const r = resumirArqueosEspejo(turnos);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Cifra
          titulo="Diferencia total"
          valor={soles(r.diferenciaTotal)}
          detalle={
            r.diferenciaTotal < 0
              ? "faltante"
              : r.diferenciaTotal > 0
                ? "sobrante"
                : "cuadra"
          }
          tono={
            r.diferenciaTotal < 0
              ? "mal"
              : r.diferenciaTotal === 0
                ? "bien"
                : undefined
          }
        />
        <Cifra
          titulo="Turnos con diferencia"
          valor={String(r.turnosConDiferencia)}
          detalle={`de ${r.turnos.length} cerrados`}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Diferencia = contado − esperado. Negativa es faltante.
      </p>
      {[...r.turnos].reverse().map((t) => (
        <TarjetaTurno key={t.turnoId} turno={t} />
      ))}
    </div>
  );
}

function TarjetaTurno({ turno: t }: { turno: ResumenTurno }) {
  const diferencia = t.diferencia;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {t.cajero}
          {t.cierreForzado && <Badge variant="outline">cierre forzado</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {fechaHoraCorta(t.abiertoEn)} → {fechaHoraCorta(t.cerradoEn)}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Vendió en el turno</dt>
          <dd className="text-right tabular-nums">{soles(t.ventasTurno)}</dd>
          <dt className="text-muted-foreground">Efectivo inicial</dt>
          <dd className="text-right tabular-nums">
            {soles(t.efectivoInicial)}
          </dd>
          <dt className="text-muted-foreground">Esperado en caja</dt>
          <dd className="text-right tabular-nums">
            {soles(t.efectivoEsperado)}
          </dd>
          <dt className="text-muted-foreground">Contado</dt>
          <dd className="text-right tabular-nums">
            {t.efectivoContado === null
              ? "sin conteo"
              : soles(t.efectivoContado)}
          </dd>
          <dt className="font-medium">Diferencia</dt>
          <dd
            className={`text-right font-semibold tabular-nums ${diferencia === null ? "" : diferencia < 0 ? "text-destructive" : diferencia === 0 ? "text-emerald-700" : "text-amber-700"}`}
          >
            {diferencia === null
              ? "—"
              : diferencia === 0
                ? "cuadra"
                : soles(diferencia)}
          </dd>
        </dl>
        {t.comentario !== null && (
          <p className="rounded-md bg-muted px-2 py-1 text-xs">
            “{t.comentario}”
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Ocupacion({ datos }: { datos: DatosResumen }) {
  if (datos.dias.length === 0) return <SinDatos />;
  const t = sumarResumenesDia(datos.dias);
  const habitaciones = [...t.ocupacion].sort(
    (a, b) =>
      b.alquileres - a.alquileres ||
      b.ingresos - a.ingresos ||
      a.numero.localeCompare(b.numero, "es", { numeric: true }),
  );
  const usadas = habitaciones.filter((h) => h.alquileres > 0);
  const max = usadas[0]?.alquileres ?? 0;
  const min = usadas.at(-1)?.alquileres ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Cifra
          titulo="Alquileres"
          valor={String(t.alquileres)}
          detalle={`${usadas.length} de ${habitaciones.length} habitaciones usadas`}
        />
        <Cifra titulo="Horas vendidas" valor={String(t.horasVendidas)} />
      </div>
      <p className="text-xs text-muted-foreground">
        Alquileres que ingresaron en el periodo, de la habitación más usada a la
        menos usada. No muestra qué está ocupado ahora.
      </p>
      <Card>
        <CardContent className="pt-4">
          <ul className="divide-y text-sm">
            {habitaciones.map((h) => (
              <li
                key={h.habitacionId}
                className={`flex items-center justify-between gap-3 py-2 ${h.alquileres === 0 ? "text-muted-foreground" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <span className="w-10 font-semibold">{h.numero}</span>
                  {max > min && h.alquileres === max && (
                    <Badge className="bg-emerald-600 text-white">
                      más usada
                    </Badge>
                  )}
                  {max > min && h.alquileres === min && (
                    <Badge variant="outline">menos usada</Badge>
                  )}
                  {h.alquileres === 0 && (
                    <span className="text-xs">sin uso</span>
                  )}
                </span>
                <span className="text-right tabular-nums">
                  {h.alquileres > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      {h.alquileres}{" "}
                      {h.alquileres === 1 ? "alquiler" : "alquileres"} ·{" "}
                      {h.horasVendidas} h
                    </span>
                  )}
                  {soles(h.ingresos)}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
