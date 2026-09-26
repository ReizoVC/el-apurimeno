import { useCallback, useEffect, useState } from "react";
import { registrarSesionInvalida, usarSesion } from "./lib/servidor";
import {
  borrarSesion,
  guardarSesion,
  leerSesion,
  type Sesion,
} from "./lib/sesion";
import { Login } from "./pantallas/Login";
import { Principal } from "./pantallas/Principal";

type Estado =
  | { tipo: "sin-sesion"; aviso: string | null }
  | { tipo: "con-sesion"; sesion: Sesion };

/** Sesión del POS: sin sesión, el login; con sesión, la pantalla principal. Un 401 vuelve al login. */
export default function App() {
  const [estado, setEstado] = useState<Estado>(() => {
    const sesion = leerSesion();
    usarSesion(sesion);
    return sesion === null
      ? { tipo: "sin-sesion", aviso: null }
      : { tipo: "con-sesion", sesion };
  });

  const entrar = useCallback((sesion: Sesion) => {
    guardarSesion(sesion);
    usarSesion(sesion);
    setEstado({ tipo: "con-sesion", sesion });
  }, []);

  const salir = useCallback((aviso: string | null) => {
    borrarSesion();
    usarSesion(null);
    setEstado({ tipo: "sin-sesion", aviso });
  }, []);

  useEffect(() => {
    registrarSesionInvalida(() =>
      salir("La sesión venció o la cuenta fue desactivada. Vuelva a ingresar."),
    );
  }, [salir]);

  if (estado.tipo === "sin-sesion")
    return <Login avisoInicial={estado.aviso} onSesion={entrar} />;
  return <Principal sesion={estado.sesion} onSalir={() => salir(null)} />;
}
