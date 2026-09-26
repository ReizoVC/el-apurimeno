"use client";

import { useState, type FormEvent } from "react";
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
import { Input } from "@apurimeno/ui/components/input";
import { ingresar, mensajeDe, verificarCodigo, type Paso } from "../lib/acceso";

type PasoAcceso = Exclude<Paso, { tipo: "resumen" }>;

/** Pantallas antes del resumen: ingreso, cuenta sin acceso, alta del autenticador y código. */
export function Acceso({
  paso,
  onPaso,
}: {
  paso: PasoAcceso;
  onPaso: (p: Paso) => void;
}) {
  switch (paso.tipo) {
    case "ingreso":
      return <Ingreso onPaso={onPaso} />;
    case "sinAcceso":
      return (
        <>
          <Alert variant="destructive">
            <AlertTitle>Sin acceso</AlertTitle>
            <AlertDescription>{paso.mensaje}</AlertDescription>
          </Alert>
          <Button variant="outline" onClick={() => onPaso({ tipo: "ingreso" })}>
            Entrar con otra cuenta
          </Button>
        </>
      );
    case "alta":
      return <AltaAutenticador paso={paso} onPaso={onPaso} />;
    case "codigo":
      return (
        <Card>
          <CardHeader>
            <CardTitle>Verificación en dos pasos</CardTitle>
            <CardDescription>
              Escriba el código de 6 dígitos que muestra su autenticador para El
              Apurimeño.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormularioCodigo factorId={paso.factorId} onPaso={onPaso} />
          </CardContent>
        </Card>
      );
  }
}

function Ingreso({ onPaso }: { onPaso: (p: Paso) => void }) {
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      onPaso(await ingresar(correo, contrasena));
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ingresar</CardTitle>
        <CardDescription>
          Con la cuenta que le dieron para ver el resumen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={(e) => void enviar(e)}>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Correo
            <Input
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Contraseña
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
            />
          </label>
          {error !== null && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <Button
            type="submit"
            disabled={enviando || correo.trim() === "" || contrasena === ""}
          >
            {enviando ? "Ingresando…" : "Ingresar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AltaAutenticador({
  paso,
  onPaso,
}: {
  paso: Extract<Paso, { tipo: "alta" }>;
  onPaso: (p: Paso) => void;
}) {
  const [verClave, setVerClave] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active la verificación en dos pasos</CardTitle>
        <CardDescription>
          Es obligatoria para ver el resumen. Se hace una sola vez en este
          celular o en otro que tenga a mano.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Instale una app de autenticación, como Google Authenticator o
            Microsoft Authenticator.
          </li>
          <li>En esa app, agregue una cuenta escaneando este código:</li>
        </ol>
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG en una URL data:, generado por Supabase */}
        <img
          src={paso.qr}
          alt="Código QR para agregar El Apurimeño a su autenticador"
          className="mx-auto h-48 w-48 rounded-md border bg-white p-2"
        />
        <div>
          <button
            type="button"
            className="text-sm underline underline-offset-2"
            onClick={() => setVerClave(!verClave)}
          >
            {verClave
              ? "Ocultar la clave"
              : "¿No puede escanear? Escriba la clave a mano"}
          </button>
          {verClave && (
            <p
              className="mt-2 break-all rounded-md border bg-muted p-2 text-center font-mono text-base tracking-wider"
              aria-label="Clave del autenticador"
            >
              {paso.clave.replace(/(.{4})/g, "$1 ").trim()}
            </p>
          )}
        </div>
        <p>
          3. Escriba el código de 6 dígitos que aparece en la app para
          confirmar:
        </p>
        <FormularioCodigo
          factorId={paso.factorId}
          onPaso={onPaso}
          textoBoton="Confirmar y entrar"
        />
      </CardContent>
    </Card>
  );
}

function FormularioCodigo({
  factorId,
  onPaso,
  textoBoton = "Verificar",
}: {
  factorId: string;
  onPaso: (p: Paso) => void;
  textoBoton?: string;
}) {
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const valido = /^\d{6}$/.test(codigo);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!valido) return;
    setEnviando(true);
    setError(null);
    try {
      onPaso(await verificarCodigo(factorId, codigo));
    } catch (err) {
      setError(mensajeDe(err));
      setCodigo("");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => void enviar(e)}>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Código
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          className="text-center font-mono text-2xl tracking-[0.4em]"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
        />
      </label>
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={!valido || enviando}>
        {enviando ? "Verificando…" : textoBoton}
      </Button>
    </form>
  );
}
