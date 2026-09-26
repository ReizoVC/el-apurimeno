"use client";

import { useState } from "react";
import type { ReimpresionRespuesta, Ticket } from "@apurimeno/contracts";
import { Badge } from "@apurimeno/ui/components/badge";
import { Button } from "@apurimeno/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apurimeno/ui/components/card";
import { Input } from "@apurimeno/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apurimeno/ui/components/table";
import { Aviso, Campo, Encabezado } from "../../src/componentes/comunes";
import {
  SelectorPeriodo,
  hoyLima,
  type Dias,
} from "../../src/componentes/Periodo";
import { useCarga } from "../../src/lib/carga";
import { periodoDeDias } from "../../src/lib/fechas";
import { fechaHora, soles } from "../../src/lib/formato";
import { ORIGEN_TICKET } from "../../src/lib/rotulos";
import { mensajeDe, servidor } from "../../src/lib/servidor";

type Busqueda =
  | { tipo: "periodo"; dias: Dias }
  | { tipo: "numero"; numero: number };

const ESTADO_TRABAJO = {
  PENDIENTE: "En cola: la ticketera del servidor la imprimirá en segundos.",
  IMPRESO: "Impresa.",
  ERROR:
    "La ticketera informó un error; revise papel y conexión y vuelva a intentarlo.",
} as const;

/**
 * Reimpresión (CU-22; RF-44): busca un ticket por número o por periodo y encola una copia. La copia dice
 * "COPIA" de forma visible, repite el mismo número y queda auditada; nunca crea un cobro nuevo.
 */
export default function Reimpresion() {
  const hoy = hoyLima();
  const [busqueda, setBusqueda] = useState<Busqueda>({
    tipo: "periodo",
    dias: { desde: hoy, hasta: hoy },
  });
  const [numero, setNumero] = useState("");
  const [elegido, setElegido] = useState<Ticket | null>(null);
  const [copia, setCopia] = useState<{
    ticket: Ticket;
    respuesta: ReimpresionRespuesta;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const tickets = useCarga(
    () =>
      servidor.tickets(
        busqueda.tipo === "numero"
          ? { numero: busqueda.numero }
          : periodoDeDias(busqueda.dias.desde, busqueda.dias.hasta),
      ),
    [busqueda],
  );
  // Nombres de los métodos para el detalle; si no se pueden leer, se muestra el id.
  const metodos = useCarga(() => servidor.metodosPago().catch(() => []), []);
  const nombreMetodo = (id: string) =>
    metodos.datos?.find((m) => m.id === id)?.nombre ?? id;

  const reimprimir = async (t: Ticket) => {
    setEnviando(true);
    setError(null);
    try {
      setCopia({ ticket: t, respuesta: await servidor.reimprimir(t.id) });
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  };
  const numeroValido = /^\d+$/.test(numero.trim()) && Number(numero) > 0;

  return (
    <>
      <Encabezado
        titulo="Reimpresión"
        descripcion="Copia de un comprobante ya emitido, con el mismo número y la marca COPIA."
      />
      <Card>
        <CardContent className="flex flex-wrap items-end gap-6 pt-4">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (numeroValido)
                setBusqueda({ tipo: "numero", numero: Number(numero) });
            }}
          >
            <Campo etiqueta="Número de ticket">
              <Input
                className="w-32"
                inputMode="numeric"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
              />
            </Campo>
            <Button type="submit" disabled={!numeroValido}>
              Buscar
            </Button>
          </form>
          <div className="h-10 w-px bg-border" />
          <SelectorPeriodo
            valor={
              busqueda.tipo === "periodo"
                ? busqueda.dias
                : { desde: hoy, hasta: hoy }
            }
            onCambio={(dias) => setBusqueda({ tipo: "periodo", dias })}
          />
        </CardContent>
      </Card>
      {error !== null && (
        <Aviso tipo="error" onCerrar={() => setError(null)}>
          {error}
        </Aviso>
      )}
      {tickets.error !== null && <Aviso tipo="error">{tickets.error}</Aviso>}
      <div className="flex items-start gap-4">
        <Card className="min-w-0 flex-1">
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N.º</TableHead>
                  <TableHead>Fecha y hora</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.datos?.map((t) => (
                  <TableRow
                    key={t.id}
                    className={`cursor-pointer ${elegido?.id === t.id ? "bg-muted" : ""}`}
                    onClick={() => {
                      setElegido(t);
                      setCopia(null);
                    }}
                  >
                    <TableCell className="font-medium">{t.numero}</TableCell>
                    <TableCell>{fechaHora(t.creadoEn)}</TableCell>
                    <TableCell>
                      {t.tipo === "COMPENSATORIO"
                        ? "Anulación"
                        : ORIGEN_TICKET[t.origen]}
                    </TableCell>
                    <TableCell className="text-right">
                      {soles(t.total)}
                    </TableCell>
                    <TableCell>
                      {t.estado === "ANULADO" ? (
                        <Badge variant="destructive">Anulado</Badge>
                      ) : (
                        <Badge variant="outline">Emitido</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={enviando}
                        onClick={(e) => {
                          e.stopPropagation();
                          setElegido(t);
                          void reimprimir(t);
                        }}
                      >
                        Reimprimir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {tickets.datos?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      {busqueda.tipo === "numero"
                        ? `No existe el ticket ${busqueda.numero}.`
                        : "No hay tickets en este periodo."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {tickets.datos !== null && tickets.datos.length === 50 && (
              <p className="pt-3 text-xs text-muted-foreground">
                Se muestran los 50 más recientes; acote el periodo o busque por
                número.
              </p>
            )}
          </CardContent>
        </Card>
        {copia !== null ? (
          <Card className="max-w-full shrink-0">
            <CardHeader>
              <CardTitle className="text-base">
                Copia del ticket {copia.ticket.numero}
              </CardTitle>
              <CardDescription>
                {ESTADO_TRABAJO[copia.respuesta.trabajo.estado]}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-md border bg-white p-3 font-mono text-xs leading-snug text-black">
                {copia.respuesta.contenido.join("\n")}
              </pre>
            </CardContent>
          </Card>
        ) : (
          elegido !== null && (
            <DetalleTicket ticket={elegido} nombreMetodo={nombreMetodo} />
          )
        )}
      </div>
    </>
  );
}

function DetalleTicket({
  ticket,
  nombreMetodo,
}: {
  ticket: Ticket;
  nombreMetodo: (id: string) => string;
}) {
  return (
    <Card className="w-96 shrink-0">
      <CardHeader>
        <CardTitle className="text-base">Ticket {ticket.numero}</CardTitle>
        <CardDescription>
          {fechaHora(ticket.creadoEn)}
          {ticket.anulacion !== null &&
            ` · anulado: ${ticket.anulacion.motivo}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1">
          {ticket.lineas.map((l) => (
            <div key={l.id} className="flex justify-between gap-3">
              <span>
                {l.descripcion}
                {l.cantidad > 1 && (
                  <span className="text-muted-foreground"> × {l.cantidad}</span>
                )}
              </span>
              <span>{soles(l.importe)}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between border-t pt-2 font-semibold">
          <span>Total</span>
          <span>{soles(ticket.total)}</span>
        </div>
        <div className="flex flex-col gap-1 text-muted-foreground">
          {ticket.pagos.map((p) => (
            <div key={p.id} className="flex justify-between gap-3">
              <span>
                {nombreMetodo(p.metodoPagoId)}
                {p.referencia !== null && ` · op. ${p.referencia}`}
              </span>
              <span>{soles(p.monto)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
