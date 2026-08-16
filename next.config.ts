import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // tesseract.js spawns a worker thread by resolving a path relative to its own
  // file. Bundled, that path points into the compiled output, the spawn never
  // completes and an image upload hangs forever — 296 ms of real OCR work turned
  // into an infinite spinner. Left external, it is require()'d from node_modules
  // and resolves its worker normally.
  serverExternalPackages: ["better-sqlite3", "tesseract.js"],
  // Ship the seeded cache DB inside the serverless bundle (copied to /tmp at runtime).
  outputFileTracingIncludes: {
    "/**": ["./data/lex.db"],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
