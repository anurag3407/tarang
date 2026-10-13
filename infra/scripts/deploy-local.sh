#!/usr/bin/env bash
#
# deploy-local.sh — build the image on this host, then deploy it.
#
# Use this when the GHCR path is unavailable: CI bakes NEXT_PUBLIC_* into the
# client bundle from repo *Variables*, and setting those requires GitHub admin
# on the repo. Without them CI still builds, but the browser gets `undefined`
# for the Supabase URL/key and every login dies. Building here reads the same
# values from /opt/tarang/.env instead, so there is one source of truth.
#
# Usage:
#   cd /opt/tarang && git pull && ./infra/scripts/deploy-local.sh
#
# Trade-offs versus the CI path (docs/11-vps-razorpay-golive.md Phase 6):
#   - No SBOM and no Trivy CRITICAL/HIGH gate. Nothing scans this image.
#   - Build load lands on the production box (see the swap note in docs/12).
#   - The image exists only here, so a rebuilt VPS must rebuild it.
# Prefer CI (docs/13-lightsail-deployment.md): it builds off-box and is the normal path.
#
# Tagging: tarang:local-<sha> — immutable per commit, so /var/lib/tarang's
# previous-image still points at a genuinely different image and rollback.sh
# keeps working. A single reused `tarang:local` tag would silently break that.

set -euo pipefail

cd "$(dirname "$0")/../.."
REPO_ROOT="$(pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "!! $ENV_FILE not found — create it before deploying (docs/11 Phase 5)." >&2
  exit 1
fi

# Read one KEY=VALUE from .env without sourcing it, so a stray backtick or $( )
# in a secret can't execute. Last occurrence wins, matching dotenv semantics.
env_get() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=//p" "$ENV_FILE" \
    | tail -1 \
    | sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

SUPABASE_URL="$(env_get NEXT_PUBLIC_SUPABASE_URL)"
SUPABASE_KEY="$(env_get NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
RAZORPAY_KEY="$(env_get NEXT_PUBLIC_RAZORPAY_KEY_ID)"

# These are inlined at build time and cannot be fixed by a restart, so refuse
# to build a broken image rather than discover it as a dead login page.
missing=""
[ -n "$SUPABASE_URL" ]  || missing="$missing NEXT_PUBLIC_SUPABASE_URL"
[ -n "$SUPABASE_KEY" ]  || missing="$missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
[ -n "$RAZORPAY_KEY" ]  || missing="$missing NEXT_PUBLIC_RAZORPAY_KEY_ID"
if [ -n "$missing" ]; then
  echo "!! Missing required build values in $ENV_FILE:$missing" >&2
  echo "!! These are baked into the client bundle — a restart cannot supply them." >&2
  exit 1
fi

SHA="$(git rev-parse --short HEAD)"
if ! git diff --quiet || ! git diff --cached --quiet; then
  if [ "${ALLOW_DIRTY:-0}" != "1" ]; then
    echo "!! Working tree is dirty. Commit or stash changes before deploying (or pass ALLOW_DIRTY=1)." >&2
    exit 1
  else
    echo "!! Warning: working tree is dirty; proceeding with ALLOW_DIRTY=1."
  fi
fi

IMAGE="tarang:local-$SHA"

echo "==> Building $IMAGE"
echo "    NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL"
echo "    NEXT_PUBLIC_RAZORPAY_KEY_ID=$RAZORPAY_KEY"
docker build \
  --build-arg "DEPLOYMENT_ID=$SHA" \
  --build-arg "NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL" \
  --build-arg "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_KEY" \
  --build-arg "NEXT_PUBLIC_RAZORPAY_KEY_ID=$RAZORPAY_KEY" \
  -t "$IMAGE" \
  "$REPO_ROOT"

echo "==> Handing off to deploy.sh"
# Reuse deploy.sh for state recording, readiness, nginx validate/reload and drain
# so the local path and the CI path stay behaviourally identical.
TARANG_IMAGE="$IMAGE" TARANG_SKIP_PULL=1 exec "$REPO_ROOT/infra/scripts/deploy.sh"
