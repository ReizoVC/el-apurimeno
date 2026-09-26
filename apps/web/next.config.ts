import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@apurimeno/ui", "@apurimeno/contracts", "@apurimeno/domain"],
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
