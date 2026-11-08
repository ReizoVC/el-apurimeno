"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  LIMITE_MOVIMIENTOS_INVENTARIO,
  type MovimientoHistorial,
} from "@apurimeno/contracts";
import { Badge } from "@apurimeno/ui/components/badge";
import { Card, CardContent } from "@apurimeno/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apurimeno/ui/components/table";
import { cantidadConUnidad, fechaHora } from "@apurimeno/formato";
import {
  Aviso,
  CLASE_SELECT,
  Campo,
  Encabezado,
} from "../../../../src/componentes/comunes";
import { useCarga } from "../../../../src/lib/carga";
import {
  MOTIVO_SALIDA,
  TIPO_MOVIMIENTO_INVENTARIO,
} from "../../../../src/lib/rotulos";
import { servidor } from "../../../../src/lib/servidor";

/** Historial del stock (kardex): de todos los productos o de uno, con el stock que dejó cada movimiento (decisión 29). */
export default function PaginaMovimientos() {
  return (
    <Suspense>
      <Movimientos />
    </Suspense>
  );
}

function Movimientos() {
  const parametros = useSearchParams();
  const [productoId, setProductoId] = useState(
    parametros.get("producto") ?? "",
  );
  const productos = useCarga(() => servidor.productos(), []);
  const movimientos = useCarga(
    () =>
      servidor.movimientosInventario(
        productoId === "" ? undefined : productoId,
      ),
    [productoId],
  );

  return (
    <>
      <Encabezado
        titulo="Historial de stock"
        descripcion="Cada entrada, salida, conteo, venta y anulación. Los movimientos no se editan: un error se corrige con otro movimiento."
      />
      {movimientos.error !== null && (
        <Aviso tipo="error">{movimientos.error}</Aviso>
      )}
      {productos.error !== null && (
        <Aviso tipo="error">{productos.error}</Aviso>
      )}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <Campo etiqueta="Producto">
            <select
              className={`${CLASE_SELECT} w-64`}
              value={productoId}
              onChange={(e) => setProductoId(e.target.value)}
            >
              <option value="">Todos</option>
              {productos.datos?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Movimiento</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Detalle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movimientos.datos?.map((fila) => (
                <Fila key={fila.movimiento.id} fila={fila} />
              ))}
            </TableBody>
          </Table>
          {movimientos.datos?.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Todavía no hay movimientos.
            </p>
          )}
          {movimientos.datos?.length === LIMITE_MOVIMIENTOS_INVENTARIO && (
            <p className="text-sm text-muted-foreground">
              Se muestran los últimos {LIMITE_MOVIMIENTOS_INVENTARIO}. Para ver
              más de un producto, elíjalo arriba.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Fila({ fila }: { fila: MovimientoHistorial }) {
  const { movimiento: m, saldo, ticketNumero } = fila;
  const detalle = [
    ticketNumero === null ? null : `Ticket #${ticketNumero}`,
    m.tipo === "CONTEO" && m.cantidad === 0 ? "Sin diferencia" : null,
    m.motivoSalida === null ? null : MOTIVO_SALIDA[m.motivoSalida],
    m.motivo,
  ].filter((t) => t !== null);
  // En milésimas (decisión 31 de contracts): se muestran en la unidad del producto.
  const enUnidad = (milesimas: number) =>
    cantidadConUnidad(milesimas, fila.unidad);
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {fechaHora(m.creadoEn)}
      </TableCell>
      <TableCell className="font-medium">{fila.productoNombre}</TableCell>
      <TableCell>
        {TIPO_MOVIMIENTO_INVENTARIO[m.tipo]}
        {m.tipo === "VENTA" && saldo < 0 && (
          <Badge className="ml-2 bg-red-600 text-white">Sin stock</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        {m.cantidad > 0 ? "+" : ""}
        {enUnidad(m.cantidad).replace(/^-/, "−")}
      </TableCell>
      <TableCell
        className={`text-right font-medium ${saldo < 0 ? "text-red-600" : ""}`}
      >
        {enUnidad(saldo)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {fila.creadoPorNombre}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {detalle.join(" · ")}
      </TableCell>
    </TableRow>
  );
}
