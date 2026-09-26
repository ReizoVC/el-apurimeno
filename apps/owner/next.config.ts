import type { NextConfig } from "next";

// Vista remota de la propietaria: sitio estático (output: 'export') que se sube a Cloudflare Pages. Todo corre en el
// navegador y habla solo con Supabase; no hay servidor propio.

const url = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
const clave = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] ?? "";

if (url === "" || clave === "") {
  throw new Error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (ver apps/owner/.env.example).",
  );
}
// La clave queda dentro del sitio publicado: solo puede ser la publicable. Una secreta o service_role daría acceso
// total al proyecto a cualquiera que abra la página. (La app vuelve a comprobarlo al iniciar, con la misma regla de
// @apurimeno/contracts.)
const carga = clave.split(".")[1];
const esServiceRole =
  carga !== undefined &&
  (() => {
    try {
      return (
        (
          JSON.parse(Buffer.from(carga, "base64url").toString("utf8")) as {
            role?: unknown;
          }
        ).role === "service_role"
      );
    } catch {
      return false;
    }
  })();
if (clave.startsWith("sb_secret_") || esServiceRole) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY es una clave secreta: use la clave publicable (sb_publishable_…).",
  );
}

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  transpilePackages: [
    "@apurimeno/ui",
    "@apurimeno/contracts",
    "@apurimeno/domain",
    "@apurimeno/formato",
  ],
  // contracts, domain y formato importan sus módulos con extensión .js (ESM de Node); aquí se resuelven a .ts.
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
