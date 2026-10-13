#!/usr/bin/env bash
#
# bootstrap-lightsail.sh — provision (or re-converge) the TARANG origin on a
# fresh Ubuntu 24.04 AWS Lightsail instance. Idempotent: re-run it any time
# infra/ changes (nginx, systemd, deploy entrypoint) to apply those changes.
#
# Run as root FROM A CHECKOUT OF THIS REPO (it installs files relative to
# itself), e.g.:
#   sudo DEPLOY_PUBKEY="ssh-ed25519 AAAA... github-actions-tarang" \
#        ./infra/scripts/bootstrap-lightsail.sh
#
# What it does (docs/13-lightsail-deployment.md explains each piece):
#   - OS: full upgrade, unattended security upgrades, 4G swap, kernel/network
#     sysctl hardening, journald cap
#   - SSH: key-only, no root, AllowUsers, fail2ban
#   - Firewall: UFW default-deny; 22 rate-limited; 443 from Cloudflare only
#   - Docker Engine + compose plugin (hardened daemon.json)
#   - nginx mainline from nginx.org (signing key fingerprint verified)
#   - nginx config for $TARANG_DOMAIN, Cloudflare AOP CA, origin TLS
#     (self-signed placeholder until the Cloudflare Origin Certificate is
#     installed)
#   - /opt/tarang checkout, /var/lib/tarang state, systemd units
#   - `deploy` user whose SSH key can ONLY run /usr/local/sbin/tarang-deploy
#
# Env knobs:
#   TARANG_DOMAIN   apex domain                (default tarangfest.in)
#   IMAGE_REPO      allowed image repository   (default ghcr.io/anurag3407/tarang)
#   REPO_URL        git remote for /opt/tarang (default https://github.com/anurag3407/tarang.git)
#   DEPLOY_BRANCH   branch deploys must be on  (default main)
#   DEPLOY_PUBKEY   CI public key for the `deploy` user (optional on re-runs)
#   ADMIN_USER      interactive admin account  (default ubuntu)
#   SWAP_SIZE_GB    swap file size             (default 4)

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

TARANG_DOMAIN="${TARANG_DOMAIN:-tarangfest.in}"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/anurag3407/tarang}"
REPO_URL="${REPO_URL:-https://github.com/anurag3407/tarang.git}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_PUBKEY="${DEPLOY_PUBKEY:-}"
ADMIN_USER="${ADMIN_USER:-ubuntu}"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-4}"

APP_DIR=/opt/tarang
STATE_DIR=/var/lib/tarang
SRC="$(cd "$(dirname "$0")/../.." && pwd)"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { echo "!! $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
[ -f "$SRC/infra/nginx/nginx.conf" ] || die "run from a checkout of the repo ($SRC has no infra/)"
. /etc/os-release
[ "${VERSION_CODENAME:-}" = "noble" ] || echo "!! Warning: tested on Ubuntu 24.04 (noble); this is ${PRETTY_NAME:-unknown}"
id "$ADMIN_USER" >/dev/null 2>&1 || die "admin user '$ADMIN_USER' does not exist"
[ -s "/home/$ADMIN_USER/.ssh/authorized_keys" ] || die "$ADMIN_USER has no authorized_keys — refusing to harden SSH and lock you out"

# ---------------------------------------------------------------------------
log "Base packages + full upgrade"
# ---------------------------------------------------------------------------
apt-get update -q
apt-get -q -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold full-upgrade
apt-get -q -y install ca-certificates curl gnupg git jq ufw fail2ban \
  unattended-upgrades apt-listchanges gettext-base openssl logrotate

# ---------------------------------------------------------------------------
log "Unattended security upgrades (no automatic reboots)"
# ---------------------------------------------------------------------------
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
# Reboots stay manual: an unplanned reboot mid-sale is worse than a delayed
# kernel patch. /var/run/reboot-required tells you when one is pending.
cat > /etc/apt/apt.conf.d/52tarang-unattended-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades >/dev/null

# ---------------------------------------------------------------------------
log "Swap (${SWAP_SIZE_GB}G) — headroom for blue/green overlap on a 4 GB box"
# ---------------------------------------------------------------------------
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  fallocate -l "${SWAP_SIZE_GB}G" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

# ---------------------------------------------------------------------------
log "Kernel / network hardening"
# ---------------------------------------------------------------------------
cat > /etc/sysctl.d/99-tarang-hardening.conf <<'EOF'
# Memory: prefer RAM, use swap only under pressure.
vm.swappiness = 10
vm.vfs_cache_pressure = 50

# Network hardening.
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
net.ipv4.conf.all.log_martians = 1

# Connection capacity for burst traffic (ticket drops).
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.ip_local_port_range = 10240 65535
fs.file-max = 1048576

# Kernel info leaks.
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
EOF
sysctl --system >/dev/null

mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/tarang.conf <<'EOF'
[Journal]
SystemMaxUse=500M
EOF
systemctl restart systemd-journald

# ---------------------------------------------------------------------------
log "Docker Engine + compose plugin"
# ---------------------------------------------------------------------------
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

mkdir -p /etc/docker
DAEMON_SUM_BEFORE="$(sha256sum /etc/docker/daemon.json 2>/dev/null || true)"
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true,
  "no-new-privileges": true,
  "userland-proxy": false,
  "icc": false
}
EOF

