import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  AjusteEntrada,
  Habitacion,
  MetodoPago,
  PagoEntrada,
  Producto,
} from "@apurimeno/contracts";
import { cotizarVenta } from "@apurimeno/domain";
import { Button } from "@apurimeno/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@apurimeno/ui/components/card";
import { Input } from "@apurimeno/ui/components/input";
import { AjustePuntual } from "../componentes/AjustePuntual";
import { Aviso } from "../componentes/Aviso";
import { Campo } from "../componentes/Campo";
import { SelectorPago } from "../componentes/SelectorPago";
import { soles } from "../lib/formato";
import { useClaveIdempotencia } from "../lib/idempotencia";
import { mensajeDe, servidor } from "../lib/servidor";
import { tienePermiso, type Sesion } from "../lib/sesion";

interface Props {
  sesion: Sesion;
  metodos: readonly MetodoPago[];
  /** Habitaciones ocupadas, para asociar la venta a un huésped (opcional, RN-24). */
  ocupadas: readonly Habitacion[];
}

/**
 * Venta de tienda (CU-11). El lector de código de barras USB escribe como un teclado y termina con Enter: el
 * campo de código busca el producto por código exacto y lo agrega al carrito. Huésped o público lo indica el
 * cajero (RN-22). El total que se muestra lo calcula `cotizarVenta` del dominio; el servidor lo recalcula al
 * cobrar y valida el stock (RN-26).
 */
