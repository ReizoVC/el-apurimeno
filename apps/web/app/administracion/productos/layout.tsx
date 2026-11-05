"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const PESTANAS = [
  { href: "/administracion/productos", etiqueta: "Productos" },
  { href: "/administracion/productos/categorias", etiqueta: "Categorías" },
];

/** Subzonas de Productos: cada una tiene su página, para que las categorías no queden debajo de una lista larga. */
export default function LayoutProductos({ children }: { children: ReactNode }) {
  const ruta = usePathname();
  return (
    <>
      <nav className="flex gap-1 border-b text-sm" aria-label="Productos">
        {PESTANAS.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            aria-current={ruta === p.href ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 hover:text-foreground ${
              ruta === p.href
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground"
            }`}
          >
            {p.etiqueta}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