# ---------------------------------------------------------------------------
log "nginx mainline from nginx.org (Ubuntu's 1.24 lacks 'http2 on;')"
# ---------------------------------------------------------------------------
NGINX_KEYRING=/usr/share/keyrings/nginx-archive-keyring.gpg
if [ ! -f "$NGINX_KEYRING" ]; then
  curl -fsSL https://nginx.org/keys/nginx_signing.key | gpg --dearmor -o "$NGINX_KEYRING.tmp"
  # Verify the published nginx signing key fingerprint before trusting it.
  if ! gpg --dry-run --quiet --no-keyring --import --import-options import-show "$NGINX_KEYRING.tmp" 2>/dev/null \
       | grep -q 573BFD6B3D8FBC641079A6ABABF5BD827BD9BF62; then
    rm -f "$NGINX_KEYRING.tmp"
    die "nginx signing key fingerprint mismatch — refusing to add the repository"
  fi
  mv "$NGINX_KEYRING.tmp" "$NGINX_KEYRING"
fi
echo "deb [signed-by=$NGINX_KEYRING] https://nginx.org/packages/mainline/ubuntu ${VERSION_CODENAME} nginx" \
  > /etc/apt/sources.list.d/nginx.list
printf 'Package: *\nPin: origin nginx.org\nPin: release o=nginx\nPin-Priority: 900\n' \
  > /etc/apt/preferences.d/99nginx

apt-get update -q
apt-get -q -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin nginx
systemctl enable --now docker >/dev/null
# Restart only when daemon.json changed (live-restore keeps containers up
# across a daemon restart anyway, but there is no reason to bounce it).
if [ "$DAEMON_SUM_BEFORE" != "$(sha256sum /etc/docker/daemon.json)" ]; then
  systemctl restart docker
fi

# ---------------------------------------------------------------------------
log "nginx configuration for $TARANG_DOMAIN"
# ---------------------------------------------------------------------------
install -d -m 0755 /etc/nginx/snippets /etc/nginx/conf.d
install -d -m 0700 /etc/nginx/tls
install -m 0644 "$SRC/infra/nginx/nginx.conf" /etc/nginx/nginx.conf
install -m 0644 "$SRC/infra/nginx/snippets/security-headers.conf" /etc/nginx/snippets/security-headers.conf
# Seed the real-IP list from the repo; update-cloudflare-cidrs refreshes it.
[ -f /etc/nginx/snippets/cloudflare-real-ip.conf ] \
  || install -m 0644 "$SRC/infra/nginx/snippets/cloudflare-real-ip.conf" /etc/nginx/snippets/cloudflare-real-ip.conf
TARANG_DOMAIN="$TARANG_DOMAIN" envsubst '${TARANG_DOMAIN}' \
  < "$SRC/infra/nginx/conf.d/tarang-single-domain.conf" > /etc/nginx/conf.d/tarang.conf
