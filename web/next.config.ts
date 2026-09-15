import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // "/" menghidangkan halaman pelajar statik (public/index.html)
    return [{ source: "/", destination: "/index.html" }];
  },
};

export default nextConfig;
