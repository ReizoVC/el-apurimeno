import { useEffect, useState } from "react";
import type {
  AjusteEntrada,
  AlquilerEnTablero,
  CotizacionHoraAdicionalRespuesta,
  Habitacion,
  MetodoPago,
  OrigenTicket,
  PagoEntrada,
  Ticket,
} from "@apurimeno/contracts";
import { calcularEstadoTemporal } from "@apurimeno/domain";
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
import { Campo } from "../componentes/Campo";
import { ESTADO_TEMPORAL } from "../componentes/estados";
import { SelectorPago } from "../componentes/SelectorPago";
import { duracion, hora, soles } from "../lib/formato";
import { useClaveIdempotencia } from "../lib/idempotencia";
import { useAhoraServidor } from "../lib/reloj";
import { ErrorApi, mensajeDe, servidor } from "../lib/servidor";
import { tienePermiso, type Sesion } from "../lib/sesion";

const ORIGEN: Record<OrigenTicket, string> = {
  INGRESO_ALQUILER: "Ingreso",
  HORA_ADICIONAL: "Hora adicional",
  VENTA_TIENDA: "Venta",
};

interface Props {
  habitacion: Habitacion;
  ocupacion: AlquilerEnTablero;
  sesion: Sesion;
  metodos: readonly MetodoPago[];
  onTerminado: (mensaje: string) => void;
  onCerrar: () => void;
}

type Vista = "resumen" | "hora" | "salida" | "anular";

/**
 * Habitación ocupada: estado temporal en vivo (RN-11) y las tres acciones del cajero sobre el alquiler: cobrar
 * una hora adicional (CU-05), registrar la salida (CU-06/CU-07) y anular un cobro (CU-21).
 */
export function HabitacionOcupada({
  habitacion,
  ocupacion,
  sesion,
  metodos,
  onTerminado,
  onCerrar,
}: Props) {
  const [vista, setVista] = useState<Vista>("resumen");
  const ahora = useAhoraServidor();
  const { alquiler, tickets } = ocupacion;
  const temporal = calcularEstadoTemporal(alquiler, ahora.toISOString());
  const restante = Date.parse(alquiler.salidaProgramadaEn) - ahora.getTime();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Habitación {habitacion.numero}</CardTitle>
          <Badge className={ESTADO_TEMPORAL[temporal].insignia}>
            {ESTADO_TEMPORAL[temporal].etiqueta}
          </Badge>
        </div>
        <CardDescription>
          Ingresó {hora(alquiler.ingresoEn)} · sale{" "}
          {hora(alquiler.salidaProgramadaEn)} ·{" "}
          {restante >= 0
            ? `faltan ${duracion(restante)}`
            : `pasó ${duracion(restante)}`}
          {alquiler.origenPrecio === "PRECIO_ESPECIAL"
            ? " · precio especial"
            : ""}
        </CardDescription>
      </CardHeader>
      {vista === "resumen" && (
        <>
          <CardContent className="flex flex-col gap-2 text-sm">
            {temporal === "EN_SOBRETIEMPO" && (
              <Aviso tipo="error">
                Sobretiempo: cobre una hora adicional o registre la salida sin
                pago (RN-12).
              </Aviso>
            )}
            <ListaTickets
              tickets={tickets}
              puedeReimprimir={tienePermiso(sesion, "tickets.reprint")}
            />
          </CardContent>
          <CardFooter className="grid grid-cols-2 gap-2">
            <Button onClick={() => setVista("hora")}>Hora adicional</Button>
            <Button variant="secondary" onClick={() => setVista("salida")}>
              Dar salida
            </Button>
            <Button variant="outline" onClick={() => setVista("anular")}>
              Anular un cobro
            </Button>
            <Button variant="ghost" onClick={onCerrar}>
              Cerrar
            </Button>
          </CardFooter>
        </>
      )}
      {vista === "hora" && (
        <HoraAdicional
          alquilerId={alquiler.id}
          sesion={sesion}
          metodos={metodos}
          onTerminado={(salidaNueva) =>
            onTerminado(
              `Hora adicional cobrada: habitación ${habitacion.numero}, ahora sale a las ${hora(salidaNueva)}.`,
            )
          }
          onVolver={() => setVista("resumen")}
        />
      )}
      {vista === "salida" && (
        <Salida
          alquilerId={alquiler.id}
          enSobretiempo={temporal === "EN_SOBRETIEMPO"}
          onTerminado={() =>
            onTerminado(
              `Salida registrada: la habitación ${habitacion.numero} queda por limpiar.`,
            )
          }
          onCobrarHora={() => setVista("hora")}
          onVolver={() => setVista("resumen")}
        />
      )}
      {vista === "anular" && (
        <Anular
          tickets={tickets}
          sesion={sesion}
          onTerminado={(numero, devolucion) =>
            onTerminado(
              `Ticket ${numero} anulado. Devolver ${soles(Math.abs(devolucion))} al cliente.`,
            )
          }
          onVolver={() => setVista("resumen")}
        />
      )}
    </Card>
  );
}

