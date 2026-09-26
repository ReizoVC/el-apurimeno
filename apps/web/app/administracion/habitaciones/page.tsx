"use client";

import { useState } from "react";
import type { EstadoHabitacion, Habitacion } from "@apurimeno/contracts";
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
import { tienePermiso, useSesion } from "../../../src/componentes/Shell";
import { useCarga } from "../../../src/lib/carga";
import { aTextoSoles, leerSoles, soles } from "@apurimeno/formato";
import { mensajeDe, servidor } from "../../../src/lib/servidor";

const ESTADO: Record<EstadoHabitacion, { etiqueta: string; clase: string }> = {
  LIBRE: { etiqueta: "Libre", clase: "bg-emerald-600 text-white" },
  OCUPADA: { etiqueta: "Ocupada", clase: "bg-sky-600 text-white" },
  PENDIENTE_LIMPIEZA: {
    etiqueta: "Por limpiar",
    clase: "bg-violet-600 text-white",
  },
  MANTENIMIENTO: { etiqueta: "Mantenimiento", clase: "bg-zinc-600 text-white" },
};

/**
 * Habitaciones (CU-13, CU-14). Editar el precio no cambia los alquileres ya abiertos (RN-44). Bloquear exige
 * motivo y una habitación libre; reactivar la devuelve de mantenimiento a libre.
 */
export default function Habitaciones() {
  const sesion = useSesion();
  const lista = useCarga(() => servidor.habitaciones(), []);
  const [editando, setEditando] = useState<Habitacion | "nueva" | null>(null);
  const [bloqueando, setBloqueando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [aviso, setAviso] = useState<{
    tipo: "error" | "exito";
    texto: string;
  } | null>(null);
  const puedeBloquear = tienePermiso(sesion, "rooms.maintenance");

  const ejecutar = async (
    accion: () => Promise<Habitacion>,
    exito: (h: Habitacion) => string,
  ) => {
    setAviso(null);
    try {
      const h = await accion();
      setAviso({ tipo: "exito", texto: exito(h) });
      setBloqueando(null);
      setMotivo("");
      await lista.recargar();
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  };

  return (
    <>
      <Encabezado
        titulo="Habitaciones"
        descripcion="Número, descripción y precio de lista; bloqueo por mantenimiento."
      >
        <Button onClick={() => setEditando("nueva")}>Nueva habitación</Button>
      </Encabezado>
      {aviso !== null && (
        <Aviso tipo={aviso.tipo} onCerrar={() => setAviso(null)}>
          {aviso.texto}
        </Aviso>
      )}
      {lista.error !== null && <Aviso tipo="error">{lista.error}</Aviso>}
      <div className="flex items-start gap-4">
        <Card className="min-w-0 flex-1">
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-right">Precio de lista</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.datos?.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium">{h.numero}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {h.descripcion ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {soles(h.precioBase)}
                    </TableCell>
                    <TableCell>
                      <Badge className={ESTADO[h.estado].clase}>
                        {ESTADO[h.estado].etiqueta}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditando(h)}
                        >
                          Editar
                        </Button>
                        {puedeBloquear && h.estado === "LIBRE" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setBloqueando(h.id)}
                          >
                            Bloquear
                          </Button>
                        )}
                        {puedeBloquear && h.estado === "MANTENIMIENTO" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void ejecutar(
                                () => servidor.reactivarHabitacion(h.id),
                                (r) =>
                                  `Habitación ${r.numero} reactivada: queda libre.`,
                              )
                            }
                          >
                            Reactivar
                          </Button>
                        )}
                      </div>
                      {bloqueando === h.id && (
                        <div className="mt-2 flex items-end gap-2">
                          <Campo etiqueta="Motivo del bloqueo (obligatorio)">
                            <Input
                              autoFocus
                              value={motivo}
                              onChange={(e) => setMotivo(e.target.value)}
                            />
                          </Campo>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={motivo.trim() === ""}
                            onClick={() =>
                              void ejecutar(
                                () => servidor.bloquearHabitacion(h.id, motivo),
                                (r) =>
                                  `Habitación ${r.numero} bloqueada por mantenimiento.`,
                              )
                            }
                          >
                            Bloquear
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setBloqueando(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {editando !== null && (
          <FormularioHabitacion
            key={editando === "nueva" ? "nueva" : editando.id}
            habitacion={editando === "nueva" ? null : editando}
            onGuardar={(entrada) =>
              ejecutar(
                () =>
                  editando === "nueva"
                    ? servidor.crearHabitacion(entrada)
                    : servidor.editarHabitacion(editando.id, entrada),
                (h) => {
                  setEditando(null);
                  return editando === "nueva"
                    ? `Habitación ${h.numero} creada.`
                    : `Habitación ${h.numero} actualizada.`;
                },
              )
            }
            onCancelar={() => setEditando(null)}
          />
        )}
      </div>
    </>
  );
}

function FormularioHabitacion({
  habitacion,
  onGuardar,
  onCancelar,
}: {
  habitacion: Habitacion | null;
  onGuardar: (entrada: {
    numero: string;
    descripcion: string | null;
    precioBase: number;
  }) => Promise<void>;
  onCancelar: () => void;
}) {
  const [numero, setNumero] = useState(habitacion?.numero ?? "");
  const [descripcion, setDescripcion] = useState(habitacion?.descripcion ?? "");
  const [precio, setPrecio] = useState(
    habitacion === null ? "" : aTextoSoles(habitacion.precioBase),
  );
  const centimos = leerSoles(precio);
  return (
    <Card className="w-80 shrink-0">
      <CardHeader>
        <CardTitle>
          {habitacion === null
            ? "Nueva habitación"
            : `Editar ${habitacion.numero}`}
        </CardTitle>
        {habitacion !== null && (
          <CardDescription>
            El nuevo precio rige para los ingresos siguientes (RN-44).
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Campo etiqueta="Número">
          <Input value={numero} onChange={(e) => setNumero(e.target.value)} />
        </Campo>
        <Campo etiqueta="Descripción (opcional)">
          <Input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Grande, con baño propio"
          />
        </Campo>
        <Campo etiqueta="Precio de lista (S/)">
          <Input
            inputMode="decimal"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
          />
        </Campo>
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button
          disabled={numero.trim() === "" || centimos === null}
          onClick={() =>
            centimos !== null &&
            void onGuardar({
              numero: numero.trim(),
              descripcion:
                descripcion.trim() === "" ? null : descripcion.trim(),
              precioBase: centimos,
            })
          }
        >
          Guardar
        </Button>
        <Button variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
      </CardFooter>
    </Card>
  );
}
