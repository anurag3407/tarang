#!/usr/bin/env bash
#
# backup-db.sh — off-provider logical backup of the Supabase Postgres database
# (plan §15.11).
#
# - Dumps roles, schema, and data via pg_dump against the session/direct
#   connection (NOT the transaction pooler — plan §15.7).
# - Encrypts with `age` using an offline-held recovery key.
# - Uploads to a separate provider with Object Lock retention.
# - Verifies checksum + upload + age.
#
# Required env:
#   PG_DUMP_URL   postgres connection string (session/direct, not txn pool)
#   AGE_RECIPIENT age public key (BACKUP_AGE_RECIPIENT in the env contract)
#   BACKUP_S3_ENDPOINT / BACKUP_S3_BUCKET / BACKUP_S3_ACCESS_KEY_ID /
#   BACKUP_S3_SECRET_ACCESS_KEY   Object-Lock-capable destination
#
# Schedule: nightly normally; every 6h during the event window; immediately
# before migrations/bulk admin changes (plan §15.11).

set -euo pipefail

: "${PG_DUMP_URL:?PG_DUMP_URL must be set (session/direct connection)}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT must be set (age public key)}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET must be set}"

ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

send_alert() {
  local msg="$1"
  echo "!! ALERT: $msg" >&2
  if [ -n "$ALERT_WEBHOOK_URL" ]; then
    curl -fsS -X POST -H "Content-Type: application/json" \
      -d "{\"content\": \"[PULSE DB BACKUP FAILED] $msg\"}" \
      "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
}

trap 'send_alert "Backup script failed unexpectedly on line $LINENO"' ERR

# Validate required CLI tools upfront
for cmd in pg_dump age sha256sum aws; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    send_alert "Required command '$cmd' is not installed or not in PATH."
    exit 1
  fi
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

DUMP="$WORKDIR/pulse-${STAMP}.sql"
ENC="${DUMP}.age"

echo "==> Dumping schema + data"
pg_dump "$PG_DUMP_URL" \
  --no-owner \
  --no-privileges \
  --format=custom \
  --file="$DUMP.custom"

echo "==> Encrypting with age"
age -r "$AGE_RECIPIENT" -o "$ENC" "$DUMP.custom"
rm -f "$DUMP.custom"

echo "==> Checksum"
sha256sum "$ENC" > "${ENC}.sha256"

echo "==> Uploading to Object-Lock bucket"
aws --endpoint-url "${BACKUP_S3_ENDPOINT}" s3 cp "$ENC" \
  "s3://${BACKUP_S3_BUCKET}/backups/$(basename "$ENC")"
aws --endpoint-url "${BACKUP_S3_ENDPOINT}" s3 cp "${ENC}.sha256" \
  "s3://${BACKUP_S3_BUCKET}/backups/$(basename "${ENC}").sha256"

echo "==> Verifying upload integrity"
aws --endpoint-url "${BACKUP_S3_ENDPOINT}" s3api head-object \
  --bucket "$BACKUP_S3_BUCKET" \
  --key "backups/$(basename "$ENC")" > /dev/null

# ---------------------------------------------------------------------------
# Retention pruning (D8): remove backups older than RETENTION_DAYS so the
# Object-Lock bucket does not grow without bound. Best-effort on top of any
# bucket lifecycle policy; object-lock refusals alert instead of failing the
# completed backup. Set RETENTION_DAYS=0 to disable.
# ---------------------------------------------------------------------------
prune_old_backups() {
  local cutoff list key stamp
  if date -u -d "$RETENTION_DAYS days ago" +%Y%m%dT%H%M%SZ >/dev/null 2>&1; then
    cutoff="$(date -u -d "$RETENTION_DAYS days ago" +%Y%m%dT%H%M%SZ)"
  else
    cutoff="$(date -u -v-"${RETENTION_DAYS}"d +%Y%m%dT%H%M%SZ)"
  fi

  list="$WORKDIR/backup-list.txt"
  if ! aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3api list-objects-v2 \
       --bucket "$BACKUP_S3_BUCKET" --prefix "backups/pulse-" \
       --query "Contents[].Key" --output text > "$list" 2>/dev/null; then
    send_alert "Could not list backups for retention pruning (prune skipped this run)."
    return 0
  fi

  tr '\t' '\n' < "$list" | while read -r key; do
    [ -z "$key" ] && continue
    # Parse pulse-<YYYYMMDDTHHMMSSZ>.sql.age; skip anything that does not match.
    stamp="$(basename "$key" | sed -E 's/^pulse-([0-9]{8}T[0-9]{6}Z)\.sql\.age$/\1/')"
    [ "$stamp" = "$key" ] && continue
    if [[ "$stamp" < "$cutoff" ]]; then
      echo "==> Pruning $key (older than ${RETENTION_DAYS}d retention)"
      aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 rm "s3://${BACKUP_S3_BUCKET}/${key}" \
        || send_alert "Failed to prune $key (object lock? manual cleanup needed)"
    fi
  done
}

if [ "${RETENTION_DAYS:-30}" -gt 0 ] 2>/dev/null; then
  prune_old_backups
else
  echo "==> Retention pruning disabled (RETENTION_DAYS=$RETENTION_DAYS)"
fi

echo "==> Backup complete: pulse-${STAMP}"
