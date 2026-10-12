import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.PUBLIC_SITE_URL ||
    process.env.APP_BASE_URL ||
    "http://localhost:3000";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/admin/*",
          "/api/*",
          "/scanner",
          "/scanner/*",
          "/dashboard",
          "/dashboard/*",
          "/checkout",
          "/checkout/*",
          "/auth/*",
          "/complete-profile",
          "/login",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
