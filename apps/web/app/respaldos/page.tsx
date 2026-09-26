"use client";

import { useEffect, useState } from "react";
import {
  HORA_RESPALDO_EXTERNO_LIMA,
  INTERVALO_RESPALDO_LOCAL_MINUTOS,
  RETENCION_RESPALDO_EXTERNO_DIAS,
  RETENCION_RESPALDO_LOCAL_HORAS,
  type DestinoRespaldo,
  type EstadoCopiaRespaldo,
} from "@apurimeno/contracts";
import {
  respaldoExternoDesactualizado,
  respaldoLocalDesactualizado,
} from "@apurimeno/domain";
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
import { diaLima, fechaHora, fechaHoraCorta, hace, hora } from "@apurimeno/formato";
import { Aviso, Encabezado } from "../../src/componentes/comunes";
import { useCarga } from "../../src/lib/carga";
import { ERROR_RESPALDO } from "../../src/lib/rotulos";
import { mensajeDe, servidor } from "../../src/lib/servidor";

type Resultado = { tipo: "exito" | "error"; texto: string } | null;

/** "35 KB" o "12,4 MB". */
const tamano = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toLocaleString("es-PE", { maximumFractionDigits: 1 })} MB`;

/**
 * Respaldos de la base (Planos §14.3): cuándo se hizo la última copia local (cada 15 min) y la externa cifrada
 * (diaria, 04:00), si el último intento falló y por qué, y "Copiar ahora". Las copias automáticas siguen
 * corriendo en el servidor aunque nadie abra esta pantalla. Restaurar no se hace desde aquí: exige detener el
 * servidor (docs/RESPALDO_Y_RESTAURACION.md).
 */
export default function Respaldos() {
  const estado = useCarga(() => servidor.estadoRespaldos(), []);
  const [resultado, setResultado] = useState<Resultado>(null);
  const [enviando, setEnviando] = useState<DestinoRespaldo | null>(null);

  const { recargar } = estado;
  useEffect(() => {
    const id = window.setInterval(() => void recargar(), 30_000);
    return () => window.clearInterval(id);
  }, [recargar]);

  const copiar = async (destino: DestinoRespaldo) => {
    setEnviando(destino);
    setResultado(null);
    try {
      const r = await servidor.respaldar(destino);
      const copia = destino === "LOCAL" ? r.estado.local : r.estado.externo;
      setResultado(
        r.exito
          ? {
              tipo: "exito",
              texto: `Copia ${destino === "LOCAL" ? "local" : "externa"} hecha: ${copia.ultimoArchivo ?? ""}.`,
            }
          : {
              tipo: "error",
              texto:
                "No se pudo hacer la copia. El detalle está abajo; el servidor lo vuelve a intentar solo.",
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
  const ahora = new Date();

  return (
    <>
      <Encabezado
        titulo="Respaldos"
        descripcion="Copias completas de la base del local, para recuperarla si el equipo falla. Se hacen solas; aquí se puede ver cómo van y copiar ya."
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
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <TarjetaCopia
            titulo="Copias locales"
            descripcion={`Cada ${INTERVALO_RESPALDO_LOCAL_MINUTOS} minutos, en el disco de este equipo. Se guardan las de las últimas ${RETENCION_RESPALDO_LOCAL_HORAS} horas.`}
            copia={e.local}
            desactualizado={respaldoLocalDesactualizado(
              e.local.ultimoExitoEn,
              ahora,
            )}
            enviando={enviando === "LOCAL"}
            ocupado={enviando !== null}
            onCopiar={() => void copiar("LOCAL")}
          />
          <TarjetaCopia
            titulo="Copia externa"
            descripcion={`Una por día a las ${String(HORA_RESPALDO_EXTERNO_LIMA).padStart(2, "0")}:00 (o al encender, si el equipo estaba apagado), comprimida y cifrada, en la carpeta que se sincroniza con la nube. Se guardan ${RETENCION_RESPALDO_EXTERNO_DIAS} días.`}
            copia={e.externo}
            desactualizado={respaldoExternoDesactualizado(
              e.externo.ultimoExitoEn,
              ahora,
            )}
            enviando={enviando === "EXTERNO"}
            ocupado={enviando !== null}
            onCopiar={() => void copiar("EXTERNO")}
          />
          <ComoRestaurar />
        </div>
      )}
    </>
  );
}

/** "en unos segundos", "a las 14:45" (hoy) o "27/09, 04:00". */
function proxima(proximaEn: string | null): string {
  if (proximaEn === null) return "—";
  const ahora = new Date();
  if (Date.parse(proximaEn) - ahora.getTime() < 60_000) return "en unos segundos";
  return diaLima(proximaEn) === diaLima(ahora)
    ? `a las ${hora(proximaEn)}`
    : fechaHoraCorta(proximaEn);
}

function TarjetaCopia({
  titulo,
  descripcion,
  copia,
  desactualizado,
  enviando,
  ocupado,
  onCopiar,
}: {
  titulo: string;
  descripcion: string;
  copia: EstadoCopiaRespaldo;
  desactualizado: boolean;
  enviando: boolean;
  ocupado: boolean;
  onCopiar: () => void;
}) {
  if (!copia.configurado) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{titulo}</CardTitle>
          <CardDescription>{descripcion}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>
              {copia.problemaConfiguracion === null
                ? "No está configurada: hoy las copias solo quedan en este equipo"
                : "Está apagada por un error de configuración"}
            </AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              {copia.problemaConfiguracion !== null && (
                <span className="font-medium">
                  {copia.problemaConfiguracion}
                </span>
              )}
              <span>
                Si el disco de este equipo falla, se pierden la base y sus
                copias locales. Configure RESPALDO_CARPETA_EXTERNA y
                RESPALDO_CLAVE_PUBLICA en apps/server/.env y reinicie el
                servidor.
              </span>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {titulo}
          {copia.copiando && <Badge variant="outline">Copiando…</Badge>}
          {desactualizado && (
            <Badge className="bg-amber-500 text-white">Desactualizado</Badge>
          )}
        </CardTitle>
        <CardDescription>{descripcion}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {copia.ultimoExitoEn === null ? (
          <p className="text-lg font-semibold">
            Todavía no hay ninguna copia.
          </p>
        ) : (
          <div>
            <p className="text-sm text-muted-foreground">Última copia</p>
            <p className="text-3xl font-bold">
              {fechaHora(copia.ultimoExitoEn)}
            </p>
            <p className="text-sm text-muted-foreground">
              {hace(copia.ultimoExitoEn)}
            </p>
          </div>
        )}
        {copia.ultimoError !== null && (
          <Alert variant="destructive">
            <AlertTitle>
              El último intento falló: {ERROR_RESPALDO[copia.ultimoError.codigo]}
            </AlertTitle>
            <AlertDescription>
              <p>{copia.ultimoError.mensaje}</p>
              <p className="mt-1 text-xs">
                {fechaHora(copia.ultimoError.ocurridoEn)}. El local sigue
                funcionando igual; el servidor lo vuelve a intentar solo.
              </p>
            </AlertDescription>
          </Alert>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Carpeta</dt>
          <dd className="break-all font-mono text-xs">{copia.carpeta}</dd>
          <dt className="text-muted-foreground">Guardadas</dt>
          <dd>
            {copia.copiasGuardadas}{" "}
            {copia.copiasGuardadas === 1 ? "copia" : "copias"}
            {copia.ultimoTamanoBytes !== null &&
              ` · la última de ${tamano(copia.ultimoTamanoBytes)}`}
          </dd>
          <dt className="text-muted-foreground">Próxima</dt>
          <dd>{proxima(copia.proximaEn)}</dd>
          <dt className="text-muted-foreground">Último intento</dt>
          <dd>
            {copia.ultimoIntentoEn === null
              ? "—"
              : fechaHora(copia.ultimoIntentoEn)}
          </dd>
        </dl>
      </CardContent>
      <CardFooter>
        <Button disabled={ocupado || copia.copiando} onClick={onCopiar}>
          {enviando ? "Copiando…" : "Copiar ahora"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ComoRestaurar() {
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">Cómo se restaura</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p>
          Restaurar no se hace desde el Dashboard: hay que detener el servidor
          y correr, en la carpeta apps/server, <code>pnpm restaurar</code>. El
          procedimiento completo está en docs/RESPALDO_Y_RESTAURACION.md.
        </p>
        <p className="text-muted-foreground">
          Las copias externas solo se abren con la clave privada de respaldo,
          que está en el gestor de contraseñas de la propietaria. Este equipo
          no la tiene.
        </p>
      </CardContent>
    </Card>
  );
}
