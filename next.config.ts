import type { NextConfig } from "next";
import { coverHostRules } from "./src/lib/cover-hosts";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    // Only book covers go through the optimizer: provider hosts and our own "covers" bucket (see src/lib/cover-hosts.ts).
    remotePatterns: coverHostRules(process.env.NEXT_PUBLIC_SUPABASE_URL),
    // Few widths, so each cover makes only a handful of variants (covers show at 32 to 208 px; 3x phones need up to 640).
    imageSizes: [48, 96, 160, 256],
    deviceSizes: [384, 640],
    qualities: [75],
    formats: ["image/avif", "image/webp"],
    // A cover never changes at a given URL (changing it saves a new URL), so keep optimized copies for 30 days.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  experimental: {
    // Reuse a visited dynamic page for 30 s on navigation. Server actions that revalidate or set cookies clear it.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
