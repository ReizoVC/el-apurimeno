import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@apurimeno/ui", "@apurimeno/contracts"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
  experimental: {
    turbo: {},
  },
};

export default nextConfig;
