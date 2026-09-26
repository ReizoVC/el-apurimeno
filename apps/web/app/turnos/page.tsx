"use client";

import { useState } from "react";
import type { Turno } from "@apurimeno/contracts";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apurimeno/ui/components/table";
import { Aviso, Campo, Encabezado } from "../../src/componentes/comunes";
import { useSesion } from "../../src/componentes/Shell";
import { useCarga } from "../../src/lib/carga";
import { fechaHora, leerSoles, soles } from "@apurimeno/formato";
import { nombresDeUsuarios } from "../../src/lib/nombres";
import { mensajeDe, servidor } from "../../src/lib/servidor";

/** Horas que lleva abierto un turno, para detectar uno abandonado a simple vista. */
function antiguedad(abiertoEn: string): string {
  const minutos = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(abiertoEn)) / 60_000),
  );
  return minutos < 60
    ? `${minutos} min`
    : `${Math.floor(minutos / 60)} h ${minutos % 60} min`;
}

/**
 * Turnos abiertos y cierre forzado (CU-20; RF-43). El esperado de un turno abierto no se muestra (RN-34): se
 * conoce recién al cerrarlo. El propio turno no se fuerza; se cierra desde el POS con arqueo ciego.
 */
export default function Turnos() {
  const sesion = useSesion();
  const datos = useCarga(async () => {
    const [turnos, nombres] = await Promise.all([
      servidor.turnosAbiertos(),
      nombresDeUsuarios(sesion),
    ]);
    return { turnos, nombres };
  }, [sesion]);
  const [cerrando, setCerrando] = useState<Turno | null>(null);
  const [resultado, setResultado] = useState<{
    turno: Turno;
    cajero: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nombre = (id: string) => datos.datos?.nombres.get(id) ?? id;

  return (
    <>
      <Encabezado
        titulo="Turnos abiertos"
        descripcion="Turnos de caja sin cerrar. Si un cajero se fue sin cerrar el suyo, ciérrelo aquí; queda marcado como forzado."
      >
        <Button variant="outline" onClick={() => void datos.recargar()}>
          Actualizar
        </Button>
      </Encabezado>
      {error !== null && (
        <Aviso tipo="error" onCerrar={() => setError(null)}>
          {error}
        </Aviso>
      )}
      {datos.error !== null && <Aviso tipo="error">{datos.error}</Aviso>}
      {resultado !== null && (
        <ResultadoCierre {...resultado} onCerrar={() => setResultado(null)} />
      )}
      <div className="flex items-start gap-4">
        <Card className="min-w-0 flex-1">
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cajero</TableHead>
                  <TableHead>Abierto</TableHead>
                  <TableHead>Hace</TableHead>
                  <TableHead className="text-right">Efectivo inicial</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {datos.datos?.turnos.map((t) => {
                  const propio = t.usuarioId === sesion.usuario.id;
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        {nombre(t.usuarioId)}
                        {propio && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (su turno)
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{fechaHora(t.abiertoEn)}</TableCell>
                      <TableCell>{antiguedad(t.abiertoEn)}</TableCell>
                      <TableCell className="text-right">
                        {soles(t.efectivoInicial)}
                      </TableCell>
                      <TableCell className="text-right">
                        {propio ? (
                          <span className="text-xs text-muted-foreground">
                            Ciérrelo desde el POS
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCerrando(t)}
                          >
                            Forzar cierre
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {datos.datos?.turnos.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No hay turnos abiertos.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {cerrando !== null && (
          <FormularioCierre
            key={cerrando.id}
            turno={cerrando}
            cajero={nombre(cerrando.usuarioId)}
            onCancelar={() => setCerrando(null)}
            onCerrado={(turno) => {
              setResultado({ turno, cajero: nombre(turno.usuarioId) });
              setCerrando(null);
              setError(null);
              void datos.recargar();
            }}
            onError={setError}
          />
        )}
      </div>
    </>
  );
}

function FormularioCierre({
  turno,
  cajero,
  onCancelar,
  onCerrado,
  onError,
}: {
  turno: Turno;
  cajero: string;
  onCancelar: () => void;
  onCerrado: (t: Turno) => void;
  onError: (texto: string) => void;
}) {
  const [contar, setContar] = useState(false);
  const [contado, setContado] = useState("");
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const centimos = contar ? leerSoles(contado) : null;
  const valido = !contar || centimos !== null;

  const cerrar = async () => {
    setEnviando(true);
    try {
      onCerrado(
        await servidor.forzarCierre(turno.id, {
          efectivoContado: contar ? centimos : null,
          comentario: comentario.trim() === "" ? null : comentario.trim(),
        }),
      );
    } catch (e) {
      onError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Card className="w-96 shrink-0">
      <CardHeader>
        <CardTitle>Forzar cierre del turno de {cajero}</CardTitle>
        <CardDescription>
          Abierto el {fechaHora(turno.abiertoEn)}. Desde el cierre, {cajero} no
          puede cobrar hasta abrir otro turno.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={contar}
            onChange={(e) => setContar(e.target.checked)}
          />
          <span>
            Conté el efectivo del cajón
            <span className="block text-xs text-muted-foreground">
              Si lo cuenta, queda registrada la diferencia; si no, solo el
              efectivo esperado.
            </span>
          </span>
        </label>
        {contar && (
          <Campo etiqueta="Efectivo contado (S/)">
            <Input
              inputMode="decimal"
              autoFocus
              value={contado}
              onChange={(e) => setContado(e.target.value)}
            />
          </Campo>
        )}
        <Campo
          etiqueta="Comentario (opcional)"
          ayuda="Por ejemplo, por qué quedó abierto."
        >
          <Input
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
          />
        </Campo>
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          variant="destructive"
          disabled={!valido || enviando}
          onClick={() => void cerrar()}
        >
          {enviando ? "Cerrando…" : "Forzar cierre"}
        </Button>
        <Button variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
      </CardFooter>
    </Card>
  );
}

/** Resultado del cierre: aquí sí se ve el esperado, porque el turno ya está cerrado. */
function ResultadoCierre({
  turno,
  cajero,
  onCerrar,
}: {
  turno: Turno;
  cajero: string;
  onCerrar: () => void;
}) {
  const diferencia = turno.diferencia;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base">
            Turno de {cajero} cerrado de forma forzada
          </CardTitle>
          <CardDescription>
            {turno.cerradoEn !== null && fechaHora(turno.cerradoEn)}
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onCerrar}>
          Cerrar
        </Button>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-8 text-sm">
        <div>
          <div className="text-muted-foreground">Efectivo esperado</div>
          <div className="text-lg font-semibold">
            {turno.efectivoEsperado === null
              ? "—"
              : soles(turno.efectivoEsperado)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Efectivo contado</div>
          <div className="text-lg font-semibold">
            {turno.efectivoContado === null
              ? "No se contó"
              : soles(turno.efectivoContado)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Diferencia</div>
          <div className="text-lg font-semibold">
            {diferencia === null ? (
              "—"
            ) : diferencia === 0 ? (
              <Badge className="bg-emerald-600 text-white">Cuadra</Badge>
            ) : (
              <Badge variant="destructive">
                {diferencia < 0 ? "Faltan" : "Sobran"}{" "}
                {soles(Math.abs(diferencia))}
              </Badge>
            )}
          </div>
        </div>
        {turno.comentarioCierre !== null && (
          <div>
            <div className="text-muted-foreground">Comentario</div>
            <div>{turno.comentarioCierre}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
