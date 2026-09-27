"use client";

import { useCallback, useEffect, useState } from "react";
import { MarcoCapacitacion } from "@apurimeno/ui/components/modo-capacitacion";
import { usarEntorno } from "../src/api";
import { Login } from "../src/login";
import { Pendientes } from "../src/pendientes";
import {
  borrarSesion,
  guardarSesion,
  leerSesion,
  type Sesion,
} from "../src/sesion";

type Estado =
  | { tipo: "cargando" }
  | { tipo: "sin-sesion"; aviso: string | null }
  | { tipo: "con-sesion"; sesion: Sesion };

export default function CleaningPage() {
  // La sesión se lee de localStorage después de montar, para que el HTML del servidor y el del
  // navegador coincidan.
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });

  useEffect(() => {
    const sesion = leerSesion();
    usarEntorno(sesion?.entorno ?? "PRODUCCION");
    setEstado(
      sesion === null
        ? { tipo: "sin-sesion", aviso: null }
        : { tipo: "con-sesion", sesion },
    );
  }, []);

  const entrar = useCallback((sesion: Sesion) => {
    guardarSesion(sesion);
    usarEntorno(sesion.entorno);
    setEstado({ tipo: "con-sesion", sesion });
  }, []);

  const salir = useCallback((aviso: string | null) => {
    borrarSesion();
    usarEntorno("PRODUCCION");
    setEstado({ tipo: "sin-sesion", aviso });
  }, []);

  if (estado.tipo === "cargando") return null;
  if (estado.tipo === "sin-sesion") {
    return <Login avisoInicial={estado.aviso} onSesion={entrar} />;
  }
  return (
    <MarcoCapacitacion activo={estado.sesion.entorno === "CAPACITACION"}>
      <Pendientes
        sesion={estado.sesion}
        onSesionInvalida={salir}
        onCerrarSesion={() => salir(null)}
      />
    </MarcoCapacitacion>
  );
}
