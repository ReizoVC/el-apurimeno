"use client";

import { useEffect, useState } from "react";
import { type Producto } from "@apurimeno/contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apurimeno/ui/components/card";
import { Input } from "@apurimeno/ui/components/input";
import { obtenerProductos } from "../src/api-mock";

function formatearPrecio(centimos: number): string {
  return `S/ ${(centimos / 100).toFixed(2)}`;
}

export default function StoreCatalogPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    obtenerProductos()
      .then((data) => {
        setProductos(data);
      })
      .finally(() => {
        setCargando(false);
      });
  }, []);

  const termino = busqueda.trim().toLowerCase();
  const productosFiltrados = productos.filter((producto) => {
    if (!termino) return true;
    const coincideNombre = producto.nombre.toLowerCase().includes(termino);
    const coincideCodigo = producto.codigoBarras
      ? producto.codigoBarras.toLowerCase().includes(termino)
      : false;
    return coincideNombre || coincideCodigo;
  });

  return (
    <main className="container mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Catálogo de Tienda
          </h1>
          <p className="text-sm text-muted-foreground">
            Consulta de productos, precios y disponibilidad de stock
          </p>
        </div>

        <div className="w-full sm:w-72 md:w-80">
          <Input
            type="search"
            placeholder="Buscar por nombre o código..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full"
            aria-label="Buscar producto por nombre o código de barras"
          />
        </div>
      </div>

      {cargando ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Cargando catálogo de productos...
        </p>
      ) : productos.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No hay productos disponibles en el catálogo.
        </p>
      ) : productosFiltrados.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No se encontraron productos que coincidan con &ldquo;{busqueda}
            &rdquo;.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-xs text-muted-foreground">
            Mostrando {productosFiltrados.length} de {productos.length}{" "}
            productos
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {productosFiltrados.map((producto) => (
              <Card
                key={producto.id}
                className="flex flex-col justify-between overflow-hidden shadow-sm transition-shadow hover:shadow-md"
              >
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-1">
                    <CardTitle className="text-base font-semibold leading-tight line-clamp-2 break-words">
                      {producto.nombre}
                    </CardTitle>
                    <CardDescription className="text-xs font-mono text-muted-foreground break-all">
                      {producto.codigoBarras
                        ? `Código: ${producto.codigoBarras}`
                        : "Sin código de barras"}
                    </CardDescription>
                  </div>
                </CardHeader>

                <CardContent className="pt-0">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-2.5 text-xs">
                      <div>
                        <span className="text-[11px] text-muted-foreground block">
                          Precio Huésped
                        </span>
                        <span className="text-sm font-semibold text-foreground">
                          {formatearPrecio(producto.precioHuesped)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] text-muted-foreground block">
                          Precio Público
                        </span>
                        <span className="text-sm font-semibold text-foreground">
                          {formatearPrecio(producto.precioPublico)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t pt-2 text-xs">
                      <span className="text-muted-foreground">
                        Stock disponible:
                      </span>
                      {producto.controlaStock ? (
                        <span
                          className={
                            producto.stock > 0
                              ? "font-medium text-foreground"
                              : "font-medium text-destructive"
                          }
                        >
                          {producto.stock > 0
                            ? `${producto.stock} uds.`
                            : "Agotado (0)"}
                        </span>
                      ) : (
                        <span className="font-medium text-muted-foreground">
                          No aplica
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
