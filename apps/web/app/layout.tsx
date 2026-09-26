import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@apurimeno/ui/globals.css";
import { Shell } from "../src/componentes/Shell";

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "El Apurimeño · Dashboard",
  description: "Administración del hospedaje por horas",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${fontSans.variable} ${fontMono.variable}`}>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
