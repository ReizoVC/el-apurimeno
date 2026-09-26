import type { Metadata, Viewport } from "next";
import "@apurimeno/ui/globals.css";
import "./owner.css";

export const metadata: Metadata = {
  title: "El Apurimeño · Resumen",
  description: "Resumen del negocio para la propietaria",
  // Además de la cabecera X-Robots-Tag y robots.txt: la app no debe aparecer en buscadores.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-muted/40 antialiased">{children}</body>
    </html>
  );
}
