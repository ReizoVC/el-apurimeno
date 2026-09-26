import { useState } from "react";
import type {
  MovimientoCaja,
  TipoMovimientoCaja,
  Turno,
} from "@apurimeno/contracts";
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
import { Aviso } from "../componentes/Aviso";
import { Campo } from "../componentes/Campo";
import { fechaHora, hora, leerSoles, soles } from "../lib/formato";
import { useClaveIdempotencia } from "../lib/idempotencia";
import { ErrorApi, mensajeDe, servidor } from "../lib/servidor";

/** Apertura del turno (CU-02, RN-32): sin turno abierto no se cobra nada, así que el POS empieza aquí. */
export function AbrirTurno({
  aviso,
  onAbierto,
}: {
  aviso: string | null;
  onAbierto: (turno: Turno) => void;
}) {
  const [inicial, setInicial] = useState("");
  const [error, setError] = useState<string | null>(aviso);
  const [enviando, setEnviando] = useState(false);
  const centimos = leerSoles(inicial);

  const abrir = async () => {
    if (centimos === null) return;
    setEnviando(true);
    setError(null);
    try {
      onAbierto(await servidor.abrirTurno(centimos));
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Abrir turno de caja</CardTitle>
          <CardDescription>
            Cuente el efectivo con el que empieza el cajón.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error !== null && <Aviso tipo="error">{error}</Aviso>}
          <Campo etiqueta="Efectivo inicial (S/)">
            <Input
              inputMode="decimal"
              autoFocus
              value={inicial}
              onChange={(e) => setInicial(e.target.value)}
              placeholder="0.00"
            />
          </Campo>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            disabled={centimos === null || enviando}
            onClick={() => void abrir()}
          >
            {enviando ? "Abriendo…" : "Abrir turno"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

interface Props {
  turno: Turno;
  /** El turno quedó cerrado: se vuelve a la apertura. */
  onCerrado: () => void;
}

/**
 * Caja del turno abierto: movimientos manuales de efectivo (CU-18, RF-42) y cierre con arqueo ciego (CU-19,
 * RN-34): el cajero ingresa lo contado sin ver el esperado; el esperado y la diferencia se muestran recién
 * con el turno ya cerrado.
 */
export function Caja({ turno, onCerrado }: Props) {
  const [movimientos, setMovimientos] = useState<MovimientoCaja[]>([]);
  const [cerrado, setCerrado] = useState<Turno | null>(null);

  if (cerrado !== null)
    return <ResultadoCierre turno={cerrado} onContinuar={onCerrado} />;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Turno abierto</CardTitle>
          <CardDescription>
            Desde {fechaHora(turno.abiertoEn)} · efectivo inicial{" "}
            {soles(turno.efectivoInicial)}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <NuevoMovimiento
            onRegistrado={(m) => setMovimientos((prev) => [m, ...prev])}
          />
          {movimientos.length > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Registrados en esta sesión</span>
              <ul className="flex flex-col divide-y rounded-md border">
                {movimientos.map((m) => (
                  <li key={m.id} className="flex justify-between px-3 py-2">
                    <span>
                      {hora(m.creadoEn)} ·{" "}
                      {m.tipo === "INGRESO" ? "Ingreso" : "Retiro"} · {m.motivo}
                    </span>
                    <span>
                      {soles(m.tipo === "INGRESO" ? m.monto : -m.monto)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      <CerrarTurno onCerrado={setCerrado} />
    </div>
  );
}

function NuevoMovimiento({
  onRegistrado,
}: {
  onRegistrado: (m: MovimientoCaja) => void;
}) {
  const [tipo, setTipo] = useState<TipoMovimientoCaja>("RETIRO");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [clave, renovarClave] = useClaveIdempotencia();
  const centimos = leerSoles(monto);

  const registrar = async () => {
    if (centimos === null) return;
    setEnviando(true);
    setError(null);
    try {
      onRegistrado(
        await servidor.registrarMovimiento(
          { tipo, monto: centimos, motivo },
          clave,
        ),
      );
      renovarClave();
      setMonto("");
      setMotivo("");
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <span className="text-sm font-medium">Movimiento manual de efectivo</span>
      {error !== null && <Aviso tipo="error">{error}</Aviso>}
      <div
        className="flex gap-2"
        role="radiogroup"
        aria-label="Tipo de movimiento"
      >
        {(["RETIRO", "INGRESO"] as const).map((t) => (
          <Button
            key={t}
            type="button"
            role="radio"
            aria-checked={tipo === t}
            variant={tipo === t ? "default" : "outline"}
            size="sm"
            onClick={() => setTipo(t)}
          >
            {t === "RETIRO" ? "Retiro" : "Ingreso"}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-[8rem_1fr] gap-2">
        <Campo etiqueta="Monto (S/)">
          <Input
            inputMode="decimal"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Motivo (obligatorio)">
          <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Campo>
      </div>
      <Button
        className="self-start"
        disabled={
          centimos === null ||
          centimos === 0 ||
          motivo.trim() === "" ||
          enviando
        }
        onClick={() => void registrar()}
      >
        Registrar {tipo === "RETIRO" ? "retiro" : "ingreso"}
      </Button>
    </div>
  );
}

/**
 * Arqueo ciego. Si lo contado no coincide con el esperado, el servidor exige un comentario (REASON_REQUIRED,
 * decisión 15): el POS lo pide sin revelar el monto esperado ni la diferencia.
 */
function CerrarTurno({ onCerrado }: { onCerrado: (turno: Turno) => void }) {
  const [contado, setContado] = useState("");
  const [comentario, setComentario] = useState("");
  const [pideComentario, setPideComentario] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const centimos = leerSoles(contado);

  const cerrar = async () => {
    if (centimos === null) return;
    setEnviando(true);
    setError(null);
    try {
      onCerrado(
        await servidor.cerrarTurno({
          efectivoContado: centimos,
          comentario: comentario.trim() === "" ? null : comentario.trim(),
        }),
      );
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === "REASON_REQUIRED") {
        setPideComentario(true);
        setError(
          "El efectivo contado no coincide con el esperado. Vuelva a contar o explique la diferencia en un comentario.",
        );
      } else setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cerrar turno</CardTitle>
        <CardDescription>
          Cuente todo el efectivo del cajón. El sistema no muestra cuánto espera
          hasta cerrar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error !== null && <Aviso tipo="error">{error}</Aviso>}
        <Campo etiqueta="Efectivo contado (S/)">
          <Input
            inputMode="decimal"
            value={contado}
            onChange={(e) => setContado(e.target.value)}
          />
        </Campo>
        <Campo
          etiqueta={pideComentario ? "Comentario (obligatorio)" : "Comentario"}
          ayuda="Obligatorio si el conteo no coincide."
        >
          <Input
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
          />
        </Campo>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          variant="secondary"
          disabled={
            centimos === null ||
            enviando ||
            (pideComentario && comentario.trim() === "")
          }
          onClick={() => void cerrar()}
        >
          {enviando ? "Cerrando…" : "Cerrar turno"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ResultadoCierre({
  turno,
  onContinuar,
}: {
  turno: Turno;
  onContinuar: () => void;
}) {
  const filas: [string, string][] = [
    ["Efectivo inicial", soles(turno.efectivoInicial)],
    ["Efectivo esperado", soles(turno.efectivoEsperado ?? 0)],
    ["Efectivo contado", soles(turno.efectivoContado ?? 0)],
    ["Diferencia", soles(turno.diferencia ?? 0)],
  ];
  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Turno cerrado</CardTitle>
        <CardDescription>
          {turno.cerradoEn !== null
            ? `Cerrado ${fechaHora(turno.cerradoEn)}`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {filas.map(([etiqueta, valor]) => (
          <div key={etiqueta} className="flex justify-between">
            <span>{etiqueta}</span>
            <span
              className={
                etiqueta === "Diferencia" && turno.diferencia !== 0
                  ? "font-semibold text-destructive"
                  : "font-medium"
              }
            >
              {valor}
            </span>
          </div>
        ))}
        {turno.comentarioCierre !== null && (
          <p className="text-muted-foreground">
            Comentario: {turno.comentarioCierre}
          </p>
        )}
      </CardContent>
      <CardFooter>
        <Button className="w-full" onClick={onContinuar}>
          Continuar
        </Button>
      </CardFooter>
    </Card>
  );
}
