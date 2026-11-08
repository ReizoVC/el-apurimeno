import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// La versión con que se compiló esta página: si el servidor ya tiene otra, hay que recargarla (decisión 30 de contracts).
const { version } = JSON.parse(
  readFileSync(
    join(process.cwd(), "..", "native", "src-tauri", "tauri.conf.json"),
    "utf8",
  ),
) as { version: string };

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_VERSION_SISTEMA: version },
  // Carpeta del build. `apps/server/scripts/recompilar-produccion.ps1` compila en otra (CARPETA_COMPILACION=.next-nuevo)
  // mientras el servicio sigue sirviendo `.next`, y las cambia al final. Sin la variable, `.next` como siempre.
  distDir: process.env["CARPETA_COMPILACION"] || ".next",
  transpilePackages: [
    "@apurimeno/ui",
    "@apurimeno/contracts",
    "@apurimeno/domain",
    "@apurimeno/formato",
  ],
  // contracts y domain importan sus módulos con extensión .js (ESM de Node); aquí se resuelven a .ts.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default nextConfig;
