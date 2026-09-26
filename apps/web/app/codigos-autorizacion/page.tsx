"use client";

import { useState } from "react";
import type {
  GenerarCodigoAutorizacionRespuesta,
  OperacionAutorizable,
} from "@apurimeno/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@apurimeno/ui/components/alert";
import { Button } from "@apurimeno/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apurimeno/ui/components/card";
import { Aviso, Encabezado } from "../../src/componentes/comunes";
import { OPERACION_AUTORIZABLE } from "../../src/lib/rotulos";
import { hora } from "@apurimeno/formato";
import { mensajeDe, servidor } from "../../src/lib/servidor";

/**
 * Códigos de autorización (RF-65, RN-46; decisión 25): el Administrador genera uno, incluso a distancia, y se lo
 * dicta al cajero. Sirven para anular un cobro (cajero sin tickets.void) o para un intento más de cierre de turno
 * tras 3 rechazos por diferencia. Cada código vale solo para su operación. El servidor solo guarda su hash: el
 * código se ve una sola vez, aquí, y no se guarda en el navegador. Es de un solo uso y vence solo.
 */
export default function CodigosAutorizacion() {
  const [codigo, setCodigo] =
    useState<GenerarCodigoAutorizacionRespuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [operacion, setOperacion] =
    useState<OperacionAutorizable>("ANULAR_TICKET");

  const generar = async () => {
    setGenerando(true);
    setError(null);
    setCodigo(null);
    try {
      setCodigo(await servidor.generarCodigoAutorizacion(operacion));
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGenerando(false);
    }
  };

  return (
    <>
      <Encabezado
        titulo="Códigos de autorización"
        descripcion="Para anular un cobro o reintentar un cierre de turno. Cada código sirve una sola vez y solo para lo que se eligió."
      />
      {error !== null && (
        <Aviso tipo="error" onCerrar={() => setError(null)}>
          {error}
        </Aviso>
      )}
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Generar un código</CardTitle>
          <CardDescription>
            Genere el código solo cuando el cajero lo necesite y díctelo por
            teléfono o en persona. Vence a los minutos que indica la
            configuración.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Para qué es</legend>
            {(Object.keys(OPERACION_AUTORIZABLE) as OperacionAutorizable[]).map(
              (op) => (
                <label key={op} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="operacion"
                    className="mt-1"
                    checked={operacion === op}
                    onChange={() => {
                      setOperacion(op);
                      setCodigo(null);
                    }}
                  />
                  <span>
                    {OPERACION_AUTORIZABLE[op].etiqueta}
                    <span className="block text-xs text-muted-foreground">
                      {OPERACION_AUTORIZABLE[op].descripcion}
                    </span>
                  </span>
                </label>
              ),
            )}
          </fieldset>
          {codigo !== null && (
            <>
              <div className="rounded-md border bg-muted/40 p-4 text-center">
                <div
                  className="font-mono text-4xl font-bold tracking-[0.3em]"
                  aria-label="Código de autorización"
                >
                  {codigo.codigo}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {OPERACION_AUTORIZABLE[codigo.operacion].etiqueta}. Vale una
                  sola vez, hasta las {hora(codigo.expiraEn)}.
                </div>
              </div>
              <Alert variant="warning">
                <AlertTitle>No se puede volver a ver</AlertTitle>
                <AlertDescription>
                  El servidor no guarda el código en claro. Si sale de esta
                  pantalla o genera otro, este ya no se mostrará; si se pierde,
                  genere uno nuevo.
                </AlertDescription>
              </Alert>
            </>
          )}
          <div className="flex gap-2">
            <Button disabled={generando} onClick={() => void generar()}>
              {generando
                ? "Generando…"
                : codigo === null
                  ? "Generar código"
                  : "Generar otro código"}
            </Button>
            {codigo !== null && (
              <Button variant="ghost" onClick={() => setCodigo(null)}>
                Ocultar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
