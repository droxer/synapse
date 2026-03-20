import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Rewrites removed — backend proxy is now handled by
  // src/app/api/[...proxy]/route.ts which injects auth headers.
};

export default nextConfig;
