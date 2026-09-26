"use client";

import { useEffect, useState } from "react";
import { estaDesactualizado } from "@apurimeno/domain";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@apurimeno/ui/components/alert";
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
import { Aviso, Encabezado } from "../../src/componentes/comunes";
import { useCarga } from "../../src/lib/carga";
import { fechaHora, hace, hora } from "@apurimeno/formato";
import { ERROR_ESPEJO } from "../../src/lib/rotulos";
import { mensajeDe, servidor } from "../../src/lib/servidor";

type Resultado = { tipo: "exito" | "error"; texto: string } | null;

/**
 * Espejo en la nube (ADR-06, RF-60): cuándo se publicó por última vez el resumen que ve la propietaria desde
 * fuera del local, si la última vuelta falló y por qué, y los botones para publicar ya. La sincronización
 * automática sigue corriendo en el servidor aunque nadie abra esta pantalla.
 */
export default function Espejo() {
  const estado = useCarga(() => servidor.estadoEspejo(), []);
  const [resultado, setResultado] = useState<Resultado>(null);
  const [enviando, setEnviando] = useState<"normal" | "completo" | null>(null);
  const [confirmarCompleto, setConfirmarCompleto] = useState(false);

  // La automática puede correr en cualquier momento: el estado se refresca solo.
  const { recargar } = estado;
  useEffect(() => {
    const id = window.setInterval(() => void recargar(), 30_000);
    return () => window.clearInterval(id);
  }, [recargar]);

  const sincronizar = async (completo: boolean) => {
    setEnviando(completo ? "completo" : "normal");
    setResultado(null);
    setConfirmarCompleto(false);
    try {
      const r = await servidor.sincronizarEspejo(completo);
      setResultado(
        r.exito
          ? {
              tipo: "exito",
              texto: `Publicado: ${r.diasPublicados} ${r.diasPublicados === 1 ? "día" : "días"} y ${r.turnosPublicados} ${r.turnosPublicados === 1 ? "turno" : "turnos"}${completo ? " (todo el historial)" : ""}.`,
            }
          : {
              tipo: "error",
              texto:
                "No se pudo publicar. El detalle está abajo; la próxima vuelta automática lo vuelve a intentar.",
            },
      );
    } catch (e) {
      setResultado({ tipo: "error", texto: mensajeDe(e) });
    } finally {
      setEnviando(null);
      await recargar();
    }
  };

  const e = estado.datos;
  const ocupado = enviando !== null || e?.sincronizando === true;

  return (
    <>
      <Encabezado
        titulo="Espejo en la nube"
        descripcion="El resumen que la propietaria ve desde fuera del local. Se publica solo cada cierto tiempo; aquí se puede publicar ya."
      />
      {resultado !== null && (
        <Aviso tipo={resultado.tipo} onCerrar={() => setResultado(null)}>
          {resultado.texto}
        </Aviso>
      )}
      {estado.error !== null && <Aviso tipo="error">{estado.error}</Aviso>}
      {e === null ? (
        estado.error === null && (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        )
      ) : !e.configurado ? (
        <SinConfigurar problema={e.problemaConfiguracion} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_22rem]">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                Última publicación correcta
                {e.sincronizando && (
                  <Badge variant="outline">Sincronizando…</Badge>
                )}
                {estaDesactualizado(
                  e.ultimoExitoEn,
                  e.intervaloMinutos,
                  new Date(),
                ) && (
                  <Badge className="bg-amber-500 text-white">
                    Desactualizado
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Es la hora que ve la propietaria: los datos del espejo son los
                del local a esa hora.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {e.ultimoExitoEn === null ? (
                <p className="text-lg font-semibold">
                  Todavía no se publicó nada.
                </p>
              ) : (
                <div>
                  <p className="text-3xl font-bold">
                    {fechaHora(e.ultimoExitoEn)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {hace(e.ultimoExitoEn)}
                  </p>
                </div>
              )}
              {e.ultimoError !== null && (
                <Alert variant="destructive">
                  <AlertTitle>
                    La última vuelta falló: {ERROR_ESPEJO[e.ultimoError.codigo]}
                  </AlertTitle>
                  <AlertDescription>
                    <p>{e.ultimoError.mensaje}</p>
                    <p className="mt-1 text-xs">
                      {fechaHora(e.ultimoError.ocurridoEn)}. El local sigue
                      funcionando igual; la propietaria ve lo último que se
                      publicó bien.
                    </p>
                  </AlertDescription>
                </Alert>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Automática</dt>
                <dd>
                  cada {e.intervaloMinutos} min
                  {e.proximaEn !== null &&
                    ` · próxima a las ${hora(e.proximaEn)}`}
                </dd>
                <dt className="text-muted-foreground">Último intento</dt>
                <dd>
                  {e.ultimoIntentoEn === null
                    ? "—"
                    : fechaHora(e.ultimoIntentoEn)}
                </dd>
              </dl>
            </CardContent>
            <CardFooter className="flex flex-col items-start gap-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={ocupado}
                  onClick={() => void sincronizar(false)}
                >
                  {enviando === "normal"
                    ? "Sincronizando…"
                    : "Sincronizar ahora"}
                </Button>
                <Button
                  variant="outline"
                  disabled={ocupado}
                  onClick={() => setConfirmarCompleto(true)}
                >
                  {enviando === "completo"
                    ? "Re-sincronizando…"
                    : "Re-sincronizar todo"}
                </Button>
              </div>
              {confirmarCompleto && (
                <Alert variant="warning">
                  <AlertTitle>¿Volver a publicar todo el historial?</AlertTitle>
                  <AlertDescription className="flex flex-col gap-2">
                    <span>
                      Solo hace falta si el espejo quedó desfasado o se
                      restauró. No borra nada: reemplaza cada día y cada turno
                      con lo que hay en el local. Tarda más que una
                      sincronización normal.
                    </span>
                    <span className="flex gap-2">
                      <Button size="sm" onClick={() => void sincronizar(true)}>
                        Sí, re-sincronizar todo
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmarCompleto(false)}
                      >
                        Cancelar
                      </Button>
                    </span>
                  </AlertDescription>
                </Alert>
              )}
            </CardFooter>
          </Card>
          <QueSePublica />
        </div>
      )}
    </>
  );
}

function SinConfigurar({ problema }: { problema: string | null }) {
  return (
    <Alert
      variant={problema === null ? "default" : "destructive"}
      className="max-w-2xl"
    >
      <AlertTitle>
        {problema === null
          ? "El espejo en la nube no está configurado en este servidor"
          : "El espejo en la nube está apagado por un error de configuración"}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        {problema !== null && <span className="font-medium">{problema}</span>}
        <span>
          El local funciona igual; solo no se publica el resumen para la
          propietaria. Las variables ESPEJO_* van en apps/server/.env y la
          cuenta de sincronización se crea como indica supabase/README.md.
          Después hay que reiniciar el servidor.
        </span>
      </AlertDescription>
    </Alert>
  );
}

function QueSePublica() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Qué se publica</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Por día: ventas vigentes por origen y por método de pago, y los
            cobros anulados.
          </li>
          <li>
            Ocupación por habitación: alquileres, horas vendidas e ingresos de
            cada día.
          </li>
          <li>Arqueo de cada turno cerrado, con el cajero y su comentario.</li>
        </ul>
        <p className="text-muted-foreground">
          Nunca salen del local: clientes, tickets, productos, auditoría,
          usuarios, configuración ni qué habitaciones están ocupadas ahora. Los
          turnos abiertos tampoco: su esperado se conoce al cerrar.
        </p>
      </CardContent>
    </Card>
  );
}
