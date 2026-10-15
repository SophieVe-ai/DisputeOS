import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WebAssembly + data files; load it from node_modules rather than bundling it.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
