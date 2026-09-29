import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Carpeta del build. `apps/server/scripts/recompilar-produccion.ps1` compila en otra (CARPETA_COMPILACION=.next-nuevo)
  // mientras el servicio sigue sirviendo `.next`, y las cambia al final. Sin la variable, `.next` como siempre.
  distDir: process.env["CARPETA_COMPILACION"] || ".next",
  transpilePackages: ["@apurimeno/ui", "@apurimeno/contracts", "@apurimeno/domain", "@apurimeno/formato"],
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
