import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TARANG 2026 — AIIMS New Delhi Annual Cultural Fest",
    short_name: "TARANG 2026",
    description:
      "Official web application for TARANG 2026, South Asia's largest medical college cultural, literary, and sports fest at AIIMS New Delhi.",
    start_url: "/",
    display: "standalone",
    background_color: "#141310",
    theme_color: "#6e0001",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
