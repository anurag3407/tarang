#!/usr/bin/env bash
#
# restore-drill.sh — restore a logical backup into an ISOLATED Supabase
# project to validate RPO/RTO (plan §15.11). Never run against production.
#
# Usage:
#   RESTORE_URL=postgres://... AGE_IDENTITY=/path/to/key.txt \
#   BACKUP_OBJECT=backups/tarang-20270101T000000Z.sql.age ./restore-drill.sh
#
# The target must be a throwaway project. The script refuses to run if
# RESTORE_URL points at the production host (set PROD_HOST to guard).

set -euo pipefail

: "${RESTORE_URL:?RESTORE_URL must be set (isolated target project)}"
: "${AGE_IDENTITY:?AGE_IDENTITY must be set (path to age private key)}"
: "${BACKUP_OBJECT:?BACKUP_OBJECT must be set (s3 key of the .age backup)}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET must be set}"

if [ "${CONFIRM_ISOLATED_TARGET:-0}" != "1" ]; then
  echo "!! SAFETY REFUSAL: You must pass CONFIRM_ISOLATED_TARGET=1 to run restore-drill.sh." >&2
  echo "!! restore-drill.sh runs 'pg_restore --clean --if-exists' and WIPES existing data on RESTORE_URL." >&2
  echo "!! Never run this against a production database." >&2
  exit 1
fi

# Compare against production URL patterns
PROD_HOST="${PROD_HOST:-}"
if [ -n "$PROD_HOST" ] && [[ "$RESTORE_URL" == *"$PROD_HOST"* ]]; then
  echo "!! REFUSING: RESTORE_URL points at PROD_HOST ($PROD_HOST)." >&2
  exit 1
fi
# Exact host comparison (D6): extract the host from RESTORE_URL (after any
# userinfo, before any port/path) and refuse an exact match even when the
# substring check above is fooled by e.g. a bare domain in PROD_HOST.
if [ -n "$PROD_HOST" ]; then
  RESTORE_HOST="$(printf '%s' "$RESTORE_URL" \
    | sed -E -e 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##' -e 's#^.*@##')"
  case "$RESTORE_HOST" in
    \[*\]*) RESTORE_HOST="$(printf '%s' "$RESTORE_HOST" | sed -E 's#^(\[[^]]*\]).*$#\1#')" ;;
    *) RESTORE_HOST="$(printf '%s' "$RESTORE_HOST" | sed -E 's#[:/].*$##')" ;;
  esac
  if [ -n "$RESTORE_HOST" ] && [ "$RESTORE_HOST" = "$PROD_HOST" ]; then
    echo "!! REFUSING: RESTORE_URL host ($RESTORE_HOST) exactly matches PROD_HOST." >&2
    exit 1
  fi
fi

# If a local .env exists, check if RESTORE_URL matches production session/direct URLs
if [ -f ".env" ]; then
  ENV_PROD_URL="$(grep -E '^(SUPABASE_DB_SESSION_URL|SUPABASE_DB_DIRECT_URL)=' .env | cut -d= -f2- | tr -d '"'"'" || true)"
  for u in $ENV_PROD_URL; do
    if [ -n "$u" ] && [ "$RESTORE_URL" = "$u" ]; then
      echo "!! REFUSING: RESTORE_URL exactly matches production DB URL from .env." >&2
      exit 1
    fi
  done
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
ENC="$WORKDIR/backup.age"
DUMP="$WORKDIR/backup.custom"

echo "==> Downloading $BACKUP_OBJECT"
aws --endpoint-url "${BACKUP_S3_ENDPOINT}" s3 cp \
  "s3://${BACKUP_S3_BUCKET}/${BACKUP_OBJECT}" "$ENC"

echo "==> Verifying checksum"
aws --endpoint-url "${BACKUP_S3_ENDPOINT}" s3 cp \
  "s3://${BACKUP_S3_BUCKET}/${BACKUP_OBJECT}.sha256" "$ENC.sha256"
( cd "$WORKDIR" && sha256sum -c "$(basename "$ENC").sha256" )

echo "==> Decrypting"
age -d -i "$AGE_IDENTITY" -o "$DUMP" "$ENC"

echo "==> Restoring into isolated project"
pg_restore --dbname="$RESTORE_URL" --clean --if-exists --no-owner "$DUMP"

echo "==> Restore drill complete. Validate:"
echo "    - auth configuration & custom role passwords"
echo "    - RLS policies, extensions"
echo "    - data counts vs production"
echo "    - provider mappings, webhooks, secrets (restored separately)"
echo "    Record measured RPO/RTO."