# The upstream file is owned by deploy/rollback (it names the live slot);
# only seed it, never overwrite it.
[ -f /etc/nginx/conf.d/tarang-upstream.conf ] \
  || install -m 0644 "$SRC/infra/nginx/conf.d/tarang-upstream.conf" /etc/nginx/conf.d/tarang-upstream.conf
# nginx.org ships a sample server block that collides with ours.
rm -f /etc/nginx/conf.d/default.conf /etc/nginx/sites-enabled/default

# Cloudflare Authenticated Origin Pulls CA (public, fixed).
if [ ! -s /etc/nginx/tls/cloudflare-aop-ca.pem ]; then
  curl -fsSL -o /etc/nginx/tls/cloudflare-aop-ca.pem \
    https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem
fi
grep -q "BEGIN CERTIFICATE" /etc/nginx/tls/cloudflare-aop-ca.pem || die "AOP CA download is not a certificate"

# Origin certificate: keep the real Cloudflare Origin Certificate if present,
# otherwise install a short-lived self-signed placeholder so nginx can start.
# Cloudflare (Full strict) rejects the placeholder with 526 until replaced —
# see docs/13-lightsail-deployment.md "Origin certificate".
if [ ! -s /etc/nginx/tls/origin.pem ] || [ ! -s /etc/nginx/tls/origin.key ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
    -subj "/CN=${TARANG_DOMAIN}" \
    -keyout /etc/nginx/tls/origin.key -out /etc/nginx/tls/origin.pem 2>/dev/null
  touch /etc/nginx/tls/PLACEHOLDER-CERT
fi
chmod 0600 /etc/nginx/tls/origin.key
chmod 0644 /etc/nginx/tls/origin.pem /etc/nginx/tls/cloudflare-aop-ca.pem

nginx -t
systemctl enable nginx >/dev/null
# Reload (zero downtime) when already running; start it otherwise.
systemctl reload-or-restart nginx

# ---------------------------------------------------------------------------
log "Application checkout ($APP_DIR) and state ($STATE_DIR)"
# ---------------------------------------------------------------------------
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --quiet --branch "$DEPLOY_BRANCH" "$REPO_URL" "$APP_DIR"
fi
chown -R root:root "$APP_DIR"
chmod 0755 "$APP_DIR"
[ ! -f "$APP_DIR/.env" ] || { chown root:root "$APP_DIR/.env"; chmod 0600 "$APP_DIR/.env"; }
install -d -m 0750 "$STATE_DIR"

cat > /etc/tarang-deploy.conf <<EOF
# Written by bootstrap-lightsail.sh — read by /usr/local/sbin/tarang-deploy.
APP_DIR=$APP_DIR
STATE_DIR=$STATE_DIR
IMAGE_REPO=$IMAGE_REPO
DEPLOY_BRANCH=$DEPLOY_BRANCH
EOF
chmod 0644 /etc/tarang-deploy.conf

# ---------------------------------------------------------------------------
log "Deploy entrypoint + restricted 'deploy' user"
# ---------------------------------------------------------------------------
install -m 0755 -o root -g root "$SRC/infra/scripts/tarang-deploy.sh" /usr/local/sbin/tarang-deploy
install -m 0755 -o root -g root "$SRC/infra/scripts/update-cloudflare-cidrs.sh" /usr/local/sbin/tarang-update-cloudflare-cidrs
cat > /usr/local/bin/tarang-deploy-ssh <<'EOF'
#!/bin/sh
# Forced command for the CI deploy key (see ~deploy/.ssh/authorized_keys).
# Word-splitting of SSH_ORIGINAL_COMMAND is intentional; globbing is not, and
# tarang-deploy validates every argument against a strict grammar.
set -f
# shellcheck disable=SC2086
exec /usr/bin/sudo -n /usr/local/sbin/tarang-deploy $SSH_ORIGINAL_COMMAND
EOF
chmod 0755 /usr/local/bin/tarang-deploy-ssh

if ! id deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/sh --comment "TARANG CI deploy (forced command)" deploy
fi
usermod -p '*' deploy   # no password at all (key-only), but not "locked"

cat > /etc/sudoers.d/tarang-deploy <<'EOF'
# The CI deploy user may run exactly one root program, which validates its
# arguments itself. Nothing else.
deploy ALL=(root) NOPASSWD: /usr/local/sbin/tarang-deploy
EOF
chmod 0440 /etc/sudoers.d/tarang-deploy
visudo -cf /etc/sudoers.d/tarang-deploy >/dev/null

# authorized_keys is root-owned so the deploy user cannot add itself an
# unrestricted key.
install -d -m 0755 -o root -g root /home/deploy/.ssh
if [ -n "$DEPLOY_PUBKEY" ]; then
  case "$DEPLOY_PUBKEY" in
    ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;;
    *) die "DEPLOY_PUBKEY does not look like an SSH public key" ;;
  esac
  printf 'restrict,command="/usr/local/bin/tarang-deploy-ssh" %s\n' "$DEPLOY_PUBKEY" \
    > /home/deploy/.ssh/authorized_keys
