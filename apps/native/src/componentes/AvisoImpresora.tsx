import { useCallback, useEffect, useState } from "react";
import {
  MENSAJE_FALLA_IMPRESORA,
  type EstadoImpresora,
} from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import { mensajeDe, servidor } from "../lib/servidor";

/** Cada cuánto se pregunta por la impresora. El servidor reintenta solo cada 30 s; esto solo muestra cómo va. */
const INTERVALO_ESTADO_MS = 10_000;
/** Tras un cobro, el comprobante sale en uno o dos segundos: se revisa enseguida para avisar sin esperar. */
const REVISION_TRAS_COBRO_MS = 2_500;

interface Props {
  /** Cambia con cada cobro o reimpresión: el aviso se revisa poco después. */
  revision: number;
}

/**
 * Aviso de la impresora (RF-56, decisión 26 de contracts): si el último comprobante no salió, dice por qué y qué
 * hacer, en palabras del cajero, nunca con códigos ni luces. Los comprobantes pendientes se imprimen solos al
 * resolverlo; "Reintentar ahora" no espera a la próxima vuelta. Si la impresora quedó sin configurar por un error
 * en el servidor, avisa que no sale nada (sin el detalle técnico, que está en el Dashboard). Sin impresora
 * configurada a propósito, no muestra nada: eso es de la instalación, no del cajero.
 */
export function AvisoImpresora({ revision }: Props) {
  const [estado, setEstado] = useState<EstadoImpresora | null>(null);
  const [reintentando, setReintentando] = useState(false);
  const [problema, setProblema] = useState<string | null>(null);

  const consultar = useCallback(async () => {
    try {
      setEstado(await servidor.estadoImpresora());
    } catch {
      // Sin conexión con el servidor ya lo avisa el tablero; este aviso no lo repite.
    }
  }, []);

  useEffect(() => {
    void consultar();
    const id = window.setInterval(() => void consultar(), INTERVALO_ESTADO_MS);
    return () => window.clearInterval(id);
  }, [consultar]);

  useEffect(() => {
    if (revision === 0) return;
    const id = window.setTimeout(() => void consultar(), REVISION_TRAS_COBRO_MS);
    return () => window.clearTimeout(id);
  }, [revision, consultar]);

  const reintentar = async () => {
    setReintentando(true);
    setProblema(null);
    try {
      setEstado(await servidor.reintentarImpresion());
    } catch (error) {
      setProblema(mensajeDe(error));
    } finally {
      setReintentando(false);
    }
  };

  if (estado === null) return null;
  // Un error en la configuración del servidor no lo arregla el cajero, pero tiene que saber que no sale nada.
  if (estado.problemaConfiguracion !== null)
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
      >
        <p className="font-semibold">
          La impresora no está bien configurada: no se imprimen los
          comprobantes.
        </p>
        <p>
          Los cobros se registran igual. Avise a la administración para que la
          revise.
        </p>
      </div>
    );
  if (!estado.configurada || estado.causa === null) return null;
  const pendientes = estado.comprobantesEnEspera;
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950"
    >
      <div className="space-y-1">
        <p className="font-semibold">
          {pendientes > 0
            ? `La impresora no imprimió ${pendientes === 1 ? "el último comprobante" : `${pendientes} comprobantes`}.`
            : "La impresora no está lista."}
        </p>
        <p>{MENSAJE_FALLA_IMPRESORA[estado.causa]}</p>
        {pendientes > 0 && (
          <p className="text-amber-900">
            {pendientes === 1 ? "Se imprimirá" : "Se imprimirán"} solo al
            resolverlo. El cobro ya quedó registrado.
          </p>
        )}
        {problema !== null && <p className="text-destructive">{problema}</p>}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={reintentando}
        onClick={() => void reintentar()}
      >
        {reintentando ? "Reintentando…" : "Reintentar ahora"}
      </Button>
    </div>
  );
}
