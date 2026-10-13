#!/usr/bin/env bash
#
# tarang-deploy — the ONLY thing the CI deploy key can run on the origin.
#
# Installed by bootstrap-lightsail.sh as /usr/local/sbin/tarang-deploy (root,
# 0755). The `deploy` user's authorized_keys entry forces every SSH session
# through /usr/local/bin/tarang-deploy-ssh, which runs this via a sudoers rule
# that allows exactly this one binary. So a leaked CI key can do no more than
# ask for a deploy of a commit that is already on `main` using an image from
# our own registry repository — it never gets a shell.
#
# Commands (passed as the SSH command line):
#   deploy <40-char git sha> <registry/repo@sha256:digest>
#       Registry token (read-only, short-lived) is read from stdin, if any.
#   rollback [<registry/repo@sha256:digest>]
#   status
#
# Config: /etc/tarang-deploy.conf (root-owned), written by bootstrap:
#   APP_DIR=/opt/tarang
#   IMAGE_REPO=ghcr.io/<owner>/<repo>
#   DEPLOY_BRANCH=main
#   REGISTRY=ghcr.io

set -euo pipefail
umask 027
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

CONF=/etc/tarang-deploy.conf
LOG=/var/log/tarang-deploy.log
LOCK=/run/lock/tarang-deploy.lock

die() { echo "!! $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "tarang-deploy must run as root (via sudo)."
[ -f "$CONF" ] || die "$CONF missing — run infra/scripts/bootstrap-lightsail.sh first."
# shellcheck source=/dev/null
. "$CONF"
: "${APP_DIR:?APP_DIR missing from $CONF}"
: "${IMAGE_REPO:?IMAGE_REPO missing from $CONF}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
REGISTRY="${REGISTRY:-${IMAGE_REPO%%/*}}"
STATE_DIR="${STATE_DIR:-/var/lib/tarang}"

# Strict argument grammar. Anything else is refused before touching the box.
SHA_RE='^[0-9a-f]{40}$'
IMAGE_RE="^${IMAGE_REPO//./\\.}@sha256:[0-9a-f]{64}$"

CMD="${1:-}"
case "$CMD" in
  deploy)
    [ "$#" -eq 3 ] || die "usage: deploy <git-sha> <image@sha256:digest>"
    SHA="$2"; IMAGE="$3"
    [[ "$SHA" =~ $SHA_RE ]] || die "invalid git sha"
    [[ "$IMAGE" =~ $IMAGE_RE ]] || die "image must be ${IMAGE_REPO}@sha256:<digest>"
    ;;
  rollback)
    [ "$#" -le 2 ] || die "usage: rollback [image@sha256:digest]"
    IMAGE="${2:-}"
    if [ -n "$IMAGE" ]; then
      [[ "$IMAGE" =~ $IMAGE_RE ]] || die "image must be ${IMAGE_REPO}@sha256:<digest>"
    fi
    ;;
  status)
    [ "$#" -eq 1 ] || die "usage: status"
    ;;
  *)
    die "unknown command. Allowed: deploy <sha> <image>, rollback [image], status"
    ;;
esac

# Read an optional registry token from stdin BEFORE redirecting output, without
# ever echoing it. Interactive/manual runs simply have no token.
TOKEN=""
if [ "$CMD" = "deploy" ] && [ ! -t 0 ]; then
  IFS= read -r -t 10 TOKEN || true
fi

if [ "$CMD" = "status" ]; then
  cd "$APP_DIR"
  echo "commit:        $(git rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "active slot:   $(cat "$STATE_DIR/active-slot" 2>/dev/null || echo 'none')"
  echo "current image: $(cat "$STATE_DIR/current-image" 2>/dev/null || echo 'none')"
  echo "previous:      $(cat "$STATE_DIR/previous-image" 2>/dev/null || echo 'none')"
  CUR="$(cat "$STATE_DIR/current-image" 2>/dev/null || true)"
  if [ -n "$CUR" ]; then
    TARANG_IMAGE="$CUR" docker compose -f docker-compose.yml ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' || true
  fi
  echo "--- recent deploys"
  tail -n 10 "$STATE_DIR/deploy-history.log" 2>/dev/null || true
  exit 0
fi

# One deploy/rollback at a time. CI also serialises, but a manual run on the
# box must never interleave with a pipeline run.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "==> Another deploy is in progress; waiting up to 15 minutes for the lock"
  flock -w 900 9 || die "timed out waiting for the deploy lock"
fi

# Everything below is also appended to the deploy log on the box.
exec > >(tee -a "$LOG") 2>&1
echo "======== $(date -u +%Y-%m-%dT%H:%M:%SZ) tarang-deploy $CMD (by ${SUDO_USER:-root})"

cd "$APP_DIR"
[ -f .env ] || die "$APP_DIR/.env is missing. Create it (mode 600) before deploying — see docs/13-lightsail-deployment.md."

if [ "$CMD" = "rollback" ]; then
  exec ./infra/scripts/rollback.sh ${IMAGE:+"$IMAGE"}
fi

# ---------------------------------------------------------------------------
# deploy: 1) check out the exact commit, which must already be on the branch
# ---------------------------------------------------------------------------
echo "==> Fetching origin/$DEPLOY_BRANCH"
git fetch --quiet --prune origin "+refs/heads/${DEPLOY_BRANCH}:refs/remotes/origin/${DEPLOY_BRANCH}"
git cat-file -e "${SHA}^{commit}" 2>/dev/null || die "commit $SHA not found on origin"
git merge-base --is-ancestor "$SHA" "origin/${DEPLOY_BRANCH}" \
  || die "commit $SHA is not on origin/${DEPLOY_BRANCH}; refusing to deploy it"
git -c advice.detachedHead=false checkout --quiet --force --detach "$SHA"
echo "==> Checked out $(git log -1 --format='%h %s')"

# ---------------------------------------------------------------------------
# 2) pull the image with a throwaway credential store
# ---------------------------------------------------------------------------
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> Image already present locally: $IMAGE"
else
  DOCKER_CONFIG="$(mktemp -d)"
  export DOCKER_CONFIG
  trap 'rm -rf "$DOCKER_CONFIG"' EXIT
  if [ -n "$TOKEN" ]; then
    printf '%s' "$TOKEN" | docker login "$REGISTRY" -u tarang-deploy --password-stdin >/dev/null \
      || die "registry login failed"
  fi
  echo "==> Pulling $IMAGE"
  pulled=0
  for attempt in 1 2 3; do
    if docker pull --quiet "$IMAGE"; then pulled=1; break; fi
    echo "   pull attempt $attempt failed; retrying in $((attempt * 5))s"
    sleep $((attempt * 5))
  done
  docker logout "$REGISTRY" >/dev/null 2>&1 || true
  rm -rf "$DOCKER_CONFIG"; unset DOCKER_CONFIG; trap - EXIT
  [ "$pulled" -eq 1 ] || die "could not pull $IMAGE"
fi
TOKEN=""

# ---------------------------------------------------------------------------
# 3) hand off to the blue/green orchestration in the checked-out commit
# ---------------------------------------------------------------------------
TARANG_IMAGE="$IMAGE" TARANG_SKIP_PULL=1 DEPLOYMENT_ID="${SHA:0:12}" \
  ./infra/scripts/deploy.sh