fi
touch /home/deploy/.ssh/authorized_keys
chown root:root /home/deploy/.ssh/authorized_keys
chmod 0644 /home/deploy/.ssh/authorized_keys

# ---------------------------------------------------------------------------
log "SSH hardening"
# ---------------------------------------------------------------------------
# Lives before 60-cloudimg-settings.conf: sshd keeps the FIRST value it sees.
# Lightsail's browser console authenticates with a CA-signed certificate
# (TrustedUserCAKeys), which is still publickey auth — it keeps working.
cat > /etc/ssh/sshd_config.d/10-tarang-hardening.conf <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
PermitEmptyPasswords no
MaxAuthTries 3
MaxSessions 4
LoginGraceTime 20
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowAgentForwarding no
PermitTunnel no
AllowUsers $ADMIN_USER deploy

Match User deploy
    AllowTcpForwarding no
    PermitTTY no
    ForceCommand /usr/local/bin/tarang-deploy-ssh
EOF
sshd -t
systemctl reload ssh

cat > /etc/fail2ban/jail.d/tarang.local <<'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
backend = systemd
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled = true
mode = aggressive
EOF
systemctl enable fail2ban >/dev/null
systemctl restart fail2ban

# ---------------------------------------------------------------------------
log "Firewall (UFW): deny by default, SSH rate-limited, 443 from Cloudflare only"
# ---------------------------------------------------------------------------
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw limit 22/tcp comment 'ssh' >/dev/null
# Remove any blanket web rules from earlier experiments.
ufw --force delete allow 80/tcp >/dev/null 2>&1 || true
ufw --force delete allow 443/tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null
/usr/local/sbin/tarang-update-cloudflare-cidrs

# ---------------------------------------------------------------------------
log "systemd units"
# ---------------------------------------------------------------------------
install -m 0644 "$SRC/infra/systemd/tarang-compose.service" /etc/systemd/system/tarang-compose.service
install -m 0644 "$SRC/infra/systemd/tarang-cloudflare-cidrs.service" /etc/systemd/system/tarang-cloudflare-cidrs.service
install -m 0644 "$SRC/infra/systemd/tarang-cloudflare-cidrs.timer" /etc/systemd/system/tarang-cloudflare-cidrs.timer
systemctl daemon-reload
systemctl enable tarang-compose.service >/dev/null
systemctl enable --now tarang-cloudflare-cidrs.timer >/dev/null

# ---------------------------------------------------------------------------
log "Done"
# ---------------------------------------------------------------------------
echo "docker:  $(docker --version)"
echo "compose: $(docker compose version --short)"
echo "nginx:   $(nginx -v 2>&1)"
echo
[ -f /etc/nginx/tls/PLACEHOLDER-CERT ] && \
  echo "TODO  install the Cloudflare Origin Certificate (docs/13 'Origin certificate')."
[ -f "$APP_DIR/.env" ] || \
  echo "TODO  create $APP_DIR/.env (root:root 0600) before the first deploy."
[ -s /home/deploy/.ssh/authorized_keys ] || \
  echo "TODO  re-run with DEPLOY_PUBKEY=... to authorise the CI deploy key."
[ -f /var/run/reboot-required ] && echo "NOTE  a reboot is required to finish applying kernel updates."
exit 0
