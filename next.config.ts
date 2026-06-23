import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Supplier document uploads pass through a server action (FormData).
    serverActions: { bodySizeLimit: "15mb" },
  },
};

export default nextConfig;
