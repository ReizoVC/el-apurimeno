"use client";

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
import { iniciarSesion } from "./api";
import type { Sesion } from "./sesion";

interface Props {
  /** Aviso con el que se llega al login, p. ej. "La sesión venció". */
  avisoInicial: string | null;
  onSesion: (sesion: Sesion) => void;
}

/** Inicio de sesión contra el servidor (RF-31), con la cuenta individual del personal de limpieza. */
export function Login({ avisoInicial, onSesion }: Props) {
  const [nombreUsuario, setNombreUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(avisoInicial);

  const enviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    setEnviando(true);
    setAviso(null);
    try {
      onSesion(await iniciarSesion(nombreUsuario.trim(), contrasena));
    } catch (error) {
      setAviso(
        error instanceof Error ? error.message : "No se pudo iniciar sesión.",
      );
      setContrasena("");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="container mx-auto flex min-h-screen max-w-sm items-center p-4">
      <Card className="w-full">
        <form onSubmit={(evento) => void enviar(evento)}>
          <CardHeader>
            <CardTitle>Limpieza</CardTitle>
            <CardDescription>
              Ingrese con su usuario y contraseña.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {aviso !== null && (
              <p
                role="alert"
                className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {aviso}
              </p>
            )}
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Usuario
              <Input
                name="usuario"
                autoComplete="username"
                autoCapitalize="none"
                required
                value={nombreUsuario}
                onChange={(e) => setNombreUsuario(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Contraseña
              <Input
                name="contrasena"
                type="password"
                autoComplete="current-password"
                required
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
              />
            </label>
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
