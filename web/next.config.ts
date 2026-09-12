import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tauri's WebView loads the development app from 127.0.0.1 while Next's
  // dev server may identify the page as localhost. Allow both loopback
  // origins so webpack HMR and client chunks are not blocked by Next.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
