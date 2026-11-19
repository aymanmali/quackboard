import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg", "mysql2"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
