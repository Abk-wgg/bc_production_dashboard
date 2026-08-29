import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained .next/standalone folder at build time. That is
  // what gets copied to the internal server (plus .next/static and public/)
  // and run with `node server.js`. No Azure, no Vercel.
  output: "standalone",

  // If this is served from a sub-path on an existing internal site
  // (e.g. http://intranet/production), uncomment and set:
  // basePath: "/production",
};

export default nextConfig;
