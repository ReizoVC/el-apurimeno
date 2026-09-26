"use client";

import { useEffect, useState } from "react";
import type {
  Cliente,
  Habitacion,
  PrecioEspecialCliente,
} from "@apurimeno/contracts";
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
import {
  Aviso,
  CLASE_SELECT,
  Campo,
  Encabezado,
} from "../../../src/componentes/comunes";
import { useCarga } from "../../../src/lib/carga";
import {
  aTextoSoles,
  fechaHora,
  leerSoles,
  soles,
} from "../../../src/lib/formato";
import { mensajeDe, servidor } from "../../../src/lib/servidor";

type AvisoEstado = { tipo: "error" | "exito"; texto: string } | null;
const nombreDe = (c: Cliente) =>
  [c.nombre, c.documento].filter((v) => v !== null).join(" · ");

/**
 * Clientes (CU-09) y sus precios especiales (CU-08; RF-16 a RF-18). Un precio especial es el precio total de
 * una habitación para ese cliente: reemplaza al de lista y solo vale en esa habitación (RN-14, RN-15).
 */
export default function Clientes() {
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  const [seleccionado, setSeleccionado] = useState<Cliente | "nuevo" | null>(
    null,
  );
  const [aviso, setAviso] = useState<AvisoEstado>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setQ(texto.trim()), 250);
    return () => window.clearTimeout(id);
  }, [texto]);
  const resultados = useCarga(() => servidor.buscarClientes(q), [q]);

  return (
    <>
      <Encabezado
        titulo="Clientes y precios especiales"
        descripcion="Busque por documento o nombre. Hasta 20 resultados."
      >
        <Button onClick={() => setSeleccionado("nuevo")}>Nuevo cliente</Button>
      </Encabezado>
      {aviso !== null && (
        <Aviso tipo={aviso.tipo} onCerrar={() => setAviso(null)}>
          {aviso.texto}
        </Aviso>
      )}
      <div className="flex items-start gap-4">
        <Card className="w-80 shrink-0">
          <CardContent className="flex flex-col gap-3 pt-4">
            <Input
              aria-label="Buscar cliente"
              placeholder="Documento o nombre…"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
            {resultados.error !== null && (
              <Aviso tipo="error">{resultados.error}</Aviso>
            )}
            <ul className="flex flex-col divide-y rounded-md border text-sm">
              {resultados.datos?.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSeleccionado(c)}
                    className={`w-full px-3 py-2 text-left hover:bg-muted ${seleccionado !== "nuevo" && seleccionado?.id === c.id ? "bg-muted font-medium" : ""}`}
                  >
                    {nombreDe(c)}
                  </button>
                </li>
              ))}
              {resultados.datos?.length === 0 && (
                <li className="px-3 py-2 text-muted-foreground">
                  Sin resultados.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
        {seleccionado !== null && (
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <FormularioCliente
              key={
                seleccionado === "nuevo" ? "nuevo" : `datos-${seleccionado.id}`
              }
              cliente={seleccionado === "nuevo" ? null : seleccionado}
              onGuardado={(c, creado) => {
                setAviso({
                  tipo: "exito",
                  texto: creado
                    ? `Cliente registrado: ${nombreDe(c)}.`
                    : "Cliente actualizado.",
                });
                setSeleccionado(c);
                void resultados.recargar();
              }}
              onError={(texto) => setAviso({ tipo: "error", texto })}
            />
            {seleccionado !== "nuevo" && (
              <PreciosEspeciales
                key={`precios-${seleccionado.id}`}
                cliente={seleccionado}
                onAviso={setAviso}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}

function FormularioCliente({
  cliente,
  onGuardado,
  onError,
}: {
  cliente: Cliente | null;
  onGuardado: (c: Cliente, creado: boolean) => void;
  onError: (texto: string) => void;
}) {
  const [documento, setDocumento] = useState(cliente?.documento ?? "");
  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const guardar = async () => {
    const entrada = {
      documento: documento.trim() === "" ? null : documento.trim(),
      nombre: nombre.trim() === "" ? null : nombre.trim(),
    };
    try {
      onGuardado(
        cliente === null
          ? await servidor.crearCliente(entrada)
          : await servidor.editarCliente(cliente.id, entrada),
        cliente === null,
      );
    } catch (e) {
      onError(mensajeDe(e));
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {cliente === null ? "Nuevo cliente" : nombreDe(cliente)}
        </CardTitle>
        <CardDescription>
          Documento, nombre o ambos. Estos datos nunca se imprimen en el
          comprobante (RN-38).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Documento" ayuda="Único cuando existe.">
          <Input
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Nombre">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </Campo>
      </CardContent>
      <CardFooter>
        <Button
          disabled={documento.trim() === "" && nombre.trim() === ""}
          onClick={() => void guardar()}
        >
          {cliente === null ? "Registrar" : "Guardar cambios"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function PreciosEspeciales({
  cliente,
  onAviso,
}: {
  cliente: Cliente;
  onAviso: (a: AvisoEstado) => void;
}) {
  const datos = useCarga(async () => {
    const [precios, habitaciones] = await Promise.all([
      servidor.preciosEspeciales(cliente.id),
      servidor.habitaciones(),
    ]);
    return { precios, habitaciones };
  }, [cliente.id]);
  const [habitacionId, setHabitacionId] = useState("");
  const [precio, setPrecio] = useState("");
  const [editando, setEditando] = useState<{
    habitacionId: string;
    precio: string;
  } | null>(null);
  const porId = new Map<string, Habitacion>(
    (datos.datos?.habitaciones ?? []).map((h) => [h.id, h]),
  );
  const conPrecio = new Set(
    (datos.datos?.precios ?? []).map((p) => p.habitacionId),
  );

  const ejecutar = async (accion: () => Promise<unknown>, texto: string) => {
    onAviso(null);
    try {
      await accion();
      onAviso({ tipo: "exito", texto });
      setEditando(null);
      setPrecio("");
      setHabitacionId("");
      await datos.recargar();
    } catch (e) {
      onAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  };
  const numero = (p: PrecioEspecialCliente) =>
    porId.get(p.habitacionId)?.numero ?? p.habitacionId;
  const nuevoPrecio = leerSoles(precio);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Precios especiales</CardTitle>
        <CardDescription>
          Precio total fijo por habitación; reemplaza al de lista y rige desde
          el próximo ingreso.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {datos.error !== null && <Aviso tipo="error">{datos.error}</Aviso>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Habitación</TableHead>
              <TableHead className="text-right">Precio de lista</TableHead>
              <TableHead className="text-right">Precio especial</TableHead>
              <TableHead>Creado</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {datos.datos?.precios.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{numero(p)}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {soles(porId.get(p.habitacionId)?.precioBase ?? 0)}
                </TableCell>
                <TableCell className="text-right">
                  {editando?.habitacionId === p.habitacionId ? (
                    <Input
                      aria-label="Nuevo precio especial"
                      className="ml-auto w-28 text-right"
                      inputMode="decimal"
                      autoFocus
                      value={editando.precio}
                      onChange={(e) =>
                        setEditando({
                          habitacionId: p.habitacionId,
                          precio: e.target.value,
                        })
                      }
                    />
                  ) : (
                    soles(p.precio)
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {fechaHora(p.creadoEn)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {editando?.habitacionId === p.habitacionId ? (
                      <>
                        <Button
                          size="sm"
                          disabled={leerSoles(editando.precio) === null}
                          onClick={() => {
                            const centimos = leerSoles(editando.precio);
                            if (centimos !== null)
                              void ejecutar(
                                () =>
                                  servidor.editarPrecioEspecial(
                                    cliente.id,
                                    p.habitacionId,
                                    centimos,
                                  ),
                                `Precio de la ${numero(p)} actualizado.`,
                              );
                          }}
                        >
                          Guardar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditando(null)}
                        >
                          Cancelar
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setEditando({
                              habitacionId: p.habitacionId,
                              precio: aTextoSoles(p.precio),
                            })
                          }
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() =>
                            void ejecutar(
                              () =>
                                servidor.eliminarPrecioEspecial(
                                  cliente.id,
                                  p.habitacionId,
                                ),
                              `Precio especial de la ${numero(p)} eliminado: vuelve el precio de lista.`,
                            )
                          }
                        >
                          Eliminar
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {datos.datos?.precios.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Este cliente no tiene precios especiales.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
          <Campo etiqueta="Habitación">
            <select
              className={CLASE_SELECT}
              value={habitacionId}
              onChange={(e) => setHabitacionId(e.target.value)}
            >
              <option value="">Elegir…</option>
              {datos.datos?.habitaciones
                .filter((h) => !conPrecio.has(h.id))
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.numero} · lista {soles(h.precioBase)}
                  </option>
                ))}
            </select>
          </Campo>
          <Campo etiqueta="Precio especial (S/)">
            <Input
              className="w-32"
              inputMode="decimal"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
            />
          </Campo>
          <Button
            disabled={habitacionId === "" || nuevoPrecio === null}
            onClick={() =>
              nuevoPrecio !== null &&
              void ejecutar(
                () =>
                  servidor.crearPrecioEspecial(
                    cliente.id,
                    habitacionId,
                    nuevoPrecio,
                  ),
                `Precio especial creado para la ${porId.get(habitacionId)?.numero ?? ""}.`,
              )
            }
          >
            Agregar precio especial
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
