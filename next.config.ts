import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse starts a pdf.js worker from a file next to its own code. Bundling moves that
  // code and the worker is no longer found, so load these from node_modules as they are.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
