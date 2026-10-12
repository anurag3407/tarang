#!/usr/bin/env bash
#
# update-cloudflare-cidrs.sh — regenerate the trusted Cloudflare IP ranges for
# nginx real_ip (plan §15.5.7: automate safe CIDR updates with console
# recovery available).
#
# Fetches the published ranges, writes a new cloudflare-real-ip.conf, validates
# with `nginx -t`, and reloads only if validation passes. Keeps the previous
# file for instant recovery.

set -euo pipefail

CONF="${CONF:-/etc/nginx/conf.d/cloudflare-real-ip.conf}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
TMP="$WORKDIR/candidate.conf"

echo "==> Fetching published Cloudflare ranges"
curl -fsS https://www.cloudflare.com/ips-v4 -o "$WORKDIR/cf-v4.txt"
curl -fsS https://www.cloudflare.com/ips-v6 -o "$WORKDIR/cf-v6.txt"

{
  echo "# Cloudflare real-IP trust — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# by update-cloudflare-cidrs.sh. Do not hand-edit."
  echo
  echo "# IPv4"
  while read -r cidr; do
    [ -n "$cidr" ] && echo "set_real_ip_from ${cidr};"
  done < "$WORKDIR/cf-v4.txt"
  echo
  echo "# IPv6"
  while read -r cidr; do
    [ -n "$cidr" ] && echo "set_real_ip_from ${cidr};"
  done < "$WORKDIR/cf-v6.txt"
} > "$TMP"

# Sanity: refuse to install an empty/truncated list.
COUNT="$(grep -c "set_real_ip_from" "$TMP" || true)"
if [ "$COUNT" -lt 10 ]; then
  echo "!! Fetched range list looks wrong ($COUNT entries) — aborting." >&2
  exit 1
fi

echo "==> Validating candidate config"
mkdir -p "$(dirname "$CONF")"
[ -f "$CONF" ] && cp "$CONF" "${CONF}.bak" || true
cp "$TMP" "$CONF"

if command -v nginx >/dev/null 2>&1; then
  if ! nginx -t; then
    echo "!! nginx -t failed — restoring previous config." >&2
    [ -f "${CONF}.bak" ] && cp "${CONF}.bak" "$CONF" || rm -f "$CONF"
    nginx -t
    exit 1
  fi

  echo "==> Reloading nginx"
  nginx -s reload
fi

echo "==> Cloudflare CIDRs updated ($COUNT ranges)."
