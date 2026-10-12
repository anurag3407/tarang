# syntax=docker/dockerfile:1
#
# PULSE 2026 production image (plan §15.3).
#
# Multi-stage:
#   deps    — pnpm frozen install (lockfile authoritative)
#   builder — typegen, Next standalone build, worker bundle
#   runner  — minimal runtime: standalone server + worker bundle, non-root
#
# One immutable image serves both the `web` and `worker` containers
# (docker-compose.yml picks the entrypoint). No `pnpm install` ever runs on
# the production host.

ARG NODE_VERSION=22.14.0

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Deterministic build/deployment id baked into the image.
ARG DEPLOYMENT_ID=local
ENV DEPLOYMENT_ID=${DEPLOYMENT_ID}
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* values are inlined into the client bundle by `next build`, so
# they must be present HERE, at build time — supplying them only via the
# runtime .env leaves the browser with `undefined` and breaks Supabase auth
# (src/lib/env-public.ts -> src/lib/supabase/browser.ts).
#
# All three are public by design (publishable/anon key, Razorpay key id), so
# baking them into the image leaks nothing. The consequence is that the image
# becomes environment-specific: build one image per environment, and rebuild
# if the Supabase project or Razorpay key id changes.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_RAZORPAY_KEY_ID
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
ENV NEXT_PUBLIC_RAZORPAY_KEY_ID=${NEXT_PUBLIC_RAZORPAY_KEY_ID}

# Route types must exist before the production build.
RUN pnpm typegen

# Production Next build (standalone output) + worker bundle.
RUN pnpm build
RUN pnpm build:worker

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as a dedicated non-root user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Standalone server: server.js + static + public.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Worker bundle (fully self-contained — no node_modules needed).
COPY --from=builder --chown=nextjs:nodejs /app/dist/worker.cjs ./dist/worker.cjs

# Writable mount points for exports, Next's runtime cache, and temporary files
# under the read-only root filesystem. docker-compose mounts named volumes over
# .exports and .next/cache; creating them here preserves uid/gid 1001 when each
# volume is initialized for the first time.
RUN mkdir -p /app/.exports /app/.next/cache /tmp/pulse \
 && chown -R nextjs:nodejs /app/.exports /app/.next/cache /tmp/pulse
ENV EXPORT_DIR=/app/.exports

USER nextjs

EXPOSE 3000

# Default is the web server; docker-compose overrides for the worker.
CMD ["node", "server.js"]
