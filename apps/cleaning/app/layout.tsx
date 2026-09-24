import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@apurimeno/ui/globals.css";

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "El Apurimeño - Limpieza",
  description: "Módulo de limpieza de habitaciones",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${fontSans.variable} ${fontMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