/** Cobros del alquiler; quien tiene `tickets.reprint` puede reimprimir uno, marcado como COPIA (CU-22). */
function ListaTickets({
  tickets,
  puedeReimprimir,
}: {
  tickets: readonly Ticket[];
  puedeReimprimir: boolean;
}) {
  const [aviso, setAviso] = useState<string | null>(null);
  const reimprimir = async (ticket: Ticket) => {
    try {
      await servidor.reimprimir(ticket.id);
      setAviso(`Copia del ticket #${ticket.numero} enviada a la impresora.`);
    } catch (e) {
      setAviso(mensajeDe(e));
    }
  };
  return (
    <>
      {aviso !== null && (
        <p className="text-xs text-muted-foreground">{aviso}</p>
      )}
      <ul className="flex flex-col divide-y rounded-md border bg-background">
        {tickets.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-2 px-3 py-2"
          >
            <span
              className={
                t.estado === "ANULADO"
                  ? "text-muted-foreground line-through"
                  : ""
              }
            >
              #{t.numero} ·{" "}
              {t.tipo === "COMPENSATORIO" ? "Anulación" : ORIGEN[t.origen]} ·{" "}
              {hora(t.creadoEn)}
            </span>
            <span className="flex items-center gap-2">
              <span
                className={
                  t.estado === "ANULADO"
                    ? "text-muted-foreground line-through"
                    : ""
                }
              >
                {soles(t.total)}
              </span>
              {puedeReimprimir && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Reimprimir ticket ${t.numero}`}
                  onClick={() => void reimprimir(t)}
                >
                  Reimprimir
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** CU-05: el tipo (extensión anticipada o liquidación de sobretiempo) y la nueva salida los decide el servidor. */
function HoraAdicional({
  alquilerId,
  sesion,
  metodos,
  onTerminado,
  onVolver,
}: {
  alquilerId: string;
  sesion: Sesion;
  metodos: readonly MetodoPago[];
  onTerminado: (salidaNueva: string) => void;
  onVolver: () => void;
}) {
  const [cotizacion, setCotizacion] =
    useState<CotizacionHoraAdicionalRespuesta | null>(null);
  const [ajuste, setAjuste] = useState<AjusteEntrada | null>(null);
  const [pago, setPago] = useState<PagoEntrada | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [clave, renovarClave] = useClaveIdempotencia();

  useEffect(() => {
    servidor
      .cotizarHoraAdicional(alquilerId)
      .then(setCotizacion, (e: unknown) => setError(mensajeDe(e)));
  }, [alquilerId]);

  const total = ajuste?.montoAjustado ?? cotizacion?.cotizacion.total ?? 0;

  const confirmar = async () => {
    if (pago === null) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await servidor.registrarHoraAdicional(
        alquilerId,
        { ajuste, pagos: [{ ...pago, monto: total }] },
        clave,
      );
      renovarClave();
      onTerminado(r.alquiler.salidaProgramadaEn);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <CardContent className="flex flex-col gap-3 text-sm">
        {error !== null && <Aviso tipo="error">{error}</Aviso>}
        {cotizacion === null ? (
          <p className="text-muted-foreground">Calculando…</p>
        ) : (
          <>
            <div className="rounded-md bg-muted/50 p-3">
              <p className="font-medium">
                {cotizacion.tipo === "EXTENSION_ANTICIPADA"
                  ? "Extiende la estadía una hora"
                  : "Liquida el sobretiempo"}
              </p>
              <p className="text-muted-foreground">
                Salida: {hora(cotizacion.salidaAnterior)} →{" "}
                <span className="font-semibold text-foreground">
                  {hora(cotizacion.salidaNueva)}
                </span>
              </p>
              <p className="mt-2 flex justify-between text-base font-semibold">
                <span>Total</span>
                <span>{soles(total)}</span>
              </p>
            </div>
            {tienePermiso(sesion, "rentals.manual_adjustment") && (
              <AjustePuntual
                minimo={cotizacion.cotizacion.total}
                onCambio={setAjuste}
              />
            )}
            <SelectorPago total={total} metodos={metodos} onCambio={setPago} />
          </>
        )}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button
          className="flex-1"
          disabled={cotizacion === null || pago === null || enviando}
          onClick={() => void confirmar()}
        >
          {enviando ? "Cobrando…" : `Cobrar ${soles(total)}`}
        </Button>
        <Button variant="outline" onClick={onVolver}>
          Volver
        </Button>
      </CardFooter>
    </>
  );
}

/**
 * CU-06: salida normal. Si el alquiler está en sobretiempo, el servidor la rechaza (OVERTIME_UNRESOLVED, RN-12):
 * se cobra la hora adicional o se registra la salida sin pago con motivo obligatorio (CU-07).
 */
function Salida({
  alquilerId,
  enSobretiempo,
  onTerminado,
  onCobrarHora,
  onVolver,
}: {
  alquilerId: string;
  enSobretiempo: boolean;
  onTerminado: () => void;
  onCobrarHora: () => void;
  onVolver: () => void;
}) {
  const [sinPago, setSinPago] = useState(enSobretiempo);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const registrar = async () => {
    setEnviando(true);
    setError(null);
    try {
      if (sinPago) await servidor.registrarSalidaSinPago(alquilerId, motivo);
      else await servidor.registrarSalida(alquilerId);
      onTerminado();
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === "OVERTIME_UNRESOLVED")
        setSinPago(true);
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <CardContent className="flex flex-col gap-3 text-sm">
        {error !== null && <Aviso tipo="error">{error}</Aviso>}
        {!sinPago ? (
          <p>La habitación quedará pendiente de limpieza.</p>
        ) : (
          <>
            <p>
              El cliente se retira en sobretiempo sin pagar la hora adicional.
              Queda registrado con su motivo.
            </p>
            <Campo etiqueta="Motivo (obligatorio)">
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </Campo>
            <Button
              variant="link"
              className="self-start px-0"
              onClick={onCobrarHora}
            >
              Mejor cobrar la hora adicional…
            </Button>
          </>
        )}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button
          className="flex-1"
          variant={sinPago ? "destructive" : "default"}
          disabled={enviando || (sinPago && motivo.trim() === "")}
          onClick={() => void registrar()}
        >
          {enviando
            ? "Registrando…"
            : sinPago
              ? "Registrar salida sin pago"
              : "Registrar salida"}
        </Button>
        <Button variant="outline" onClick={onVolver}>
          Volver
        </Button>
      </CardFooter>
    </>
  );
}

/**
 * CU-21: anular un cobro vigente del alquiler. Quien tiene `tickets.void` anula directo; el cajero ingresa el
 * código de autorización que le da el Administrador (RN-46). Las reglas (anular primero las horas antes que
 * el ingreso, código de un solo uso) las aplica el servidor y se muestran sus mensajes.
 */
function Anular({
  tickets,
  sesion,
  onTerminado,
  onVolver,
}: {
  tickets: readonly Ticket[];
  sesion: Sesion;
  onTerminado: (numero: number, devolucion: number) => void;
  onVolver: () => void;
}) {
  const vigentes = tickets
    .filter((t) => t.tipo === "COBRO" && t.estado === "EMITIDO")
    .reverse();
  const [ticketId, setTicketId] = useState<string | null>(
    vigentes[0]?.id ?? null,
  );
  const [motivo, setMotivo] = useState("");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [clave, renovarClave] = useClaveIdempotencia();
  const conCodigo = !tienePermiso(sesion, "tickets.void");

  const anular = async () => {
    if (ticketId === null) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await servidor.anularTicket(
        ticketId,
        { motivo, codigoAutorizacion: conCodigo ? codigo.trim() : null },
        clave,
      );
      renovarClave();
      onTerminado(r.original.numero, r.compensatorio.total);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <CardContent className="flex flex-col gap-3 text-sm">
        {error !== null && <Aviso tipo="error">{error}</Aviso>}
        {vigentes.length === 0 ? (
          <p className="text-muted-foreground">
            No hay cobros vigentes para anular.
          </p>
        ) : (
          <>
            <div
              className="flex flex-col gap-1"
              role="radiogroup"
              aria-label="Cobro a anular"
            >
              {vigentes.map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 has-[:checked]:border-foreground"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="ticket"
                      checked={ticketId === t.id}
                      onChange={() => setTicketId(t.id)}
                    />
                    #{t.numero} · {ORIGEN[t.origen]} · {hora(t.creadoEn)}
                  </span>
                  <span>{soles(t.total)}</span>
                </label>
              ))}
            </div>
            <Campo etiqueta="Motivo (obligatorio)">
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </Campo>
            {conCodigo && (
              <Campo
                etiqueta="Código de autorización"
                ayuda="Lo genera un Administrador; sirve una sola vez y vence en minutos."
              >
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                />
              </Campo>
            )}
          </>
        )}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button
          className="flex-1"
          variant="destructive"
          disabled={
            enviando ||
            ticketId === null ||
            motivo.trim() === "" ||
            (conCodigo && codigo.trim() === "")
          }
          onClick={() => void anular()}
        >
          {enviando ? "Anulando…" : "Anular cobro"}
        </Button>
        <Button variant="outline" onClick={onVolver}>
          Volver
        </Button>
      </CardFooter>
    </>
  );
}
