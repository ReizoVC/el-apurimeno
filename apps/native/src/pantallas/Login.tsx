import { useState, type FormEvent } from "react";
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
import { Aviso } from "../componentes/Aviso";
import { Campo } from "../componentes/Campo";
import { ErrorApi, mensajeDe, servidor } from "../lib/servidor";
import type { Sesion } from "../lib/sesion";

interface Props {
  avisoInicial: string | null;
  onSesion: (sesion: Sesion) => void;
}

/** Inicio de sesión con la cuenta individual del cajero (RN-40, RF-31). Solo entran cuentas con `pos.access`. */
export function Login({ avisoInicial, onSesion }: Props) {
  const [nombreUsuario, setNombreUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(avisoInicial);

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    setEnviando(true);
    setAviso(null);
    try {
      const r = await servidor.login(nombreUsuario.trim(), contrasena);
      if (!r.permisos.includes("pos.access")) {
        throw new ErrorApi(
          403,
          "PERMISO_DENEGADO",
          "Esta cuenta no tiene acceso al punto de venta.",
        );
      }
      onSesion({ token: r.token, usuario: r.usuario, permisos: r.permisos });
    } catch (error) {
      setAviso(mensajeDe(error));
      setContrasena("");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <form onSubmit={(e) => void enviar(e)}>
          <CardHeader>
            <CardTitle>El Apurimeño</CardTitle>
            <CardDescription>
              Punto de venta. Ingrese con su usuario y contraseña.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {aviso !== null && <Aviso tipo="error">{aviso}</Aviso>}
            <Campo etiqueta="Usuario">
              <Input
                name="usuario"
                autoComplete="username"
                autoFocus
                required
                value={nombreUsuario}
                onChange={(e) => setNombreUsuario(e.target.value)}
              />
            </Campo>
            <Campo etiqueta="Contraseña">
              <Input
                name="contrasena"
                type="password"
                autoComplete="current-password"
                required
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
              />
            </Campo>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={enviando}>
              {enviando ? "Ingresando…" : "Ingresar"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
