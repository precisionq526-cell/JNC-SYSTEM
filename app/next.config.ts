import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['mupdf'],
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "210mb",
      allowedOrigins: ["127.0.0.1:3100", "localhost:3100", ...(process.env.NEXT_PUBLIC_LAN_IP ? [process.env.NEXT_PUBLIC_LAN_IP + ':3100'] : [])],
    },
  },
  allowedDevOrigins: ["192.168.1.21"],
};

export default nextConfig;
