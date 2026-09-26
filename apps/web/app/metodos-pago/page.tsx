"use client";

import { useState } from "react";
import type { MetodoPago } from "@apurimeno/contracts";
import { Badge } from "@apurimeno/ui/components/badge";
import { Button } from "@apurimeno/ui/components/button";
import {
  Card,
  CardContent,
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
import { Aviso, Campo, Encabezado } from "../../src/componentes/comunes";
import { useCarga } from "../../src/lib/carga";
import { mensajeDe, servidor } from "../../src/lib/servidor";

/**
 * Métodos de pago (RF-54). Nombre, referencia y habilitación se editan; `afectaCaja` se fija al crear y ya no
 * cambia (decisión 20 de contracts): cambiarlo alteraría el efectivo esperado de los turnos abiertos.
 */
export default function MetodosPago() {
  const lista = useCarga(() => servidor.metodosPago(), []);
  const [editando, setEditando] = useState<MetodoPago | "nuevo" | null>(null);
  const [aviso, setAviso] = useState<{
    tipo: "error" | "exito";
    texto: string;
  } | null>(null);

  const alternar = async (m: MetodoPago) => {
    setAviso(null);
    try {
      const { id, ...resto } = m;
      await servidor.editarMetodoPago(id, { ...resto, activo: !m.activo });
      setAviso({
        tipo: "exito",
        texto: `${m.nombre} ${m.activo ? "deshabilitado: ya no aparece al cobrar" : "habilitado"}.`,
      });
      await lista.recargar();
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  };

  return (
    <>
      <Encabezado
        titulo="Métodos de pago"
        descripcion="Los habilitados aparecen al cobrar en el POS. Un método no se elimina: se deshabilita."
      >
        <Button onClick={() => setEditando("nuevo")}>Nuevo método</Button>
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
                  <TableHead>Nombre</TableHead>
                  <TableHead>Caja</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.datos?.map((m) => (
                  <TableRow
                    key={m.id}
                    className={m.activo ? "" : "text-muted-foreground"}
                  >
                    <TableCell className="font-medium">{m.nombre}</TableCell>
                    <TableCell>
                      {m.afectaCaja
                        ? "Entra al efectivo del turno"
                        : "No entra al efectivo"}
                    </TableCell>
                    <TableCell>
                      {m.requiereReferencia ? "Pide número de operación" : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.activo ? "default" : "outline"}>
                        {m.activo ? "Habilitado" : "Deshabilitado"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditando(m)}
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void alternar(m)}
                        >
                          {m.activo ? "Deshabilitar" : "Habilitar"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {editando !== null && (
          <FormularioMetodo
            key={editando === "nuevo" ? "nuevo" : editando.id}
            metodo={editando === "nuevo" ? null : editando}
            onCancelar={() => setEditando(null)}
            onGuardado={(m, creado) => {
              setAviso({
                tipo: "exito",
                texto: creado
                  ? `Método ${m.nombre} creado.`
                  : `Método ${m.nombre} actualizado.`,
              });
              setEditando(null);
              void lista.recargar();
            }}
            onError={(texto) => setAviso({ tipo: "error", texto })}
          />
        )}
      </div>
    </>
  );
}

function FormularioMetodo({
  metodo,
  onCancelar,
  onGuardado,
  onError,
}: {
  metodo: MetodoPago | null;
  onCancelar: () => void;
  onGuardado: (m: MetodoPago, creado: boolean) => void;
  onError: (texto: string) => void;
}) {
  const [nombre, setNombre] = useState(metodo?.nombre ?? "");
  const [afectaCaja, setAfectaCaja] = useState(metodo?.afectaCaja ?? false);
  const [requiereReferencia, setRequiereReferencia] = useState(
    metodo?.requiereReferencia ?? false,
  );
  const [activo, setActivo] = useState(metodo?.activo ?? true);
  const guardar = async () => {
    const entrada = {
      nombre: nombre.trim(),
      afectaCaja,
      requiereReferencia,
      activo,
    };
    try {
      onGuardado(
        metodo === null
          ? await servidor.crearMetodoPago(entrada)
          : await servidor.editarMetodoPago(metodo.id, entrada),
        metodo === null,
      );
    } catch (e) {
      onError(mensajeDe(e));
    }
  };
  return (
    <Card className="w-96 shrink-0">
      <CardHeader>
        <CardTitle>
          {metodo === null ? "Nuevo método de pago" : metodo.nombre}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Campo etiqueta="Nombre">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </Campo>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={afectaCaja}
            disabled={metodo !== null}
            onChange={(e) => setAfectaCaja(e.target.checked)}
          />
          <span>
            Entra al efectivo del turno
            <span className="block text-xs text-muted-foreground">
              {metodo === null
                ? "Solo el dinero físico en la caja (efectivo). No se puede cambiar después de crear el método."
                : "Fijo desde la creación: cambiarlo alteraría el efectivo esperado de los turnos abiertos. Para otro comportamiento, cree un método nuevo y deshabilite este."}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={requiereReferencia}
            onChange={(e) => setRequiereReferencia(e.target.checked)}
          />
          <span>
            Pide número de operación
            <span className="block text-xs text-muted-foreground">
              Yape, Plin, transferencias…
            </span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activo}
            onChange={(e) => setActivo(e.target.checked)}
          />
          Habilitado
        </label>
      </CardContent>
      <CardFooter className="gap-2">
        <Button disabled={nombre.trim() === ""} onClick={() => void guardar()}>
          {metodo === null ? "Crear" : "Guardar"}
        </Button>
        <Button variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
      </CardFooter>
    </Card>
  );
}
