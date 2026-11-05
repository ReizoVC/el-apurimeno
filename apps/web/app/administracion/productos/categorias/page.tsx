"use client";

import { useMemo, useState } from "react";
import type { CategoriaProducto } from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import { Card, CardContent } from "@apurimeno/ui/components/card";
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
} from "../../../../src/componentes/comunes";
import { useCarga } from "../../../../src/lib/carga";
import { mensajeDe, servidor } from "../../../../src/lib/servidor";

type AvisoPantalla = { tipo: "error" | "exito"; texto: string } | null;
type Accion = { id: string; tipo: "renombrar" | "eliminar" } | null;

/**
 * Categorías de productos: crear, renombrar y eliminar. Una categoría con productos solo se elimina
 * moviéndolos a otra (decisión 28 de contracts). El conteo incluye los productos inactivos, que también la usan.
 */
export default function Categorias() {
  const categorias = useCarga(() => servidor.categoriasProducto(), []);
  const productos = useCarga(() => servidor.productos(), []);
  const [nueva, setNueva] = useState("");
  const [accion, setAccion] = useState<Accion>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<AvisoPantalla>(null);

  const conteo = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of productos.datos ?? []) {
      n.set(p.categoriaId, (n.get(p.categoriaId) ?? 0) + 1);
    }
    return n;
  }, [productos.datos]);

  const ejecutar = async (
    operacion: () => Promise<unknown>,
    exito: string,
  ): Promise<boolean> => {
    setEnviando(true);
    setAviso(null);
    try {
      await operacion();
      setAviso({ tipo: "exito", texto: exito });
      setAccion(null);
      await Promise.all([categorias.recargar(), productos.recargar()]);
      return true;
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
      return false;
    } finally {
      setEnviando(false);
    }
  };

  const crear = async () => {
    const nombre = nueva.trim();
    const creada = await ejecutar(
      () => servidor.crearCategoriaProducto(nombre),
      `Categoría "${nombre}" creada.`,
    );
    if (creada) setNueva("");
  };

  const lista = categorias.datos ?? [];
  return (
    <>
      <Encabezado
        titulo="Categorías"
        descripcion="Agrupan los productos. Renombrar una categoría no cambia las ventas ya registradas."
      />
      {aviso !== null && (
        <Aviso tipo={aviso.tipo} onCerrar={() => setAviso(null)}>
          {aviso.texto}
        </Aviso>
      )}
      {categorias.error !== null && (
        <Aviso tipo="error">{categorias.error}</Aviso>
      )}
      {productos.error !== null && (
        <Aviso tipo="error">{productos.error}</Aviso>
      )}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-4">
          <div className="flex items-end gap-2">
            <Campo etiqueta="Nueva categoría">
              <Input
                className="w-64"
                placeholder="Bebidas"
                value={nueva}
                onChange={(e) => setNueva(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && nueva.trim() !== "") void crear();
                }}
              />
            </Campo>
            <Button
              variant="outline"
              disabled={nueva.trim() === "" || enviando}
              onClick={() => void crear()}
            >
              Agregar
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Productos</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.nombre}</TableCell>
                  <TableCell className="text-right">
                    {conteo.get(c.id) ?? 0}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAccion({ id: c.id, tipo: "renombrar" })}
                      >
                        Renombrar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAccion({ id: c.id, tipo: "eliminar" })}
                      >
                        Eliminar
                      </Button>
                    </div>
                    {accion?.id === c.id && accion.tipo === "renombrar" && (
                      <Renombrar
                        categoria={c}
                        enviando={enviando}
                        onCancelar={() => setAccion(null)}
                        onGuardar={(nombre) =>
                          ejecutar(
                            () => servidor.renombrarCategoriaProducto(c.id, nombre),
                            `"${c.nombre}" ahora se llama "${nombre}".`,
                          )
                        }
                      />
                    )}
                    {accion?.id === c.id && accion.tipo === "eliminar" && (
                      <Eliminar
                        categoria={c}
                        productos={conteo.get(c.id) ?? 0}
                        otras={lista.filter((o) => o.id !== c.id)}
                        enviando={enviando}
                        onCancelar={() => setAccion(null)}
                        onEliminar={(moverA) =>
                          ejecutar(
                            () => servidor.eliminarCategoriaProducto(c.id, moverA),
                            `Categoría "${c.nombre}" eliminada.`,
                          )
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {categorias.datos !== null && lista.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Todavía no hay categorías.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Renombrar({
  categoria,
  enviando,
  onGuardar,
  onCancelar,
}: {
  categoria: CategoriaProducto;
  enviando: boolean;
  onGuardar: (nombre: string) => Promise<boolean>;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(categoria.nombre);
  const limpio = nombre.trim();
  const valido = limpio !== "" && limpio !== categoria.nombre && !enviando;
  return (
    <div className="mt-2 flex items-end justify-end gap-2">
      <Campo etiqueta="Nuevo nombre">
        <Input
          autoFocus
          className="w-56"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valido) void onGuardar(limpio);
          }}
        />
      </Campo>
      <Button size="sm" disabled={!valido} onClick={() => void onGuardar(limpio)}>
        Guardar
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancelar}>
        Cancelar
      </Button>
    </div>
  );
}

function Eliminar({
  categoria,
  productos,
  otras,
  enviando,
  onEliminar,
  onCancelar,
}: {
  categoria: CategoriaProducto;
  productos: number;
  otras: CategoriaProducto[];
  enviando: boolean;
  onEliminar: (moverA: string | undefined) => Promise<boolean>;
  onCancelar: () => void;
}) {
  const [destino, setDestino] = useState("");
  const conProductos = productos > 0;
  return (
    <div className="mt-2 flex flex-wrap items-end justify-end gap-2">
      {!conProductos ? (
        <p className="self-center text-sm">
          ¿Eliminar &quot;{categoria.nombre}&quot;?
        </p>
      ) : otras.length === 0 ? (
        <p className="self-center text-sm text-muted-foreground">
          Tiene {productos} producto(s) y no hay otra categoría a donde
          moverlos: cree una primero.
        </p>
      ) : (
        <Campo etiqueta={`Mover ${productos} producto(s) a`}>
          <select
            className={CLASE_SELECT}
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
          >
            <option value="">Elegir…</option>
            {otras.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nombre}
              </option>
            ))}
          </select>
        </Campo>
      )}
      <Button
        variant="destructive"
        size="sm"
        disabled={enviando || (conProductos && destino === "")}
        onClick={() => void onEliminar(conProductos ? destino : undefined)}
      >
        {conProductos ? "Mover y eliminar" : "Eliminar"}
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancelar}>
        Cancelar
      </Button>
    </div>
  );
}
