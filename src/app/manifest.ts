import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MyHomeLibrary",
    short_name: "HomeLibrary",
    description: "Catalog and share your home library.",
    start_url: "/library",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f0e4",
    theme_color: "#f6f0e4",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
