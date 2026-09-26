import { useEffect, useState } from "react";
import type {
  AjusteEntrada,
  Cliente,
  CotizacionIngresoRespuesta,
  Habitacion,
  MetodoPago,
  PagoEntrada,
} from "@apurimeno/contracts";
import { Badge } from "@apurimeno/ui/components/badge";
import { Button } from "@apurimeno/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@apurimeno/ui/components/card";
import { Input } from "@apurimeno/ui/components/input";
import { AjustePuntual } from "../componentes/AjustePuntual";
import { Aviso } from "../componentes/Aviso";
import { SelectorCliente } from "../componentes/SelectorCliente";
import { SelectorPago } from "../componentes/SelectorPago";
import { hora, soles } from "../lib/formato";
import { useClaveIdempotencia } from "../lib/idempotencia";
import { mensajeDe, servidor } from "../lib/servidor";
import { tienePermiso, type Sesion } from "../lib/sesion";

/** Selección rápida de horas pagadas al ingresar (RF-64); también se puede escribir otra cantidad. */
const HORAS_RAPIDAS = [1, 2, 5] as const;

interface Props {
  habitacion: Habitacion;
  sesion: Sesion;
  metodos: readonly MetodoPago[];
  onRegistrado: (mensaje: string) => void;
  onCancelar: () => void;
}

/**
 * Ingreso (CU-04). El precio lo calcula el servidor en cada cambio (POST /alquileres/cotizacion): precio de
 * lista o especial si el cliente lo tiene para esta habitación (RN-14), más las horas pagadas al ingresar
 * (RN-08). El POS solo muestra la cotización, deja ajustar si hay permiso, y cobra.
 */
export function Ingreso({
  habitacion,
  sesion,
  metodos,
  onRegistrado,
  onCancelar,
}: Props) {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [horas, setHoras] = useState(0);
  const [cotizacion, setCotizacion] =
    useState<CotizacionIngresoRespuesta | null>(null);
  const [ajuste, setAjuste] = useState<AjusteEntrada | null>(null);
  const [pago, setPago] = useState<PagoEntrada | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clave, renovarClave] = useClaveIdempotencia();

  useEffect(() => {
    let vigente = true;
    setCotizacion(null);
    servidor
      .cotizarIngreso({
        habitacionId: habitacion.id,
        clienteId: cliente?.id ?? null,
        horasAdicionalesAlIngreso: horas,
      })
      .then(
        (c) => vigente && setCotizacion(c),
        (e: unknown) => vigente && setError(mensajeDe(e)),
      );
    return () => {
      vigente = false;
    };
  }, [habitacion.id, cliente, horas]);

  const total = ajuste?.montoAjustado ?? cotizacion?.total ?? 0;

  const confirmar = async () => {
    if (pago === null || cotizacion === null) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await servidor.registrarIngreso(
        {
          habitacionId: habitacion.id,
          clienteId: cliente?.id ?? null,
          horasAdicionalesAlIngreso: horas,
          ajuste,
          pagos: [{ ...pago, monto: total }],
        },
        clave,
      );
      renovarClave();
      const vuelto = r.ticket.pagos.reduce(
        (suma, p) => suma + (p.vuelto ?? 0),
        0,
      );
      onRegistrado(
        `Ingreso registrado: habitación ${habitacion.numero}, sale a las ${hora(r.alquiler.salidaProgramadaEn)}.` +
          (vuelto > 0 ? ` Vuelto: ${soles(vuelto)}.` : ""),
      );
    } catch (e) {
      // La clave se conserva: reintentar no cobra dos veces (RF-59).
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ingreso · Habitación {habitacion.numero}</CardTitle>
        <CardDescription>
          {habitacion.descripcion ?? "Habitación libre"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error !== null && (
          <Aviso tipo="error" onCerrar={() => setError(null)}>
            {error}
          </Aviso>
        )}
        <SelectorCliente cliente={cliente} onCambio={setCliente} />

        <div className="flex flex-col gap-1.5 text-sm font-medium">
          Horas adicionales pagadas al ingresar
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={horas === 0 ? "default" : "outline"}
              size="sm"
              onClick={() => setHoras(0)}
            >
              Ninguna
            </Button>
            {HORAS_RAPIDAS.map((h) => (
              <Button
                key={h}
                type="button"
                variant={horas === h ? "default" : "outline"}
                size="sm"
                onClick={() => setHoras(h)}
              >
                +{h} h
              </Button>
            ))}
            <Input
              aria-label="Otra cantidad de horas"
              className="w-20"
              inputMode="numeric"
              value={String(horas)}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                setHoras(Number.isFinite(n) && n >= 0 ? Math.min(n, 48) : 0);
              }}
            />
          </div>
        </div>

        {cotizacion === null ? (
          <p className="text-sm text-muted-foreground">Calculando precio…</p>
        ) : (
          <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-3 text-sm">
            {cotizacion.origenPrecio === "PRECIO_ESPECIAL" && (
              <Badge className="self-start bg-indigo-600 text-white">
                Precio especial del cliente
              </Badge>
            )}
            {cotizacion.lineas.map((l) => (
              <div key={l.descripcion} className="flex justify-between">
                <span>
                  {l.descripcion}
                  {l.cantidad > 1 ? ` × ${l.cantidad}` : ""}
                </span>
                <span>{soles(l.importe)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <span>Total</span>
              <span>{soles(total)}</span>
            </div>
            <span className="text-muted-foreground">
              Salida programada: {hora(cotizacion.salidaProgramadaEn)}
            </span>
          </div>
        )}

        {cotizacion !== null &&
          tienePermiso(sesion, "rentals.manual_adjustment") && (
            <AjustePuntual
              key={cotizacion.total}
              minimo={cotizacion.total}
              onCambio={setAjuste}
            />
          )}
        {cotizacion !== null && (
          <SelectorPago total={total} metodos={metodos} onCambio={setPago} />
        )}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button
          className="flex-1"
          disabled={pago === null || cotizacion === null || enviando}
          onClick={() => void confirmar()}
        >
          {enviando ? "Cobrando…" : `Cobrar ${soles(total)}`}
        </Button>
        <Button variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
      </CardFooter>
    </Card>
  );
}
