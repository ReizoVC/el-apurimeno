"use client";

import { useState } from "react";
import type { GenerarCodigoAutorizacionRespuesta } from "@apurimeno/contracts";
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
import { hora } from "@apurimeno/formato";
import { mensajeDe, servidor } from "../../src/lib/servidor";

/**
 * Códigos de autorización de anulación (RF-65, RN-46): el Administrador genera uno, incluso a distancia, y se
 * lo dicta al cajero que no tiene tickets.void. El servidor solo guarda su hash: el código se ve una sola vez,
 * aquí, y no se guarda en el navegador. Es de un solo uso y vence solo.
 */
export default function CodigosAutorizacion() {
  const [codigo, setCodigo] =
    useState<GenerarCodigoAutorizacionRespuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);

  const generar = async () => {
    setGenerando(true);
    setError(null);
    setCodigo(null);
    try {
      setCodigo(await servidor.generarCodigoAutorizacion());
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGenerando(false);
    }
  };

  return (
    <>
      <Encabezado
        titulo="Códigos de anulación"
        descripcion="Para que un cajero sin permiso de anular pueda anular un cobro. Cada código sirve una sola vez."
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
                  Vale una sola vez, hasta las {hora(codigo.expiraEn)}.
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
