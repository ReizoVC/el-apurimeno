"use client";

import { Fragment, useMemo, useState, type KeyboardEvent } from "react";
import Link from "next/link";
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
type TipoAccionStock = "entrada" | "salida" | "contar";

const ACCIONES_STOCK: readonly { tipo: TipoAccionStock; etiqueta: string }[] = [
  { tipo: "entrada", etiqueta: "Entrada" },
  { tipo: "salida", etiqueta: "Salida" },
  { tipo: "contar", etiqueta: "Contar" },
];

/**
 * Productos e inventario (RF-53, CU-12, CU-29): alta y edición de productos con sus dos precios (RN-20, RN-21), y
 * entrada, salida y conteo de stock (decisión 29); las categorías y el historial tienen su pestaña. El stock no se
 * edita a mano: un producto nuevo empieza en 0 y todo cambio queda en el kardex (RN-25). Un producto inactivo sale del
 * catálogo del POS pero sigue aquí para reactivarlo.
 */
export default function Productos() {
  const productos = useCarga(() => servidor.productos(), []);
  const categorias = useCarga(() => servidor.categoriasProducto(), []);
  const [editando, setEditando] = useState<Producto | "nuevo" | null>(null);
  const [accion, setAccion] = useState<{
    id: string;
    tipo: TipoAccionStock;
  } | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [soloSinStock, setSoloSinStock] = useState(false);
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
        (!soloSinStock || faltaStock(p)) &&
        (categoriaFiltro === "" || p.categoriaId === categoriaFiltro) &&
        (q === "" ||
          p.nombre.toLocaleLowerCase("es").includes(q) ||
          (p.codigoBarras ?? "").includes(q)),
    );
  }, [productos.datos, busqueda, categoriaFiltro, verInactivos, soloSinStock]);
  const inactivos = (productos.datos ?? []).filter((p) => !p.activo).length;
  const sinStock = (productos.datos ?? []).filter(
    (p) => p.activo && faltaStock(p),
  ).length;

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
            ? `Producto "${p.nombre}" creado. Empieza sin stock: use Entrada para ingresar la mercadería.`
            : `Producto "${p.nombre}" actualizado.`,
      });
      setEditando(null);
      await productos.recargar();
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  };

  const moverStock = async (operacion: () => Promise<string>) => {
    setAviso(null);
    try {
      setAviso({ tipo: "exito", texto: await operacion() });
      setAccion(null);
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
    // También si falló: si el stock cambió mientras tanto, la pantalla pasa a mostrar el actual.
    await productos.recargar();
  };

  return (
    <>
      <Encabezado
        titulo="Productos e inventario"
        descripcion="Catálogo de la tienda con sus precios de huésped y público, y el control de su stock."
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
                <label className="flex h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={soloSinStock}
                    onChange={(e) => setSoloSinStock(e.target.checked)}
                  />
                  Solo sin stock o en negativo{sinStock > 0 && ` (${sinStock})`}
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
                    <Fragment key={p.id}>
                      <TableRow className={p.activo ? undefined : "opacity-60"}>
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
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditando(p)}
                            >
                              Editar
                            </Button>
                            {p.controlaStock &&
                              ACCIONES_STOCK.map(({ tipo, etiqueta }) => (
                                <Button
                                  key={tipo}
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setAccion({ id: p.id, tipo })}
                                >
                                  {etiqueta}
                                </Button>
                              ))}
                            {p.controlaStock && (
                              <Button variant="ghost" size="sm" asChild>
                                <Link
                                  href={`/administracion/productos/movimientos?producto=${p.id}`}
                                >
                                  Historial
                                </Link>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {accion?.id === p.id && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={6}>
                            <AccionStock
                              key={accion.tipo}
                              producto={p}
                              tipo={accion.tipo}
                              onEnviar={moverStock}
                              onCancelar={() => setAccion(null)}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
              {productos.datos !== null && visibles.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {productos.datos.length === 0
                    ? (categorias.datos ?? []).length === 0
                      ? "Todavía no hay productos. Primero cree una categoría en la pestaña Categorías; después, Nuevo producto."
                      : "Todavía no hay productos. Use Nuevo producto."
                    : "Ningún producto coincide con la búsqueda."}
                </p>
              )}
            </CardContent>
          </Card>
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

const faltaStock = (p: Producto) => p.controlaStock && p.stock <= 0;

const MOTIVOS_SALIDA = ["Vencido", "Dañado", "Consumo interno", "Pérdida"];

/** Formulario de Entrada, Salida o Contar de un producto. `stockVisto` es el stock que muestra la lista (decisión 29). */
function AccionStock({
  producto,
  tipo,
  onEnviar,
  onCancelar,
}: {
  producto: Producto;
  tipo: TipoAccionStock;
  onEnviar: (operacion: () => Promise<string>) => Promise<void>;
  onCancelar: () => void;
}) {
  const [cantidad, setCantidad] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const contar = tipo === "contar";
  const n = Number(cantidad);
  const valido =
    (contar ? /^\d{1,6}$/ : /^[1-9]\d{0,5}$/).test(cantidad.trim()) &&
    (tipo !== "salida" || texto.trim() !== "");
  const stockVisto = producto.stock;

  const operacion = async (): Promise<string> => {
    if (tipo === "entrada") {
      const r = await servidor.reponerProducto(producto.id, n);
      return `${producto.nombre}: ingresaron ${n}; stock ${stockVisto} → ${r.producto.stock}.`;
    }
    if (tipo === "salida") {
      const r = await servidor.salidaStock(producto.id, {
        cantidad: n,
        motivo: texto,
        stockVisto,
      });
      return `${producto.nombre}: salieron ${n}; stock ${stockVisto} → ${r.producto.stock}.`;
    }
    const r = await servidor.conteoStock(producto.id, {
      contado: n,
      nota: texto.trim() === "" ? null : texto,
      stockVisto,
    });
    return r.movimiento.cantidad === 0
      ? `${producto.nombre}: contadas ${n}, sin diferencia.`
      : `${producto.nombre}: contadas ${n}; stock ${stockVisto} → ${r.producto.stock}.`;
  };

  const enviar = async () => {
    if (!valido || enviando) return;
    setEnviando(true);
    try {
      await onEnviar(operacion);
    } finally {
      setEnviando(false);
    }
  };
  const alPulsar = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") void enviar();
  };

  return (
    <div className="flex flex-wrap items-end justify-end gap-2">
      {contar && (
        <p className="h-9 content-center text-sm text-muted-foreground">
          En el sistema: {producto.stock}
          {valido &&
            ` · diferencia ${n > producto.stock ? "+" : ""}${n - producto.stock}`}
        </p>
      )}
      <Campo
        etiqueta={
          tipo === "entrada"
            ? "Unidades que ingresan"
            : tipo === "salida"
              ? "Unidades que salen"
              : "Unidades contadas"
        }
      >
        <Input
          autoFocus
          className="w-32"
          inputMode="numeric"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          onKeyDown={alPulsar}
        />
      </Campo>
      {tipo !== "entrada" && (
        <Campo etiqueta={contar ? "Nota (opcional)" : "Motivo"}>
          <Input
            className="w-44"
            list={contar ? undefined : "motivos-salida"}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={alPulsar}
          />
        </Campo>
      )}
      {tipo === "salida" && (
        <datalist id="motivos-salida">
          {MOTIVOS_SALIDA.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      )}
      <Button
        size="sm"
        disabled={!valido || enviando}
        onClick={() => void enviar()}
      >
        {enviando
          ? "Guardando…"
          : tipo === "entrada"
            ? "Registrar entrada"
            : tipo === "salida"
              ? "Registrar salida"
              : "Guardar conteo"}
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancelar}>
        Cancelar
      </Button>
    </div>
  );
}

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
            ? "Empieza con stock 0: la mercadería entra con Entrada."
            : "El stock no se edita aquí: se corrige con Entrada, Salida y Contar. Los cambios de precio quedan en la auditoría."}
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
