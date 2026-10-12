#!/usr/bin/env bash
#
# setup-vps-cicd.sh — One-time setup on Hostinger VPS for automated GitHub Actions CI/CD
#
# Run this script once on your Hostinger VPS:
#   chmod +x infra/scripts/setup-vps-cicd.sh
#   ./infra/scripts/setup-vps-cicd.sh
#

set -euo pipefail

REPO_DIR="${1:-/opt/pulse}"
SSH_DIR="$HOME/.ssh"
DEPLOY_KEY="$SSH_DIR/id_ed25519_deploy"

echo "========================================================"
echo "  PULSE — Hostinger VPS CI/CD Automation Setup"
echo "========================================================"

mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"

# 1. Generate SSH Deploy Key if it doesn't exist
if [ ! -f "$DEPLOY_KEY" ]; then
  echo "==> Generating dedicated Git Deploy Key ($DEPLOY_KEY)..."
  ssh-keygen -t ed25519 -C "pulse-vps-deploy" -f "$DEPLOY_KEY" -N ""
else
  echo "==> Git Deploy Key already exists at $DEPLOY_KEY"
fi

# 2. Configure SSH client to use this deploy key for GitHub
SSH_CONFIG="$SSH_DIR/config"
if ! grep -q "Host github.com" "$SSH_CONFIG" 2>/dev/null; then
  echo "==> Configuring $SSH_CONFIG for github.com..."
  cat <<EOF >> "$SSH_CONFIG"

Host github.com
    IdentityFile $DEPLOY_KEY
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
EOF
  chmod 600 "$SSH_CONFIG"
fi

# 3. Test/Add GitHub host keys
ssh-keyscan -t ed25519 github.com >> "$SSH_DIR/known_hosts" 2>/dev/null || true
chmod 600 "$SSH_DIR/known_hosts" 2>/dev/null || true

# 4. Check repo directory and update remote to SSH
if [ -d "$REPO_DIR/.git" ]; then
  cd "$REPO_DIR"
  CURRENT_REMOTE="$(git remote get-url origin 2>/dev/null || true)"
  echo "==> Current git remote: $CURRENT_REMOTE"

  # If remote is HTTPS, convert to SSH format
  if [[ "$CURRENT_REMOTE" =~ ^https://github.com/(.*)(\.git)?$ ]]; then
    REPO_PATH="${BASH_REMATCH[1]}"
    REPO_PATH="${REPO_PATH%.git}"
    NEW_REMOTE="git@github.com:${REPO_PATH}.git"
    echo "==> Switching remote from HTTPS to SSH: $NEW_REMOTE"
    git remote set-url origin "$NEW_REMOTE"
  fi
else
  echo "!! Warning: Repository directory $REPO_DIR not found. Clone it first if needed."
fi

# 5. Ensure scripts are executable
if [ -d "$REPO_DIR/infra/scripts" ]; then
  chmod +x "$REPO_DIR"/infra/scripts/*.sh
fi

echo "========================================================"
echo "  NEXT STEPS TO COMPLETE AUTOMATION:"
echo "========================================================"
echo ""
echo "1. COPY THIS PUBLIC DEPLOY KEY:"
echo "--------------------------------------------------------"
cat "${DEPLOY_KEY}.pub"
echo "--------------------------------------------------------"
echo "   Go to your GitHub Repository -> Settings -> Deploy keys -> Add deploy key"
echo "   - Title: Hostinger VPS Deploy Key"
echo "   - Key: (paste the key printed above)"
echo "   - Allow write access: Unchecked (read-only is sufficient)"
echo ""
echo "2. ADD SECRETS IN GITHUB ACTIONS:"
echo "   Go to GitHub Repository -> Settings -> Secrets and variables -> Actions -> New repository secret:"
echo "   - VPS_HOST        : Your VPS IPv4 address"
echo "   - VPS_USER        : The SSH user you log in with (e.g. root or deploy)"
echo "   - VPS_SSH_KEY     : Your private SSH key for accessing the VPS"
echo "   - VPS_SSH_PORT    : 22 (or your custom SSH port if changed)"
echo "   - VPS_DEPLOY_PATH : $REPO_DIR"
echo ""
echo "========================================================"
echo "Setup helper completed successfully."
