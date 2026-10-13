#!/usr/bin/env bash
#
# update-cloudflare-cidrs.sh — keep the origin's Cloudflare trust current
# (plan §15.5.7: automate safe CIDR updates with console recovery available).
#
# Fetches Cloudflare's published IPv4/IPv6 ranges and applies them to:
#   1. nginx real_ip trust (/etc/nginx/snippets/cloudflare-real-ip.conf) —
#      validated with `nginx -t` and reloaded only if valid; the previous file
#      is restored on failure.
#   2. UFW (when active): port 443 is allowed ONLY from these ranges. Rules
#      for ranges Cloudflare has withdrawn are deleted; the applied set is
#      recorded in $STATE_DIR/cloudflare-ufw-cidrs.txt.
#
# Safe to re-run at any time. Runs weekly via tarang-cloudflare-cidrs.timer and
# once from bootstrap-lightsail.sh.

set -euo pipefail

CONF="${CONF:-/etc/nginx/snippets/cloudflare-real-ip.conf}"
STATE_DIR="${STATE_DIR:-/var/lib/tarang}"
UFW_STATE="$STATE_DIR/cloudflare-ufw-cidrs.txt"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
TMP="$WORKDIR/candidate.conf"

echo "==> Fetching published Cloudflare ranges"
curl -fsS --retry 3 --max-time 20 https://www.cloudflare.com/ips-v4 -o "$WORKDIR/cf-v4.txt"
curl -fsS --retry 3 --max-time 20 https://www.cloudflare.com/ips-v6 -o "$WORKDIR/cf-v6.txt"

# Keep only well-formed CIDRs; anything else in the response is ignored.
grep -E '^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$' "$WORKDIR/cf-v4.txt" > "$WORKDIR/v4" || true
grep -Ei '^[0-9a-f:]+/[0-9]{1,3}$' "$WORKDIR/cf-v6.txt" > "$WORKDIR/v6" || true
cat "$WORKDIR/v4" "$WORKDIR/v6" | sort -u > "$WORKDIR/all"

# Sanity: refuse to install an empty/truncated list.
COUNT="$(wc -l < "$WORKDIR/all" | tr -d ' ')"
if [ "$COUNT" -lt 10 ]; then
  echo "!! Fetched range list looks wrong ($COUNT entries) — aborting, nothing changed." >&2
  exit 1
fi

{
  echo "# Cloudflare real-IP trust — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# by update-cloudflare-cidrs.sh. Do not hand-edit."
  echo
  echo "# IPv4"
  sed 's/.*/set_real_ip_from &;/' "$WORKDIR/v4"
  echo
  echo "# IPv6"
  sed 's/.*/set_real_ip_from &;/' "$WORKDIR/v6"
} > "$TMP"

# ---------------------------------------------------------------------------
# 1. nginx
# ---------------------------------------------------------------------------
echo "==> Installing nginx real_ip trust ($COUNT ranges)"
mkdir -p "$(dirname "$CONF")"
if [ -f "$CONF" ]; then cp "$CONF" "${CONF}.bak"; fi
cp "$TMP" "$CONF"

if command -v nginx >/dev/null 2>&1; then
  if ! nginx -t 2>/dev/null; then
    echo "!! nginx -t failed — restoring previous config." >&2
    if [ -f "${CONF}.bak" ]; then cp "${CONF}.bak" "$CONF"; else rm -f "$CONF"; fi
    nginx -t || true
    exit 1
  fi
  if systemctl is-active --quiet nginx; then
    echo "==> Reloading nginx"
    systemctl reload nginx
  fi
fi

# ---------------------------------------------------------------------------
# 2. UFW: 443 from Cloudflare only
# ---------------------------------------------------------------------------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  mkdir -p "$STATE_DIR"
  touch "$UFW_STATE"
  # Add first, then remove withdrawn ranges, so there is never a window in
  # which a valid Cloudflare edge is blocked.
  added=0; removed=0
  while read -r cidr; do
    if ! grep -qxF "$cidr" "$UFW_STATE"; then
      ufw allow proto tcp from "$cidr" to any port 443 comment 'cloudflare' >/dev/null
      added=$((added + 1))
    fi
  done < "$WORKDIR/all"
  while read -r cidr; do
    [ -n "$cidr" ] || continue
    if ! grep -qxF "$cidr" "$WORKDIR/all"; then
      ufw --force delete allow proto tcp from "$cidr" to any port 443 comment 'cloudflare' >/dev/null 2>&1 \
        || ufw --force delete allow proto tcp from "$cidr" to any port 443 >/dev/null 2>&1 || true
      removed=$((removed + 1))
    fi
  done < "$UFW_STATE"
  cp "$WORKDIR/all" "$UFW_STATE"
  echo "==> UFW: 443 restricted to Cloudflare (+$added / -$removed rules)"
else
  echo "==> UFW not active; skipped firewall sync"
fi

echo "==> Cloudflare CIDRs updated ($COUNT ranges)."
