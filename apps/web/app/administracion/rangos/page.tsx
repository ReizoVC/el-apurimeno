"use client";

import { useState } from "react";
import { PERMISOS, type Permiso, type Rango } from "@apurimeno/contracts";
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
import { Aviso, Campo, Encabezado } from "../../../src/componentes/comunes";
import { useCarga } from "../../../src/lib/carga";
import { PERMISO } from "../../../src/lib/rotulos";
import { mensajeDe, servidor } from "../../../src/lib/servidor";

/** Grupos del catálogo fijo de permisos (Planos §5), para leer la grilla por área. */
const GRUPOS: { titulo: string; prefijos: string[] }[] = [
  { titulo: "Acceso", prefijos: ["pos.", "dashboard.", "cleaning.access"] },
  { titulo: "Caja", prefijos: ["shifts."] },
  {
    titulo: "Alquileres y habitaciones",
    prefijos: ["rentals.", "rooms.", "client_pricing.", "cleaning.mark_ready"],
  },
  {
    titulo: "Tienda e inventario",
    prefijos: ["sales.", "store.", "inventory."],
  },
  {
    titulo: "Control y administración",
    prefijos: ["tickets.", "reports.", "users.", "settings.", "audit."],
  },
];
const grupoDe = (p: Permiso) =>
  GRUPOS.findIndex((g) => g.prefijos.some((pre) => p.startsWith(pre)));

/**
 * Rangos (CU-24; RN-41, RF-62, RF-63): combinaciones de permisos del catálogo fijo. Un cambio rige de
 * inmediato para todos los usuarios que tienen el rango.
 */
export default function Rangos() {
  const lista = useCarga(() => servidor.rangos(), []);
  const [editando, setEditando] = useState<Rango | "nuevo" | null>(null);
  const [aviso, setAviso] = useState<{
    tipo: "error" | "exito";
    texto: string;
  } | null>(null);

  return (
    <>
      <Encabezado
        titulo="Rangos"
        descripcion="Cada rango combina permisos del catálogo fijo; un usuario suma los de todos sus rangos."
      >
        <Button onClick={() => setEditando("nuevo")}>Nuevo rango</Button>
      </Encabezado>
      {aviso !== null && (
        <Aviso tipo={aviso.tipo} onCerrar={() => setAviso(null)}>
          {aviso.texto}
        </Aviso>
      )}
      {lista.error !== null && <Aviso tipo="error">{lista.error}</Aviso>}
      <div className="flex items-start gap-4">
        <Card className="w-72 shrink-0">
          <CardContent className="pt-4">
            <ul className="flex flex-col divide-y rounded-md border text-sm">
              {lista.datos?.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setEditando(r)}
                    className={`flex w-full justify-between px-3 py-2 text-left hover:bg-muted ${editando !== "nuevo" && editando?.id === r.id ? "bg-muted font-medium" : ""}`}
                  >
                    {r.nombre}
                    <span className="text-muted-foreground">
                      {r.permisos.length}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        {editando !== null && (
          <FormularioRango
            key={editando === "nuevo" ? "nuevo" : editando.id}
            rango={editando === "nuevo" ? null : editando}
            onCancelar={() => setEditando(null)}
            onGuardado={(r, creado) => {
              setAviso({
                tipo: "exito",
                texto: creado
                  ? `Rango ${r.nombre} creado.`
                  : `Rango ${r.nombre} actualizado; rige de inmediato.`,
              });
              setEditando(r);
              void lista.recargar();
            }}
            onError={(texto) => setAviso({ tipo: "error", texto })}
          />
        )}
      </div>
    </>
  );
}

function FormularioRango({
  rango,
  onCancelar,
  onGuardado,
  onError,
}: {
  rango: Rango | null;
  onCancelar: () => void;
  onGuardado: (r: Rango, creado: boolean) => void;
  onError: (texto: string) => void;
}) {
  const [nombre, setNombre] = useState(rango?.nombre ?? "");
  const [permisos, setPermisos] = useState<Permiso[]>(rango?.permisos ?? []);
  const alternar = (p: Permiso) =>
    setPermisos((ps) =>
      ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p],
    );
  const guardar = async () => {
    // Orden del catálogo, para que la auditoría compare listas estables.
    const entrada = {
      nombre: nombre.trim(),
      permisos: PERMISOS.filter((p) => permisos.includes(p)),
    };
    try {
      onGuardado(
        rango === null
          ? await servidor.crearRango(entrada)
          : await servidor.editarRango(rango.id, entrada),
        rango === null,
      );
    } catch (e) {
      onError(mensajeDe(e));
    }
  };

  return (
    <Card className="min-w-0 flex-1">
      <CardHeader>
        <CardTitle>{rango === null ? "Nuevo rango" : rango.nombre}</CardTitle>
        <CardDescription>
          {permisos.length} de {PERMISOS.length} permisos. Quitarse a sí mismo
          el permiso de gestionar usuarios se rechaza.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Campo etiqueta="Nombre">
          <Input
            className="max-w-sm"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </Campo>
        <div className="grid gap-4 md:grid-cols-2">
          {GRUPOS.map((g, i) => (
            <fieldset
              key={g.titulo}
              className="flex flex-col gap-1.5 rounded-md border p-3 text-sm"
            >
              <legend className="px-1 font-medium">{g.titulo}</legend>
              {PERMISOS.filter((p) => grupoDe(p) === i).map((p) => (
                <label key={p} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={permisos.includes(p)}
                    onChange={() => alternar(p)}
                  />
                  <span>
                    {PERMISO[p]}
                    <span className="ml-1 font-mono text-xs text-muted-foreground">
                      {p}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </CardContent>
      <CardFooter className="gap-2">
        <Button disabled={nombre.trim() === ""} onClick={() => void guardar()}>
          {rango === null ? "Crear" : "Guardar"}
        </Button>
        <Button variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
      </CardFooter>
    </Card>
  );
}
