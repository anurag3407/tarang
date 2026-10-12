import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * Next.js configuration (plan §15.3, §10.6).
 *
 * - `output: "standalone"` produces the minimal server bundle the Docker
 *   image ships.
 * - `cacheHandler` (singular) backs ISR / server cache / route-handler
 *   responses with a shared store so multiple processes and origins see the
 *   same content and revalidate together. We use `unstable_cache` (server
 *   cache), not `'use cache: remote'` directives, so the plural
 *   `cacheHandlers` config is intentionally not set (plan §10.6.2).
 * - `cacheMaxMemorySize: 0` disables the per-process in-memory LRU because
 *   the shared handler is authoritative.
 * - `deploymentId` gives version-skew protection during rolling deploys.
 */
const isVercel = Boolean(process.env.VERCEL);

const nextConfig: NextConfig = {
  // Only produce standalone bundle when building for Docker / VPS self-hosting.
  // On Vercel, serverless lambdas are built automatically.
  output: isVercel ? undefined : "standalone",

  // Shared Redis cache handler across processes in production
  cacheHandler:
    process.env.NODE_ENV === "production"
      ? require.resolve("./cache-handlers/server-cache-handler.mjs")
      : undefined,
  cacheMaxMemorySize: 0,

  // Deterministic deployment id so rolling instances serve consistent assets.
  deploymentId: process.env.DEPLOYMENT_ID || undefined,

  // The worker process and cache handlers talk to Upstash/Supabase directly;
  // keep them out of the client bundle.
  serverExternalPackages: ["@upstash/redis", "@supabase/supabase-js"],

  // pnpm's isolated node_modules layout hides Next's runtime dependency on
  // @swc/helpers (loaded by its require-hook for dynamic routes) from the
  // output file tracer; force-include it for standalone Docker builds.
  outputFileTracingIncludes: isVercel
    ? undefined
    : {
        "/*": [
          "./node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**/*",
        ],
      },

  // No next/image remote sources are used; keep the optimizer locked down.
  images: {
    remotePatterns: [],
  },

  // Strict mode is on by default; keep headers minimal here (Nginx/Cloudflare
  // own transport security per plan §15.4/§15.6).
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "sayalabs",
  project: "javascript-nextjs-wr",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  tunnelRoute: "/monitoring",

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,
});

