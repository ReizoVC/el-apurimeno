"use client";

import { useState } from "react";
import {
  CONTRASENA_MINIMA,
  type Rango,
  type Usuario,
} from "@apurimeno/contracts";
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
import { Input } from "@apurimeno/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apurimeno/ui/components/table";
import { Aviso, Campo, Encabezado } from "../../../src/componentes/comunes";
import { useSesion } from "../../../src/componentes/Shell";
import { useCarga } from "../../../src/lib/carga";
import { mensajeDe, servidor } from "../../../src/lib/servidor";

type AvisoEstado = { tipo: "error" | "exito"; texto: string } | null;

/**
 * Usuarios (CU-23; RF-45). Cada cuenta es individual (RN-40) y se desactiva en vez de eliminarse. El servidor
 * impide que el Administrador se desactive o se quite users.manage a sí mismo (SELF_LOCKOUT_FORBIDDEN).
 */
export default function Usuarios() {
  const sesion = useSesion();
  const datos = useCarga(async () => {
    const [usuarios, rangos] = await Promise.all([
      servidor.usuarios(),
      servidor.rangos(),
    ]);
    return { usuarios, rangos };
  }, []);
  const [editando, setEditando] = useState<Usuario | "nuevo" | null>(null);
  const [aviso, setAviso] = useState<AvisoEstado>(null);
  const rangos = datos.datos?.rangos ?? [];
  const nombreRango = new Map(rangos.map((r) => [r.id, r.nombre]));

  return (
    <>
      <Encabezado
        titulo="Usuarios"
        descripcion="Cuentas individuales, sus rangos y su estado. Las cuentas se desactivan, no se eliminan."
      >
        <Button onClick={() => setEditando("nuevo")}>Nuevo usuario</Button>
      </Encabezado>
      {aviso !== null && (
        <Aviso tipo={aviso.tipo} onCerrar={() => setAviso(null)}>
          {aviso.texto}
        </Aviso>
      )}
      {datos.error !== null && <Aviso tipo="error">{datos.error}</Aviso>}
      <div className="flex items-start gap-4">
        <Card className="min-w-0 flex-1">
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Rangos</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {datos.datos?.usuarios.map((u) => (
                  <TableRow
                    key={u.id}
                    className={u.activo ? "" : "text-muted-foreground"}
                  >
                    <TableCell className="font-medium">
                      {u.nombreUsuario}
                      {u.id === sesion.usuario.id && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (usted)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.rangoIds
                        .map((id) => nombreRango.get(id) ?? id)
                        .join(", ")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.activo ? "default" : "outline"}>
                        {u.activo ? "Activo" : "Desactivado"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditando(u)}
                      >
                        Editar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {editando !== null && datos.datos !== null && (
          <div className="flex w-96 shrink-0 flex-col gap-4">
            <FormularioUsuario
              key={editando === "nuevo" ? "nuevo" : editando.id}
              usuario={editando === "nuevo" ? null : editando}
              esPropio={
                editando !== "nuevo" && editando.id === sesion.usuario.id
              }
              rangos={rangos}
              onCancelar={() => setEditando(null)}
              onGuardado={(u, creado) => {
                setAviso({
                  tipo: "exito",
                  texto: creado
                    ? `Usuario ${u.nombreUsuario} creado.`
                    : `Usuario ${u.nombreUsuario} actualizado.`,
                });
                setEditando(null);
                void datos.recargar();
              }}
              onError={(texto) => setAviso({ tipo: "error", texto })}
            />
            {editando !== "nuevo" && (
              <CambioContrasena
                key={`clave-${editando.id}`}
                usuario={editando}
                onHecho={() =>
                  setAviso({
                    tipo: "exito",
                    texto: `Contraseña de ${editando.nombreUsuario} cambiada.`,
                  })
                }
                onError={(texto) => setAviso({ tipo: "error", texto })}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}

function FormularioUsuario({
  usuario,
  esPropio,
  rangos,
  onCancelar,
  onGuardado,
  onError,
}: {
  usuario: Usuario | null;
  esPropio: boolean;
  rangos: Rango[];
  onCancelar: () => void;
  onGuardado: (u: Usuario, creado: boolean) => void;
  onError: (texto: string) => void;
}) {
  const [nombreUsuario, setNombreUsuario] = useState(
    usuario?.nombreUsuario ?? "",
  );
  const [contrasena, setContrasena] = useState("");
  const [activo, setActivo] = useState(usuario?.activo ?? true);
  const [rangoIds, setRangoIds] = useState<string[]>(usuario?.rangoIds ?? []);
  const alternar = (id: string) =>
    setRangoIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  const valido =
    nombreUsuario.trim() !== "" &&
    rangoIds.length > 0 &&
    (usuario !== null || contrasena.length >= CONTRASENA_MINIMA);

  const guardar = async () => {
    try {
      const nombre = nombreUsuario.trim();
      onGuardado(
        usuario === null
          ? await servidor.crearUsuario({
              nombreUsuario: nombre,
              contrasena,
              rangoIds,
            })
          : await servidor.editarUsuario(usuario.id, {
              nombreUsuario: nombre,
              activo,
              rangoIds,
            }),
        usuario === null,
      );
    } catch (e) {
      onError(mensajeDe(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {usuario === null ? "Nuevo usuario" : usuario.nombreUsuario}
        </CardTitle>
        {esPropio && (
          <CardDescription>
            Es su propia cuenta: no puede desactivarla ni quitarse el permiso de
            gestionar usuarios.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Campo etiqueta="Nombre de usuario">
          <Input
            value={nombreUsuario}
            autoComplete="off"
            onChange={(e) => setNombreUsuario(e.target.value)}
          />
        </Campo>
        {usuario === null && (
          <Campo
            etiqueta="Contraseña"
            ayuda={`Al menos ${CONTRASENA_MINIMA} caracteres.`}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
            />
          </Campo>
        )}
        <fieldset className="flex flex-col gap-1.5 text-sm">
          <legend className="mb-1.5 font-medium">Rangos</legend>
          {rangos.map((r) => (
            <label key={r.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={rangoIds.includes(r.id)}
                onChange={() => alternar(r.id)}
              />
              {r.nombre}
              <span className="text-xs text-muted-foreground">
                ({r.permisos.length} permisos)
              </span>
            </label>
          ))}
          <span className="text-xs text-muted-foreground">
            Al menos uno. Los permisos son la unión de sus rangos.
          </span>
        </fieldset>
        {usuario !== null && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={activo}
              disabled={esPropio}
              onChange={(e) => setActivo(e.target.checked)}
            />
            Cuenta activa
          </label>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button disabled={!valido} onClick={() => void guardar()}>
          {usuario === null ? "Crear" : "Guardar"}
        </Button>
        <Button variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
      </CardFooter>
    </Card>
  );
}

function CambioContrasena({
  usuario,
  onHecho,
  onError,
}: {
  usuario: Usuario;
  onHecho: () => void;
  onError: (texto: string) => void;
}) {
  const [contrasena, setContrasena] = useState("");
  const [repetida, setRepetida] = useState("");
  const coinciden = contrasena === repetida;
  const cambiar = async () => {
    try {
      await servidor.cambiarContrasena(usuario.id, contrasena);
      setContrasena("");
      setRepetida("");
      onHecho();
    } catch (e) {
      onError(mensajeDe(e));
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cambiar contraseña</CardTitle>
        <CardDescription>
          Las sesiones ya abiertas de este usuario siguen vigentes hasta que
          venzan.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Campo
          etiqueta="Nueva contraseña"
          ayuda={`Al menos ${CONTRASENA_MINIMA} caracteres.`}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
          />
        </Campo>
        <Campo
          etiqueta="Repetir"
          ayuda={!coinciden && repetida !== "" ? "No coincide." : undefined}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
          />
        </Campo>
      </CardContent>
      <CardFooter>
        <Button
          variant="outline"
          disabled={contrasena.length < CONTRASENA_MINIMA || !coinciden}
          onClick={() => void cambiar()}
        >
          Cambiar contraseña
        </Button>
      </CardFooter>
    </Card>
  );
}
