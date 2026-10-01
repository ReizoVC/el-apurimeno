"use client";

import { useEffect } from "react";
import { MENSAJE_FALLA_IMPRESORA } from "@apurimeno/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@apurimeno/ui/components/alert";
import { useCarga } from "../lib/carga";
import { servidor } from "../lib/servidor";
import { tienePermiso, useSesion } from "./Shell";

/** Cada cuánto se vuelve a preguntar, como el resto de la Vista general. */
const INTERVALO_MS = 30_000;

/**
 * Aviso de la impresora en la Vista general (RF-56, RNF-OBS-01; decisión 26 de contracts). Lo que solo quedaría en
 * el registro del servidor se muestra aquí: un IMPRESORA_DISPOSITIVO o un IMPRESORA_LOGO con error (el servidor
 * arrancó igual), una impresora sin configurar, o la causa del último comprobante que no salió. Si todo está
 * bien, no muestra nada.
 */
export function AvisoImpresora() {
  const sesion = useSesion();
  // La ruta la pueden consultar quienes ven el tablero o configuran el sistema.
  const puedeVer =
    tienePermiso(sesion, "pos.access") ||
    tienePermiso(sesion, "settings.manage");
  const estado = useCarga(
    async () => (puedeVer ? servidor.estadoImpresora() : null),
    [puedeVer],
  );
  const { recargar } = estado;
  useEffect(() => {
    const id = window.setInterval(() => void recargar(), INTERVALO_MS);
    return () => window.clearInterval(id);
  }, [recargar]);

  const e = estado.datos;
  if (e === null) return null;
  const avisos: {
    clave: string;
    variante: "destructive" | "warning";
    titulo: string;
    texto: string;
  }[] = [];
  if (e.problemaConfiguracion !== null) {
    avisos.push({
      clave: "configuracion",
      variante: "destructive",
      titulo:
        "La impresora está mal configurada: no se imprime ningún comprobante",
      texto: `${e.problemaConfiguracion} Corrija IMPRESORA_DISPOSITIVO en apps/server/.env y reinicie el servidor. Los cobros se registran igual.`,
    });
  } else if (!e.configurada) {
    avisos.push({
      clave: "sin-configurar",
      variante: "warning",
      titulo: "No hay impresora configurada",
      texto:
        "Los comprobantes quedan en cola sin imprimir. Se configura con IMPRESORA_DISPOSITIVO en apps/server/.env.",
    });
  } else if (e.causa !== null) {
    const espera =
      e.comprobantesEnEspera === 0
        ? ""
        : ` ${e.comprobantesEnEspera === 1 ? "Un comprobante espera" : `${e.comprobantesEnEspera} comprobantes esperan`} para imprimirse; salen solos al resolverlo.`;
    avisos.push({
      clave: "causa",
      variante: "warning",
      titulo: "El último comprobante no se imprimió",
      texto: `${MENSAJE_FALLA_IMPRESORA[e.causa]}${espera}`,
    });
  }
  if (e.problemaLogo !== null) {
    avisos.push({
      clave: "logo",
      variante: "warning",
      titulo: "Los comprobantes salen sin logotipo",
      texto: `${e.problemaLogo} Revise IMPRESORA_LOGO en apps/server/.env (vacío usa el del negocio) y reinicie el servidor.`,
    });
  }
  if (avisos.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {avisos.map((a) => (
        <Alert key={a.clave} variant={a.variante}>
          <AlertTitle>{a.titulo}</AlertTitle>
          <AlertDescription>{a.texto}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
