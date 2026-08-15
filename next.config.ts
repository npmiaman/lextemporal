import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ["better-sqlite3"],
  // Ship the seeded cache DB inside the serverless bundle (copied to /tmp at runtime).
  outputFileTracingIncludes: {
    "/**": ["./data/lex.db"],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
