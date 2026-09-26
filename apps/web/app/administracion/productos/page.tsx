"use client";

import { useMemo, useState } from "react";
import type {
  CategoriaProducto,
  Producto,
  ProductoEntrada,
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
import { aTextoSoles, leerSoles, soles } from "@apurimeno/formato";
import {
  Aviso,
  CLASE_SELECT,
  Campo,
  Encabezado,
} from "../../../src/componentes/comunes";
import { useCarga } from "../../../src/lib/carga";
import { mensajeDe, servidor } from "../../../src/lib/servidor";

type AvisoPantalla = { tipo: "error" | "exito"; texto: string } | null;

/**
 * Productos e inventario (RF-53, CU-12, CU-29): alta y edición de productos con sus dos precios (RN-20, RN-21),
 * categorías y reposición de stock. El stock no se edita a mano: un producto nuevo empieza en 0 y solo cambia con
 * reposiciones, ventas y anulaciones, cada una en el kardex (RN-25). Un producto inactivo sale del catálogo del POS
 * pero sigue aquí para reactivarlo.
 */
export default function Productos() {
  const productos = useCarga(() => servidor.productos(), []);
  const categorias = useCarga(() => servidor.categoriasProducto(), []);
  const [editando, setEditando] = useState<Producto | "nuevo" | null>(null);
  const [reponiendo, setReponiendo] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [aviso, setAviso] = useState<AvisoPantalla>(null);

  const nombreCategoria = useMemo(
    () => new Map((categorias.datos ?? []).map((c) => [c.id, c.nombre])),
    [categorias.datos],
  );

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLocaleLowerCase("es");
    return (productos.datos ?? []).filter(
      (p) =>
        (verInactivos || p.activo) &&
        (categoriaFiltro === "" || p.categoriaId === categoriaFiltro) &&
        (q === "" ||
          p.nombre.toLocaleLowerCase("es").includes(q) ||
          (p.codigoBarras ?? "").includes(q)),
    );
  }, [productos.datos, busqueda, categoriaFiltro, verInactivos]);
  const inactivos = (productos.datos ?? []).filter((p) => !p.activo).length;

  const guardar = async (entrada: ProductoEntrada) => {
    setAviso(null);
    try {
      const p =
        editando === "nuevo" || editando === null
          ? await servidor.crearProducto(entrada)
          : await servidor.editarProducto(editando.id, entrada);
      setAviso({
        tipo: "exito",
        texto:
          editando === "nuevo"
            ? `Producto "${p.nombre}" creado. Empieza sin stock: use Reponer para ingresar la mercadería.`
            : `Producto "${p.nombre}" actualizado.`,
      });
      setEditando(null);
      await productos.recargar();
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  };

  const reponer = async (producto: Producto) => {
    const n = Number(cantidad);
    setAviso(null);
    try {
      const r = await servidor.reponerProducto(producto.id, n);
      setAviso({
        tipo: "exito",
        texto: `${r.producto.nombre}: ingresaron ${r.movimiento.cantidad}; stock ${producto.stock} → ${r.producto.stock}.`,
      });
      setReponiendo(null);
      setCantidad("");
      await productos.recargar();
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  };

  return (
    <>
      <Encabezado
        titulo="Productos e inventario"
        descripcion="Catálogo de la tienda con sus precios de huésped y público, y el ingreso de mercadería."
      >
        <Button
          disabled={(categorias.datos ?? []).length === 0}
          onClick={() => setEditando("nuevo")}
        >
          Nuevo producto
        </Button>
      </Encabezado>
      {aviso !== null && (
        <Aviso tipo={aviso.tipo} onCerrar={() => setAviso(null)}>
          {aviso.texto}
        </Aviso>
      )}
      {productos.error !== null && (
        <Aviso tipo="error">{productos.error}</Aviso>
      )}
      {categorias.error !== null && (
        <Aviso tipo="error">{categorias.error}</Aviso>
      )}
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex flex-wrap items-end gap-3">
                <Campo etiqueta="Buscar">
                  <Input
                    className="w-64"
                    placeholder="Nombre o código (puede escanearlo)"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    onKeyDown={(e) => {
                      // El lector de códigos termina con Enter: no hace falta nada más.
                      if (e.key === "Enter") e.preventDefault();
                    }}
                  />
                </Campo>
                <Campo etiqueta="Categoría">
                  <select
                    className={CLASE_SELECT}
                    value={categoriaFiltro}
                    onChange={(e) => setCategoriaFiltro(e.target.value)}
                  >
                    <option value="">Todas</option>
                    {categorias.datos?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </Campo>
                <label className="flex h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={verInactivos}
                    onChange={(e) => setVerInactivos(e.target.checked)}
                  />
                  Mostrar inactivos{inactivos > 0 && ` (${inactivos})`}
                </label>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="text-right">Huésped</TableHead>
                    <TableHead className="text-right">Público</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((p) => (
                    <TableRow
                      key={p.id}
                      className={p.activo ? undefined : "opacity-60"}
                    >
                      <TableCell>
                        <p className="font-medium">
                          {p.nombre}
                          {!p.activo && (
                            <Badge variant="outline" className="ml-2">
                              Inactivo
                            </Badge>
                          )}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {p.codigoBarras ?? "sin código"}
                        </p>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {nombreCategoria.get(p.categoriaId) ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {soles(p.precioHuesped)}
                      </TableCell>
                      <TableCell className="text-right">
                        {soles(p.precioPublico)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Stock producto={p} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditando(p)}
                          >
                            Editar
                          </Button>
                          {p.controlaStock && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setReponiendo(p.id);
                                setCantidad("");
                              }}
                            >
                              Reponer
                            </Button>
                          )}
                        </div>
                        {reponiendo === p.id && (
                          <div className="mt-2 flex items-end justify-end gap-2">
                            <Campo etiqueta="Unidades que ingresan">
                              <Input
                                autoFocus
                                className="w-32"
                                inputMode="numeric"
                                value={cantidad}
                                onChange={(e) => setCantidad(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && cantidadValida(cantidad))
                                    void reponer(p);
                                }}
                              />
                            </Campo>
                            <Button
                              size="sm"
                              disabled={!cantidadValida(cantidad)}
                              onClick={() => void reponer(p)}
                            >
                              Reponer
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setReponiendo(null)}
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
              {productos.datos !== null && visibles.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {productos.datos.length === 0
                    ? (categorias.datos ?? []).length === 0
                      ? "Todavía no hay productos. Primero cree una categoría (abajo); después, Nuevo producto."
                      : "Todavía no hay productos. Use Nuevo producto."
                    : "Ningún producto coincide con la búsqueda."}
                </p>
              )}
            </CardContent>
          </Card>
          <Categorias
            categorias={categorias.datos ?? []}
            onCreada={async (c) => {
              setAviso({
                tipo: "exito",
                texto: `Categoría "${c.nombre}" creada.`,
              });
              await categorias.recargar();
            }}
            onError={(texto) => setAviso({ tipo: "error", texto })}
          />
        </div>
        {editando !== null && (
          <FormularioProducto
            key={editando === "nuevo" ? "nuevo" : editando.id}
            producto={editando === "nuevo" ? null : editando}
            categorias={categorias.datos ?? []}
            onGuardar={guardar}
            onCancelar={() => setEditando(null)}
          />
        )}
      </div>
    </>
  );
}

const cantidadValida = (texto: string) => /^[1-9]\d{0,5}$/.test(texto.trim());

function Stock({ producto }: { producto: Producto }) {
  if (!producto.controlaStock)
    return <span className="text-muted-foreground">sin control</span>;
  if (producto.stock <= 0)
    return (
      <Badge className="bg-red-600 text-white">
        {producto.stock === 0 ? "Sin stock" : producto.stock}
      </Badge>
    );
  return <span className="font-medium">{producto.stock}</span>;
}

function Categorias({
  categorias,
  onCreada,
  onError,
}: {
  categorias: CategoriaProducto[];
  onCreada: (c: CategoriaProducto) => Promise<void>;
  onError: (texto: string) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [enviando, setEnviando] = useState(false);
  const crear = async () => {
    setEnviando(true);
    try {
      const c = await servidor.crearCategoriaProducto(nombre.trim());
      setNombre("");
      await onCreada(c);
    } catch (e) {
      onError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Categorías</CardTitle>
        <CardDescription>Agrupan los productos en el POS.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {categorias.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguna todavía.</p>
          ) : (
            categorias.map((c) => (
              <Badge key={c.id} variant="outline">
                {c.nombre}
              </Badge>
            ))
          )}
        </div>
        <div className="flex items-end gap-2">
          <Campo etiqueta="Nueva categoría">
            <Input
              className="w-64"
              placeholder="Bebidas"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nombre.trim() !== "") void crear();
              }}
            />
          </Campo>
          <Button
            variant="outline"
            disabled={nombre.trim() === "" || enviando}
            onClick={() => void crear()}
          >
            Agregar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FormularioProducto({
  producto,
  categorias,
  onGuardar,
  onCancelar,
}: {
  producto: Producto | null;
  categorias: CategoriaProducto[];
  onGuardar: (entrada: ProductoEntrada) => Promise<void>;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [categoriaId, setCategoriaId] = useState(
    producto?.categoriaId ?? (categorias.length === 1 ? categorias[0]!.id : ""),
  );
  const [codigo, setCodigo] = useState(producto?.codigoBarras ?? "");
  const [huesped, setHuesped] = useState(
    producto === null ? "" : aTextoSoles(producto.precioHuesped),
  );
  const [publico, setPublico] = useState(
    producto === null ? "" : aTextoSoles(producto.precioPublico),
  );
  const [controlaStock, setControlaStock] = useState(
    producto?.controlaStock ?? true,
  );
  const [activo, setActivo] = useState(producto?.activo ?? true);
  const [enviando, setEnviando] = useState(false);
  const centimosHuesped = leerSoles(huesped);
  const centimosPublico = leerSoles(publico);
  const valido =
    nombre.trim() !== "" &&
    categoriaId !== "" &&
    centimosHuesped !== null &&
    centimosPublico !== null;

  const guardar = async () => {
    if (!valido) return;
    setEnviando(true);
    try {
      await onGuardar({
        categoriaId,
        nombre: nombre.trim(),
        codigoBarras: codigo.trim() === "" ? null : codigo.trim(),
        precioHuesped: centimosHuesped,
        precioPublico: centimosPublico,
        controlaStock,
        activo,
      });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Card className="w-80 shrink-0">
      <CardHeader>
        <CardTitle>
          {producto === null ? "Nuevo producto" : `Editar ${producto.nombre}`}
        </CardTitle>
        <CardDescription>
          {producto === null
            ? "Empieza con stock 0: la mercadería entra con Reponer."
            : "El stock no se edita aquí: cambia solo con reposiciones, ventas y anulaciones. Los cambios de precio quedan en la auditoría."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Campo etiqueta="Nombre">
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Gaseosa 500 ml"
          />
        </Campo>
        <Campo etiqueta="Categoría">
          <select
            className={CLASE_SELECT}
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
          >
            <option value="">Elegir…</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo
          etiqueta="Código de barras (opcional)"
          ayuda="Con el cursor aquí, escanee el producto con el lector."
        >
          <Input
            className="font-mono"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />
        </Campo>
        <Campo
          etiqueta="Precio huésped (S/)"
          ayuda="El que paga quien está alojado."
        >
          <Input
            inputMode="decimal"
            value={huesped}
            onChange={(e) => setHuesped(e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Precio público (S/)">
          <Input
            inputMode="decimal"
            value={publico}
            onChange={(e) => setPublico(e.target.value)}
          />
        </Campo>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={controlaStock}
            onChange={(e) => setControlaStock(e.target.checked)}
          />
          <span>
            Controla stock
            <span className="block text-xs text-muted-foreground">
              Desmárquelo para artículos que no se cuentan (p. ej. un servicio).
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={activo}
            onChange={(e) => setActivo(e.target.checked)}
          />
          <span>
            Activo
            <span className="block text-xs text-muted-foreground">
              Un producto inactivo no aparece en el POS; su historial se
              conserva.
            </span>
          </span>
        </label>
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button disabled={!valido || enviando} onClick={() => void guardar()}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
        <Button variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
      </CardFooter>
    </Card>
  );
}