export function Tienda({ sesion, metodos, ocupadas }: Props) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [codigo, setCodigo] = useState("");
  const [carrito, setCarrito] = useState<Map<string, number>>(new Map());
  const [esHuesped, setEsHuesped] = useState(false);
  const [habitacionId, setHabitacionId] = useState<string | null>(null);
  const [ajuste, setAjuste] = useState<AjusteEntrada | null>(null);
  const [pago, setPago] = useState<PagoEntrada | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [clave, renovarClave] = useClaveIdempotencia();
  const campoCodigo = useRef<HTMLInputElement>(null);

  const cargar = useCallback(() => {
    servidor
      .productos()
      .then(setProductos, (e: unknown) => setError(mensajeDe(e)));
  }, []);
  useEffect(cargar, [cargar]);

  const agregar = (producto: Producto, cantidad = 1) => {
    setExito(null);
    setCarrito((prev) => {
      const siguiente = new Map(prev);
      const nueva = (siguiente.get(producto.id) ?? 0) + cantidad;
      if (nueva <= 0) siguiente.delete(producto.id);
      else siguiente.set(producto.id, nueva);
      return siguiente;
    });
  };

  const leerCodigo = async (evento: KeyboardEvent<HTMLInputElement>) => {
    if (evento.key !== "Enter") return;
    evento.preventDefault();
    const leido = codigo.trim();
    setCodigo("");
    if (leido === "") return;
    try {
      const [encontrado] = await servidor.productos(leido);
      if (encontrado === undefined)
        setError(`No hay un producto activo con el código ${leido}.`);
      else {
        setError(null);
        agregar(encontrado);
      }
    } catch (e) {
      setError(mensajeDe(e));
    }
  };

  const porId = useMemo(
    () => new Map(productos.map((p) => [p.id, p])),
    [productos],
  );
  const items = [...carrito.entries()].flatMap(([id, cantidad]) => {
    const producto = porId.get(id);
    return producto === undefined ? [] : [{ producto, cantidad }];
  });
  const cotizacion = items.length === 0 ? null : cotizarVenta(items, esHuesped);
  const total = ajuste?.montoAjustado ?? cotizacion?.total ?? 0;
  const filtrados = productos.filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()),
  );

  const cobrar = async () => {
    if (pago === null || cotizacion === null) return;
    setEnviando(true);
    setError(null);
    try {
      const ticket = await servidor.registrarVenta(
        {
          items: items.map(({ producto, cantidad }) => ({
            productoId: producto.id,
            cantidad,
          })),
          esHuesped,
          habitacionReferenciaId: esHuesped ? habitacionId : null,
          ajuste,
          pagos: [{ ...pago, monto: total }],
        },
        clave,
      );
      renovarClave();
      const vuelto = ticket.pagos.reduce(
        (suma, p) => suma + (p.vuelto ?? 0),
        0,
      );
      setExito(
        `Venta cobrada: ticket #${ticket.numero}, ${soles(ticket.total)}.${vuelto > 0 ? ` Vuelto: ${soles(vuelto)}.` : ""}`,
      );
      setCarrito(new Map());
      setAjuste(null);
      setEsHuesped(false);
      setHabitacionId(null);
      cargar();
      campoCodigo.current?.focus();
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex items-start gap-4">
      <Card className="min-w-0 flex-1">
        <CardHeader>
          <CardTitle>Productos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Campo
              etiqueta="Código de barras"
              ayuda="Escanee o escriba el código y pulse Enter."
            >
              <Input
                ref={campoCodigo}
                autoFocus
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                onKeyDown={(e) => void leerCodigo(e)}
              />
            </Campo>
            <Campo etiqueta="Buscar por nombre">
              <Input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </Campo>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
            {filtrados.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => agregar(p)}
                  className="flex w-full flex-col items-start rounded-md border bg-background p-3 text-left text-sm hover:bg-muted"
                >
                  <span className="font-medium">{p.nombre}</span>
                  <span className="text-muted-foreground">
                    Público {soles(p.precioPublico)} · Huésped{" "}
                    {soles(p.precioHuesped)}
                  </span>
                  {p.controlaStock && (
                    <span
                      className={`text-xs ${p.stock <= 0 ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      Stock: {p.stock}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {filtrados.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay productos que coincidan.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="w-[26rem] shrink-0">
        <CardHeader>
          <CardTitle>Venta</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {error !== null && (
            <Aviso tipo="error" onCerrar={() => setError(null)}>
              {error}
            </Aviso>
          )}
          {exito !== null && <Aviso tipo="exito">{exito}</Aviso>}
          <div
            className="flex gap-2"
            role="radiogroup"
            aria-label="Tipo de comprador"
          >
            <Button
              type="button"
              role="radio"
              aria-checked={!esHuesped}
              variant={!esHuesped ? "default" : "outline"}
              onClick={() => setEsHuesped(false)}
            >
              Público
            </Button>
            <Button
              type="button"
              role="radio"
              aria-checked={esHuesped}
              variant={esHuesped ? "default" : "outline"}
              onClick={() => setEsHuesped(true)}
            >
              Huésped
            </Button>
          </div>
          {esHuesped && (
            <Campo etiqueta="Habitación (opcional, solo como referencia)">
              <select
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={habitacionId ?? ""}
                onChange={(e) =>
                  setHabitacionId(e.target.value === "" ? null : e.target.value)
                }
              >
                <option value="">Sin habitación</option>
                {ocupadas.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.numero}
                  </option>
                ))}
              </select>
            </Campo>
          )}
          {items.length === 0 ? (
            <p className="text-muted-foreground">El carrito está vacío.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border">
              {cotizacion?.lineas.map((linea, i) => {
                const item = items[i];
                if (item === undefined) return null;
                const excede =
                  item.producto.controlaStock &&
                  item.cantidad > item.producto.stock;
                return (
                  <li
                    key={item.producto.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="min-w-0">
                      {linea.descripcion}
                      <span className="block text-xs text-muted-foreground">
                        {soles(linea.precioUnitario)} c/u
                        {excede ? ` · stock ${item.producto.stock}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label={`Quitar uno de ${item.producto.nombre}`}
                        onClick={() => agregar(item.producto, -1)}
                      >
                        −
                      </Button>
                      <span className="w-6 text-center">{item.cantidad}</span>
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label={`Agregar uno de ${item.producto.nombre}`}
                        onClick={() => agregar(item.producto)}
                      >
                        +
                      </Button>
                      <span className="w-20 text-right">
                        {soles(linea.importe)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {cotizacion !== null && (
            <>
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span>
                <span>{soles(total)}</span>
              </div>
              {tienePermiso(sesion, "store.manual_adjustment") && (
                <AjustePuntual
                  key={cotizacion.total}
                  minimo={cotizacion.total}
                  onCambio={setAjuste}
                />
              )}
              <SelectorPago
                total={total}
                metodos={metodos}
                onCambio={setPago}
              />
            </>
          )}
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button
            className="flex-1"
            disabled={cotizacion === null || pago === null || enviando}
            onClick={() => void cobrar()}
          >
            {enviando ? "Cobrando…" : `Cobrar ${soles(total)}`}
          </Button>
          <Button
            variant="outline"
            disabled={items.length === 0}
            onClick={() => setCarrito(new Map())}
          >
            Vaciar
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
