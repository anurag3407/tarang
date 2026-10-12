# 11 — VPS go-live & Razorpay webhook testing

Goal: get PULSE onto a Hostinger VPS behind a real HTTPS domain, then register and
test the Razorpay webhook. Chosen shape for this deploy:

- **Edge/TLS:** Cloudflare Full (strict) + Authenticated Origin Pulls (repo default)
- **Image delivery:** SSH to the VPS → local Docker build, tagged by commit via `deploy-local.sh`
- **Hostnames:** single root domain (no subdomains)

Throughout, `pulseasa.org` stands in for your domain — substitute yours.

---

## The ordering question (and one correction)

The dependency chain you identified is correct: Razorpay only accepts an **HTTPS**
webhook URL, so the domain and TLS must exist before the webhook can be registered.

One correction that saves a round trip: **Razorpay does not issue the webhook
secret — you choose it.** In the dashboard's Add Webhook form there's a *Secret*
field you fill in yourself. Razorpay then HMAC-SHA256s each request body with it
and sends the result as `X-Razorpay-Signature`. So generate it now:

```bash
openssl rand -hex 32
```

Keep that value. You'll paste the same string into both the Razorpay dashboard and
`RAZORPAY_WEBHOOK_SECRET_CURRENT`. What still has to wait for the domain is
*registering* the webhook, not knowing the secret.

> Your `.env` already has a value in `RAZORPAY_WEBHOOK_SECRET_CURRENT`. Unless you
> deliberately set it to a real dashboard secret, replace it — a mismatched secret
> fails the check at [`route.ts:46-51`](../src/app/api/webhooks/razorpay/route.ts#L46-L51)
> and every delivery returns 401.

---

## Phase 0 — blockers fixed before you start

Four things in the repo would have broken this deploy. They're already patched;
this is what changed and why, so the diff makes sense.

| Fix | Why it mattered |
|-----|-----------------|
| [`Dockerfile`](../Dockerfile) — added `NEXT_PUBLIC_*` build args | `next build` **inlines** `NEXT_PUBLIC_*` into the client bundle. Only `DEPLOYMENT_ID` was passed, so the browser got `undefined` for the Supabase URL/key and [`browser.ts:17`](../src/lib/supabase/browser.ts#L17) threw — all login and client data fetching dead, with a valid-looking `.env` on the host. |
| [`docker-compose.yml`](../docker-compose.yml) — `expose` → loopback-only `ports` (`127.0.0.1:3001:3000` on `web-blue`, `127.0.0.1:3002:3000` on `web-green`) | Nginx runs on the **host**, not in compose. `expose` publishes nothing, so the loopback upstream and `deploy.sh`'s readiness probe could never connect — deploy would hang then fail. Blue/green slots each get their own loopback port; nginx's generated `pulse-upstream.conf` points at whichever slot is active. |
| [`ci.yml`](../.github/workflows/ci.yml) — digest job output | The `image` job tagged `sha-<12 chars>` but `deploy-staging` pulled `sha-<full 40-char sha>` — a tag that never exists. Now both use the build's real digest, which also matches `deploy.sh`'s "never a mutable tag" rule. |
| [`.env.example`](../.env.example) — added `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Required in production by [`env.ts:147-148`](../src/lib/env.ts#L147-L148) but absent from the contract file, so a fresh `.env` copied from it would fail startup. |

Because `NEXT_PUBLIC_*` is baked in at build time, **the image is now
environment-specific.** Rebuild if the Supabase project or Razorpay key id changes.
Setting them only in `/opt/pulse/.env` is not enough.

---

## Phase 1 — VPS base setup

Hostinger → VPS → **Ubuntu 24.04** (a plain OS template, not a control-panel or
Docker-preinstalled one — this guide installs Docker and nginx itself, and the
distro/panel versions cause the conflicts noted below).

### Phase 1 step-by-step runbook

Use this runbook from top to bottom. Keep the first root SSH terminal open until
Step 7 has passed; that is your recovery path if an SSH or firewall change is wrong.

#### 1. Create the VPS

1. In Hostinger, open **VPS -> Create/Deploy VPS**.
2. Select **Ubuntu 24.04 LTS** and a plain OS image. Do not select a control panel,
   Docker Manager, or a preinstalled web stack; this guide installs and manages
   Docker and nginx directly.
3. Record the public IPv4 address. Use a plan with at least 2 GB RAM, matching the
   compose resource limits in this repository.
4. Skip Malware Scanner, Daily Auto-Backups, and Docker Manager. The app image is
   rebuilt from GHCR and the durable orders/payments data lives in Supabase. Back up
   the local `.env`, origin TLS key/certificate, and database separately later.

#### 2. Connect as root and verify the image

```bash
ssh root@<VPS_IP>
hostnamectl
cat /etc/os-release
ip -4 addr show
```

Confirm this is Ubuntu 24.04 and the address matches Hostinger before continuing.

#### 3. Patch Ubuntu and install base packages

```bash
apt update
DEBIAN_FRONTEND=noninteractive apt -y upgrade
apt install -y ca-certificates curl gnupg lsb-release git jq unzip ufw unattended-upgrades
systemctl enable --now unattended-upgrades
systemctl is-active unattended-upgrades
```

#### 4. Create the deploy user and install SSH keys

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
```

On your computer, use a passphrase-protected personal key and a separate key for
GitHub Actions (the CI key has no passphrase):

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_ed25519 -C "pulse-admin"
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_pulse_deploy -N "" -C "github-actions-pulse"
```

Paste both public keys, one per line, into the VPS file and secure it:

```bash
nano /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
```

#### 5. Install Docker Engine and Compose

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
usermod -aG docker deploy
docker --version
docker compose version
```

The Docker group is applied to new login sessions, so reconnect as `deploy` before
running compose commands.

#### 6. Install the nginx version required by this repository

The nginx configuration uses `http2 on;`, which requires nginx 1.25.1 or newer.
Ubuntu's distro package can be 1.24, so use nginx.org mainline:

```bash
install -d -m 755 /usr/share/keyrings
curl -fsSL https://nginx.org/keys/nginx_signing.key \
  | gpg --dearmor --yes -o /usr/share/keyrings/nginx-archive-keyring.gpg
printf '%s\n' "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] http://nginx.org/packages/mainline/ubuntu $(lsb_release -cs) nginx" \
  > /etc/apt/sources.list.d/nginx.list
apt update
apt install -y nginx gettext-base
nginx -v
systemctl enable nginx
```

Do not install the repository nginx config yet. `nginx -t` will remain invalid until
the origin certificate files are installed in Phase 3.

#### 7. Verify deploy access, then harden SSH

Open a second terminal and test the new account before changing SSH settings:

```bash
ssh -i ~/.ssh/id_ed25519 deploy@<VPS_IP>
sudo -v
docker ps
```

On Windows PowerShell, use:
`ssh -i $env:USERPROFILE\.ssh\id_ed25519 deploy@<VPS_IP>`.

From the root session, add the hardening drop-in and validate it before restarting:

```bash
install -d -m 755 /etc/ssh/sshd_config.d
cat >/etc/ssh/sshd_config.d/99-pulse-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
EOF
sshd -t
systemctl restart ssh
```

Start a fresh `ssh deploy@<VPS_IP>` connection and confirm it works. Only then close
the root session. The CI key is optional for this manual deployment path; if CI is
enabled later, store its private key as the GitHub `PROD_SSH_KEY` secret. Never
commit it or place it in `.env`.

> **If the Hostinger serial console shows `login:`:** `deploy` was created with
> `--disabled-password`, so it has no console password. Use SSH from your computer
> with the personal key (`ssh -i ~/.ssh/id_ed25519 deploy@<VPS_IP>`), then use
> `sudo -i` when a root shell is needed. If SSH is unavailable, use Hostinger's
> Browser Terminal/Recovery mode to run `passwd deploy`, then log in to the console
> as `deploy` and use `sudo -i`. Keep `PermitRootLogin no`; do not re-enable root SSH
> just to use the console.

#### 8. Configure UFW and the Hostinger firewall

Allow SSH first, then HTTPS only from Cloudflare. Port 3000 is loopback-only in
`docker-compose.yml` and must not be opened publicly:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH - restrict to admin IP after testing'
for ip in $(curl -fsS https://www.cloudflare.com/ips-v4); do
  ufw allow from "$ip" to any port 443 proto tcp
done
for ip in $(curl -fsS https://www.cloudflare.com/ips-v6); do
  ufw allow from "$ip" to any port 443 proto tcp
done
ufw --force enable
ufw status numbered
```

After confirming your fixed admin IP, replace the broad SSH rule:

```bash
ufw delete allow 22/tcp
ufw allow from <YOUR_ADMIN_PUBLIC_IP> to any port 22 proto tcp comment 'Admin SSH'
ufw status verbose
```

In Hostinger hPanel, permit TCP 22 from your admin IP and TCP 443 from Cloudflare.
Do not open 80, 3000, database ports, or Docker's remote API.

#### 9. Reboot and accept Phase 1

```bash
sudo reboot
```

Reconnect with the deploy key and run the acceptance checks:

```bash
ssh -i ~/.ssh/id_ed25519 deploy@<VPS_IP>
systemctl is-active docker nginx
docker compose version
ufw status
ss -lntp
```

Continue to Phase 2 only when Docker and nginx are active, UFW is enabled, key-only
deploy login works, and no public listener exists on port 3000. Save the VPS IP and,
once created in later phases, `/opt/pulse/.env` and `/etc/nginx/tls/origin.key` in a
password manager. Cloudflare CIDRs can change; schedule
`infra/scripts/update-cloudflare-cidrs.sh` after the repository is cloned and refresh
the UFW 443 rules when Cloudflare publishes new ranges.

### Hostinger add-ons: decline all three

The setup wizard offers Malware scanner, Daily auto-backups, and Docker manager.
None of them fit this architecture:

| Add-on | Decision | Reason |
|--------|----------|--------|
| Malware scanner (free) | Skip | Aimed at shared PHP hosting. The app runs non-root in `read_only: true` containers, so there is no writable web root to scan — it just adds a root agent competing for RAM. Re-addable later from the dashboard. |
| Daily auto-backups (paid) | Skip | See below. |
| Docker manager | Skip | Installs a panel layer that wants to own Docker's lifecycle, conflicting with the compose stack and `pulse-compose.service`, and with the clean Docker install below. |

**Why VPS snapshots are the wrong spend here: this box is nearly stateless.** The
app is an immutable image in GHCR (re-pullable by digest), the config is in git, and
the database is in Supabase. The only genuinely local state is `/opt/pulse/.env`,
the two files in `/etc/nginx/tls/`, and the `exports-data` volume. A lost VPS is a
rebuild from this document, not a restore.

The data that would actually end the fest — orders, payments, passes, admissions —
lives in Supabase, which gives no daily backups or PITR on the free tier. Backing up
the replaceable half while the irreplaceable half is unprotected is the wrong trade.
So instead:

1. Put `.env` and the origin cert/key in a password manager as soon as they exist.
   That is the practical VPS backup.
2. Schedule `infra/scripts/backup-db.sh` (encrypted `pg_dump` → S3 with Object
   Lock), pointed at `SUPABASE_DB_DIRECT_URL` — the **direct** connection, since
   `pg_dump` fails through the transaction pooler.
3. Check which Supabase plan you're on well before the event.

### Provisioning

Note the IPv4 address. Then as root:

```bash
ssh root@<VPS_IP>

# 1. Patch, then create a non-root deploy user
apt update && apt upgrade -y
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
# paste your public key:
nano /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

# 2. Docker + compose plugin
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# 3. Nginx from nginx.org mainline — NOT the distro package.
#    Ubuntu ships nginx 1.24, which rejects the `http2 on;` directive the
#    configs use (added in 1.25.1); `nginx -t` would fail on it.
curl -fsSL https://nginx.org/keys/nginx_signing.key \
  | gpg --dearmor > /usr/share/keyrings/nginx-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] \
http://nginx.org/packages/mainline/ubuntu $(lsb_release -cs) nginx" \
  > /etc/apt/sources.list.d/nginx.list
apt update && apt install -y nginx gettext-base
nginx -v   # expect >= 1.25.1
```

Harden SSH (`/etc/ssh/sshd_config`): `PermitRootLogin no`,
`PasswordAuthentication no`, then `systemctl restart ssh`. **Confirm you can log in
as `deploy` in a second terminal before closing this one.**

### Two SSH keys, not one

Generate a separate key for CI rather than reusing your personal one, so a leaked
repo secret doesn't hand over your laptop's identity and either can be rotated
alone:

| Key | Passphrase | Used by |
|-----|-----------|---------|
| `id_ed25519` | Yes | You, from your laptop |
| `id_pulse_deploy` | **No** — CI cannot type one | GitHub Actions (`PROD_SSH_KEY`) |

```powershell
# On your machine, for the CI key:
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_pulse_deploy -N '""' -C "github-actions-pulse"
```

Both `.pub` files go into `/home/deploy/.ssh/authorized_keys` (one per line). The CI
key's **private** file contents — `BEGIN`/`END` lines included — are only needed if
you later enable GitHub Actions deployment; never commit them.

### Firewall

Port 3000 is now bound to loopback, so it isn't publicly reachable regardless. Lock
443 to Cloudflare so nobody can reach the origin directly:

```bash
apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
for ip in $(curl -fsS https://www.cloudflare.com/ips-v4); do ufw allow from $ip to any port 443 proto tcp; done
for ip in $(curl -fsS https://www.cloudflare.com/ips-v6); do ufw allow from $ip to any port 443 proto tcp; done
ufw --force enable
```

Also check Hostinger's hPanel firewall — it sits in front of `ufw` and can silently
drop 443.

> Cloudflare's ranges change. `infra/scripts/update-cloudflare-cidrs.sh` refreshes
> the nginx real-IP list; schedule it and redo the `ufw` rules when it changes.

---

## Phase 2 — Domain and Cloudflare

1. **Point the domain at Cloudflare.** Add the site in Cloudflare (Free plan is
   fine), then in Hostinger → Domains → DNS/Nameservers, replace the nameservers
   with the two Cloudflare gives you. Propagation is usually minutes, up to 24h.
   Wait until Cloudflare shows the zone **Active**.

2. **DNS records** — both proxied (orange cloud):

   | Type | Name | Content | Proxy |
   |------|------|---------|-------|
   | A | `@` | `<VPS_IP>` | Proxied |
   | A | `www` | `<VPS_IP>` | Proxied |

   Grey-clouded (DNS-only) records bypass Cloudflare, and AOP will then reject the
   connection because no client cert is presented.

3. **SSL/TLS → Overview → Full (strict).** Not Flexible: Flexible sends plain HTTP
   to origin port 80, which nginx doesn't listen on — you'd get error 521.

4. **SSL/TLS → Edge Certificates → Always Use HTTPS: On.**

5. **Critical for webhooks — exempt them from bot protection.** Razorpay's POST is
   a non-browser request and Bot Fight Mode or a managed WAF rule will challenge
   it; a challenge is not a 2xx, so Razorpay records a failure. On a single domain
   you can't exempt a whole subdomain, so add a path rule.

   Security → WAF → Custom rules → *Create rule*:
   - Field `URI Path`, operator `starts with`, value `/api/webhooks/`
   - Action: **Skip** → check *All remaining custom rules*, *Bot Fight Mode*,
     *Managed rules*, and *Rate limiting rules*

   Also confirm Security → Bots → Bot Fight Mode isn't blanket-on without this skip.

---

## Phase 3 — Origin TLS certificates

Two certificates go on the box: the origin cert nginx serves, and the CA cert it
verifies Cloudflare against.

```bash
sudo mkdir -p /etc/nginx/tls && sudo chmod 700 /etc/nginx/tls
```

**Origin certificate.** Cloudflare → SSL/TLS → Origin Server → *Create
Certificate*. Accept the defaults (RSA, hostnames `pulseasa.org` and
`*.pulseasa.org`, 15 years). Copy each block to the box:

```bash
sudo nano /etc/nginx/tls/origin.pem   # paste the Origin Certificate
sudo nano /etc/nginx/tls/origin.key   # paste the Private Key (shown once)
sudo chmod 600 /etc/nginx/tls/origin.key
```

**AOP CA certificate** — the fixed Cloudflare CA whose client certs nginx trusts:

```bash
sudo curl -fsS -o /etc/nginx/tls/cloudflare-aop-ca.pem \
  https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem
```

**Enable AOP** in Cloudflare: SSL/TLS → Origin Server → *Authenticated Origin
Pulls* → On (zone-level).

> Order matters: enable AOP only **after** the CA cert is on the box and nginx has
> reloaded. Enabling it while nginx isn't verifying is harmless, but reloading an
> `ssl_verify_client on` config before the CA file exists makes `nginx -t` fail.

---

## Phase 4 — Install the nginx config

You picked a single root domain, so install
[`infra/nginx/conf.d/pulse-single-domain.conf`](../infra/nginx/conf.d/pulse-single-domain.conf)
— **not** `pulse.conf`. Both declare `upstream next_app`, the
`$connection_upgrade` map, and a `default_server`; installing both makes
`nginx -t` fail on duplicates.

```bash
cd /opt/pulse   # created in Phase 5 — do this after cloning, or adjust the path

sudo cp infra/nginx/nginx.conf /etc/nginx/nginx.conf
sudo cp infra/nginx/cloudflare-real-ip.conf /etc/nginx/conf.d/

export PULSE_DOMAIN=pulseasa.org
envsubst '${PULSE_DOMAIN}' \
  < infra/nginx/conf.d/pulse-single-domain.conf \
  | sudo tee /etc/nginx/conf.d/pulse.conf > /dev/null

# nginx.org's package ships a sample server block that collides with ours
sudo rm -f /etc/nginx/conf.d/default.conf

sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` will fail until the TLS files from Phase 3 are in place — that's
expected ordering, not a mistake.

The webhook path gets its own `location` block ahead of `location /`, with a 1MB
body cap mirroring the handler's own limit and 15s timeouts to match the
insert-then-`after()` design.

---

## Phase 5 — Application directory and `.env`

```bash
sudo mkdir -p /opt/pulse /var/lib/pulse
sudo chown -R deploy:deploy /opt/pulse /var/lib/pulse
sudo -u deploy git clone https://github.com/anurag3407/fest.git /opt/pulse
cd /opt/pulse
```

`/var/lib/pulse` is where `deploy.sh` records `current-image`, `previous-image`,
and `active-slot` for rollback — without it, `rollback.sh` has nothing to fall
back to and no idea which slot is live.

Create `/opt/pulse/.env`. Start from your working local `.env`, then change these:

```ini
NODE_ENV=production
APP_ENV=production

# CSRF allowlist (src/lib/csrf.ts) — must be the exact https origin, no
# trailing slash. Wrong values here make /api/checkout/razorpay/verify
# return ORIGIN_NOT_ALLOWED and payments never confirm in the browser.
APP_BASE_URL=https://pulseasa.org
PUBLIC_SITE_URL=https://pulseasa.org
REGISTRATION_SITE_URL=https://pulseasa.org
ADMIN_SITE_URL=https://pulseasa.org
SCANNER_SITE_URL=https://pulseasa.org
HOOKS_BASE_URL=https://pulseasa.org

# Must be identical across instances or server actions break on rolling deploys.
# Generate once: openssl rand -base64 32
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=<paste>

# The secret you generated at the top — same string as the dashboard.
RAZORPAY_WEBHOOK_SECRET_CURRENT=<your generated secret>
RAZORPAY_WEBHOOK_SECRET_PREVIOUS=
```

```bash
chmod 600 /opt/pulse/.env
```

Notes:

- Leave `DEPLOYMENT_ID` commented out — it's baked into the image at build time,
  and an empty value in `.env` would override the baked one.
- `APP_ENV=production` namespaces Redis keys as `pulse:production:*`. If this box
  shares an Upstash database with your local dev, this is what keeps the caches
  apart.
- `.env` is read by both `web` and `worker` via `env_file`. If you edit it, restart
  **both** or they'll disagree.

### Supabase auth redirect allowlist

Login uses OAuth and email OTP, both redirecting to `${window.location.origin}/auth/callback`
([`login/page.tsx:24`](../src/app/login/page.tsx#L24)). Supabase rejects redirects
it doesn't know, so in the Supabase dashboard → Authentication → URL Configuration:

- **Site URL:** `https://pulseasa.org`
- **Redirect URLs:** add `https://pulseasa.org/**` (the wildcard covers the
  `?next=` query the app appends)

Skipping this is the usual cause of "login redirects back to the login page" on a
fresh domain.

---

## Phase 6 — Build and run directly on the Hostinger VPS

This phase intentionally does **not** use GitHub Actions, GHCR, a PAT, or a remote
image registry. The VPS clones the source, builds the production image locally, and
runs the `web` and `worker` containers with Docker Compose. Build time and RAM use
are higher on the VPS, but this path needs only SSH access and `/opt/pulse/.env`.

### 6a. Prepare the source checkout

The commands below are shown for the recommended `deploy` account. If you are
deliberately operating the VPS from a root shell/Hostinger console, use the root
variant immediately below instead.

**Root-operated variant:** from your current `root@...:/opt/pulse#` prompt, make the
checkout consistently root-owned. This resolves Git's `detected dubious ownership`
error without weakening Git's safety check:

```bash
cd /opt/pulse
chown -R root:root /opt/pulse
chmod 600 /opt/pulse/.env
git status --short
git pull --ff-only origin main
./infra/scripts/deploy-local.sh
```

The root variant requires `/opt/pulse/.env` to exist. Root does not need `sudo` for
the build, Docker, or nginx commands. Root SSH login may still be disabled by Phase 1
hardening; use the Hostinger console or log in as `deploy` and run `sudo -i` to obtain
a root shell.

Before pulling, verify that `origin` points at the repository that contains the
production fixes. The deployment repository used by this guide is
`anurag3407/fest`; an older personal fork can report "Already up to date" while
still missing dependencies such as `@next/env`:

```bash
cd /opt/pulse
git remote -v
git remote set-url origin https://github.com/anurag3407/fest.git
git fetch origin
git log -1 --oneline origin/main
git pull --ff-only origin main
grep '"@next/env"' package.json
```

For an HTTPS remote, GitHub requires a **personal access token (PAT)** as the
password; your normal GitHub password will fail. A safer alternative is to add the
VPS public SSH key to the GitHub account/repository and use
`git@github.com:anurag3407/fest.git` as the remote. If the intended source really is
your own fork, push the `@next/env` dependency fix to that fork first, then keep its
remote URL and pull again.

**Deploy-account variant:**

```bash
ssh -i ~/.ssh/id_ed25519 deploy@<VPS_IP>
cd /opt/pulse
git status --short
git pull --ff-only origin main
test -s /opt/pulse/.env
chmod 600 /opt/pulse/.env
```

If `git pull` reports local changes, stop and inspect them. Do not overwrite the
production `.env`; it is ignored by git and must remain on the host.

Verify the build-time values exist:

```bash
grep -E '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|NEXT_PUBLIC_RAZORPAY_KEY_ID)=' /opt/pulse/.env
```

These public values are inlined during `next build`, so changing them requires a
new image build. Private server secrets remain runtime-only in `.env`.

### 6b. Add swap before the first local build

Next 16 plus TypeScript can exceed available RAM during `docker build`. Create swap
once on a small VPS (skip this block if `/swapfile` already exists):

```bash
if ! swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi
free -h
```

### 6c. Recommended one-command local build and deploy

The repository script reads the three build-time values from `.env`, refuses to
build when any is missing, tags the image with the commit SHA, and then invokes the
normal readiness/nginx/rollback orchestration:

```bash
cd /opt/pulse
sudo ./infra/scripts/deploy-local.sh
```

It builds `pulse:local-<commit>`, runs migrations, starts the new image on the
**idle** blue/green slot (web-blue @ 3001 / web-green @ 3002), waits for
`/api/health/ready` on that slot's port, repoints and validates nginx
(`pulse-upstream.conf` → `nginx -t` → reload), updates the worker, drains and stops
the old slot, and records current/previous image + active slot under `/var/lib/pulse`
for rollback. A failed candidate never takes traffic.

### 6d. Fully explicit manual equivalent

Use this instead of `deploy-local.sh` when you want to see each operation. Set the
three public build values to the same values in `/opt/pulse/.env`; never put private
server secrets in Docker build arguments:

```bash
cd /opt/pulse
export RELEASE_ID="$(git rev-parse --short=12 HEAD)"
export NEXT_PUBLIC_SUPABASE_URL='<your Supabase project URL>'
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='<your Supabase publishable/anon key>'
export NEXT_PUBLIC_RAZORPAY_KEY_ID='rzp_test_...'
export IMAGE="pulse:local-${RELEASE_ID}"

sudo docker build --pull \
  --build-arg "DEPLOYMENT_ID=${RELEASE_ID}" \
  --build-arg "NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}" \
  --build-arg "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}" \
  --build-arg "NEXT_PUBLIC_RAZORPAY_KEY_ID=${NEXT_PUBLIC_RAZORPAY_KEY_ID}" \
  -t "${IMAGE}" .

# Hand off to the same blue/green orchestration deploy-local.sh uses:
# migrations → candidate slot on the idle port → readiness → nginx cutover
# → worker update → drain old slot → state recording.
sudo env PULSE_IMAGE="${IMAGE}" PULSE_SKIP_PULL=1 ./infra/scripts/deploy.sh
```

`PULSE_SKIP_PULL=1` tells `deploy.sh` the image was built locally instead of pulled;
everything after that step is identical to a registry deploy. If the build or
readiness check fails, inspect the service logs:

```bash
sudo docker compose logs --tail=200 web-blue
sudo docker compose logs --tail=200 web-green
sudo docker compose logs --tail=200 worker
```

When inspecting a locally built stack, Compose still needs the image variable for
interpolation. Set it from the deployment state first:

```bash
export PULSE_IMAGE="$(cat /var/lib/pulse/current-image)"
docker compose ps
```

**Troubleshooting `Cannot find module "@next/env"`:** this means the checkout or
Docker dependency layer is stale. From the root shell, run:

```bash
cd /opt/pulse
chown -R root:root /opt/pulse
git pull --ff-only origin main
git log -1 --oneline
grep '"@next/env"' package.json
```

The `grep` command must show `"@next/env": "^16.3.2"`. If it does not, the VPS is
on an old commit or the wrong branch; inspect `git branch --show-current` and pull
the branch containing the dependency fix. Once the dependency is present, rebuild
without the old Docker cache:

```bash
docker builder prune -af
./infra/scripts/deploy-local.sh
```

The prune removes unused build cache only; it does not remove running containers,
images tagged `pulse:local-*`, volumes, or `/opt/pulse/.env`.

### 6e. Verify the running application

Run local checks on the VPS first, then the public HTTPS check through Cloudflare.
Web slots live on loopback ports 3001 (blue) and 3002 (green); query whichever
`/var/lib/pulse/active-slot` names:

```bash
ACTIVE_SLOT="$(cat /var/lib/pulse/active-slot 2>/dev/null || echo blue)"
ACTIVE_PORT=$([ "$ACTIVE_SLOT" = green ] && echo 3002 || echo 3001)
curl -fsS "http://127.0.0.1:${ACTIVE_PORT}/api/health/live"
curl -fsS "http://127.0.0.1:${ACTIVE_PORT}/api/health/ready"
curl -fsS "http://127.0.0.1:${ACTIVE_PORT}/api/health/dependencies" | head -40
curl -fsS https://pulseasa.org/api/health/live
```

The local checks must return HTTP 200. A readiness timeout normally means a missing
production variable or an unreachable Supabase/Redis dependency.

If OAuth or another dynamic route returns **502** and the web logs contain
`ENOENT: mkdir '/app/.next/cache'`, the running image predates the writable Next
runtime-cache volume. Pull the version of this repository that defines
`next-cache:/app/.next/cache` in `docker-compose.yml`, then rebuild and deploy:
```bash
cd /opt/pulse
git pull --ff-only origin main
./infra/scripts/deploy-local.sh
export PULSE_IMAGE="$(cat /var/lib/pulse/current-image)"
docker compose ps
docker compose logs --tail=100 web
```

Do not make the entire container filesystem writable. The dedicated `next-cache`
volume is sufficient for ISR/prerender/image cache writes and retains the existing
`read_only: true` hardening.

If nginx logs **`upstream sent too big header while reading response header from
upstream`** on `/auth/callback`, increase the proxy response buffers. Supabase OAuth
can return several large `Set-Cookie` headers containing the session tokens:

```bash
cd /opt/pulse
export PULSE_DOMAIN=pulseasa.org
envsubst '${PULSE_DOMAIN}' < infra/nginx/conf.d/pulse-single-domain.conf \
  > /etc/nginx/conf.d/pulse.conf
nginx -t
systemctl reload nginx
```

The repository config sets `proxy_buffer_size 16k`, `proxy_buffers 8 16k`, and
`proxy_busy_buffers_size 32k` for both proxy locations. Start a new Google login
after reloading; an old OAuth callback URL contains a one-time code and should not be
replayed.

If the local checks return 200 but the public URL returns **Cloudflare 522**, the
application is healthy and Cloudflare cannot establish a TCP connection to nginx.
Check the origin in this order:

```bash
ss -lntp | grep -E ':(443|3001|3002)\b'
systemctl is-active nginx
systemctl status nginx --no-pager
ufw status numbered
curl -fsS https://www.cloudflare.com/ips-v4 | head
```

Port 443 must be listening, nginx must be active, at least one web slot must be up on
3001/3002 (loopback), and UFW/Hostinger hPanel must allow TCP 443 from all current Cloudflare IPv4/IPv6 ranges. Confirm Cloudflare DNS
has proxied (`orange cloud`) A records for `@` and `www` pointing to this exact VPS
IPv4 address. A wrong IP, blocked hPanel rule, or missing UFW Cloudflare rules causes
522; an origin certificate/AOP problem normally produces 526 instead.

After correcting the cause:

```bash
nginx -t && systemctl restart nginx
curl -I https://pulseasa.org/api/health/live
```

### 6f. Rollback and reboot persistence

If a new local build is unhealthy, restore the previous local image:

```bash
cd /opt/pulse
sudo ./infra/scripts/rollback.sh
sudo docker compose ps
```

Install the boot supervisor after the first successful deploy:

```bash
sudo cp infra/systemd/pulse-compose.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pulse-compose
sudo systemctl enable nginx
```

The systemd unit reads `/var/lib/pulse/current-image`, so a locally built image is
also restored after reboot. If that file is missing, run `deploy-local.sh` once before
enabling the unit.

The image remains only on this VPS. If the VPS is rebuilt, clone the repository,
restore `.env`, and repeat Phase 6; no GHCR login is required.

---

## Phase 7 — Register the Razorpay webhook

Stay in **Test Mode** for now (top-right toggle). Test and Live mode keep
completely separate keys *and* separate webhooks — configuring one does nothing for
the other.

Dashboard → Settings → Webhooks → **Add New Webhook**:

| Field | Value |
|-------|-------|
| Webhook URL | `https://pulseasa.org/api/webhooks/razorpay` |
| Secret | the `openssl rand -hex 32` value, matching `RAZORPAY_WEBHOOK_SECRET_CURRENT` |
| Alert Email | your address |

Subscribe to the events the handler acts on:

- `payment.captured` — the one that triggers fulfillment
- `payment.failed`
- `order.paid`
- `refund.created`, `refund.processed`, `refund.failed`

Confirm the env var and the dashboard secret match, then restart so the new value
is read (the env module caches after first parse). Restart the **active** web slot
plus the worker — never both slots at once:

```bash
cd /opt/pulse
ACTIVE_SLOT="$(cat /var/lib/pulse/active-slot 2>/dev/null || echo blue)"
docker compose restart "web-${ACTIVE_SLOT}" worker
```

---

## Phase 8 — Test the webhook

### 8a. Signature rejection (proves the endpoint is reachable and verifying)

```bash
curl -i -X POST https://pulseasa.org/api/webhooks/razorpay \
  -H 'Content-Type: application/json' \
  -H 'X-Razorpay-Signature: deadbeef' \
  -d '{"event":"payment.captured"}'
```

Expect **401**. That single response confirms a lot: DNS resolves, Cloudflare
proxies, AOP handshake succeeded, nginx routed to Node, the WAF skip works, and a
secret is configured.

Read the other outcomes precisely — they're distinct failures:

| Response | Meaning |
|----------|---------|
| **401** | Reachable, secret configured, signature rejected — correct |
| **503** | No secret in env ([`route.ts:42-45`](../src/app/api/webhooks/razorpay/route.ts#L42-L45)) — restart didn't pick up `.env`, or the var is blank |
| **403** / HTML challenge | Cloudflare WAF or Bot Fight Mode — the Phase 2 skip rule is missing or too narrow |
| **521** / **526** | Origin TLS: SSL mode isn't Full (strict), or the origin cert/AOP CA is wrong |
| **502** | Active web slot container down or its loopback port (3001/3002) isn't published — check `/etc/nginx/conf.d/pulse-upstream.conf` vs `docker compose ps` |
| Timeout | `ufw` blocking Cloudflare, or the Hostinger hPanel firewall |

### 8b. Valid signature (proves HMAC + durable insert)

Sign a body with the real secret and confirm a 2xx:

```bash
SECRET='<your webhook secret>'
BODY='{"event":"payment.captured","payload":{}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.*= //')

curl -i -X POST https://pulseasa.org/api/webhooks/razorpay \
  -H 'Content-Type: application/json' \
  -H "X-Razorpay-Signature: $SIG" \
  -H 'X-Razorpay-Event-Id: manual-test-001' \
  -d "$BODY"
```

Expect `{"ok":true}`. Re-run it unchanged: the same `X-Razorpay-Event-Id` dedupes,
so you get `{"ok":true,"duplicate":true}` — that's the idempotency guard working.
Confirm the row landed:

```sql
select provider, event_type, processing_state, signature_valid, created_at
from webhook_events
where provider = 'RAZORPAY'
order by created_at desc
limit 5;
```

The empty `payload` means async processing will log an error while advancing no
money — expected for a synthetic body. Use a real payment for the full path.

### 8c. Dashboard test delivery

In the webhook's row, use Razorpay's **Test/Send test webhook**. It posts a
realistically-shaped payload signed with the real secret. Check delivery history
for a 2xx, and the box for the matching request:

```bash
docker compose logs -f web-blue web-green | grep -i webhook
# nginx side, filtered by path:
sudo grep '/api/webhooks/razorpay' /var/log/nginx/access.log | tail -5
```

The access log is JSON with `request_id`, `cf_ray`, `status`, and
`upstream_response_time` — `cf_ray` is what you quote to Cloudflare support, and
`request_id` correlates to the app logs.

### 8d. Real end-to-end payment

The webhook is one of two paths that confirm a payment; the browser callback is the
other, and both converge on the same idempotent SQL function. Test the whole flow:

1. Open `https://pulseasa.org`, log in, start a base-pass checkout.
2. Pay with a Razorpay **test** card: `4111 1111 1111 1111`, any future expiry, any
   CVV, and choose *Success* on the simulated bank page. (Current test
   instruments: [razorpay.com/docs/payments/payments/test-card-details](https://razorpay.com/docs/payments/payments/test-card-details/))
3. Confirm in the DB:

```sql
select o.id, o.checkout_state, p.provider_status, p.amount_paise
from orders o left join payments p on p.order_id = o.id
order by o.created_at desc limit 5;
```

Expect `checkout_state = FULFILLED` and `provider_status = captured`.

4. Confirm fulfillment side effects: a `delegate_passes` (or `registrations`) row,
   outbox jobs enqueued, and the confirmation email sent. `docker compose logs -f worker`
   shows the worker draining them.

**To prove the webhook specifically** — rather than the browser callback — close the
tab immediately after paying, before the redirect completes. Fulfillment should
still happen, driven only by the webhook. That's the case that matters on event
day, when users close laptops mid-redirect.

### 8e. Reconciliation drills — still on test keys

Do these **before** switching to live keys. Test mode drives the same API, the
same webhook URL and the same reconciler, so it proves all of the *logic* for
free and repeatably. Only a short list genuinely needs real money (Phase 9).

The trick that makes this deterministic: you do not have to wait for a real
late-UPI payment to test late-capture recovery. Capture in test mode, then force
the order into the swept state with SQL.

First, make the webhook stop delivering, so the reconciler is the only thing
left that can save the order. Either deactivate the test webhook in the
dashboard, or point its URL at a wrong path (`/api/webhooks/razorpay-off`).
Remember to restore it afterwards.

**Drill 1 — reconciler recovers a live order (proves the worker is running).**

1. Webhook disabled. Pay for a pass in test mode.
2. Kill the tab the moment the payment succeeds, so `/verify` never fires.
3. The order sits `AWAITING_PAYMENT`. Watch the worker:
   ```bash
   docker compose logs -f worker | grep -i reconcil
   ```
4. Within **2–3 minutes**: `reconciliation cycle complete` with
   `"resolvedOrders":1`, and the pass appears. If nothing happens, the `worker`
   service is not running — nothing else recovers this case.

   Not 60 s. The reconciler deliberately ignores orders younger than
   `minAgeMs` (2 min, [`src/workers/payment-reconciler.ts`](../src/workers/payment-reconciler.ts))
   so the browser callback and the webhook get first refusal instead of racing
   it. Add the 60 s scan cadence on top. A pass appearing at 2:30 is this drill
   **passing** — do not declare it failed at the 1-minute mark.

Losing the network mid-payment has the same server-side effect as killing the
tab, so this drill covers it. Repeat with a real phone in airplane mode at each
of these three moments — the order must end `FULFILLED` (money moved) or unpaid
(it did not), never in between:

| Cut the network… | Expected |
| --- | --- |
| Before submitting the payment | No payment. Order expires; retry works. |
| Immediately after submitting, before the success screen | Money captured → reconciler fulfils within 2–3 min (`minAgeMs` + scan cadence). |
| On the success screen, before the redirect | Money captured → webhook fulfils near-instantly (re-enable it for this one). |

The middle row is the one users complain about. Verify the pass appears
**without** the user reopening the tab.

**Drill 2 — reconciler recovers a *swept* order (the silent-loss case).**

The reconciler skips orders newer than 2 minutes, so backdate `created_at` as
well as forcing the state:

```sql
-- Find the order you just paid for.
select o.id, o.checkout_state, o.created_at, o.reconcile_attempts,
       ro.razorpay_order_id
from orders o
join razorpay_orders ro on ro.local_order_id = o.id
order by o.created_at desc
limit 5;

-- Force it into the state a sweeper would have left it in, old enough to scan.
update orders
set checkout_state    = 'EXPIRED',   -- or 'CANCELLED' for a base-pass order
    created_at        = now() - interval '5 minutes',
    reconcile_attempts = 0,
    last_reconciled_at = null
where id = '<order-uuid>';
```

Expect, within ~60 s (this order was backdated past `minAgeMs`, so only the scan
cadence is left to wait for), either a recovery logged as
`late capture recovered on a swept order` (`lateDiscoveries: 1`), or — if the
seat was resold — `PAYMENT_REVIEW` + `REFUND_REQUIRED`. Both are correct; a
*silent nothing* is the bug this drill exists to catch.

To re-run any of these on the same order, reset the cursor:

```sql
update orders set reconcile_attempts = 0, last_reconciled_at = null
where id = '<order-uuid>';
```

Note the cold scan gives up after 8 attempts and ignores orders older than
30 days, so a stale order will legitimately stop being re-checked.

**Drill 3 — duplicate purchase of the same pass.** Buy the same pass product
twice in test mode (second browser, or a stale checkout tab). The second payment
must land `REFUND_REQUIRED` with reason `duplicate_pass_purchase`, and the user
must still hold exactly **one** active pass. Then confirm a genuine Basic → VIP
upgrade still works: Basic goes `EXPIRED`, VIP goes `ACTIVE`, no refund
obligation.

**Drill 4 — out-of-order and replayed webhooks.** Replay payloads by hand
against the deployed domain, signed with your **test** webhook secret:

```bash
SECRET='<test webhook secret>'
BODY='{"event":"payment.failed","payload":{"payment":{"entity":{"id":"pay_XXX","order_id":"order_XXX","amount":20000,"currency":"INR","status":"failed"}}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.*= //')

curl -s -X POST https://pulseasa.org/api/webhooks/razorpay \
  -H 'content-type: application/json' \
  -H "x-razorpay-signature: $SIG" \
  -H "x-razorpay-event-id: evt_manual_$(date +%s)" \
  --data "$BODY"
```

Use the real `pay_`/`order_` ids from a payment you already captured. Send the
`failed` event *after* the capture: the order must stay `FULFILLED` and the
payment must stay `captured`. Re-send with the **same** `x-razorpay-event-id` to
confirm `duplicate: true`. Sign with `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` to
confirm rotation still verifies, and with a wrong secret to confirm `401`.

**Drill 5 — provider unreachable during verify.** Block outbound traffic to
Razorpay on the VPS, then pay:

```bash
sudo iptables -A OUTPUT -d api.razorpay.com -j DROP   # undo: -D instead of -A
```

`/verify` should return `PROCESSING` rather than failing the user, and the
reconciler should finish the job once you remove the rule.

**Drill 6 — worker down.** Stop the worker, complete a payment with the webhook
disabled, confirm the order stays `AWAITING_PAYMENT` (not lost, not fulfilled),
then start the worker and confirm it reconciles on the next cycle.

**Drill 7 — the review queue.** After drills 2 and 3, confirm the obligations
are visible rather than buried:

```sql
select * from payment_review_queue;
```

Restore the webhook when you're done.

### 8f. Go live

When the test flow passes: switch the dashboard to Live Mode, create a **new**
webhook there with the same URL (generate a fresh secret), swap `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, and `NEXT_PUBLIC_RAZORPAY_KEY_ID` to live values, and
`RAZORPAY_WEBHOOK_SECRET_CURRENT` to the live secret.

`NEXT_PUBLIC_RAZORPAY_KEY_ID` is baked at build time, so this needs a **rebuild**,
not just a restart: update the repo variable, push, and deploy the new digest.

To rotate a webhook secret with zero missed deliveries, use both slots: move the
old value to `RAZORPAY_WEBHOOK_SECRET_PREVIOUS`, put the new one in `_CURRENT`,
restart, then update the dashboard. The handler tries both
([`route.ts:38-48`](../src/app/api/webhooks/razorpay/route.ts#L38-L48)), so
in-flight retries signed with the old secret still verify.

---

## Phase 9 — Reconciliation drills with live keys

Phase 8e already proved the *logic* on test keys. This phase covers only what
test mode genuinely cannot reproduce: live credential/webhook configuration, real
payment-method behaviour, and real bank timing. Do not repeat the 8e drills here
with real money — they will not tell you anything new.

Apply `supabase/migrations/0018_payment_reconciliation_hardening.sql` first. It
carries everything Phase 9 exercises, and each piece fails differently if it is
missing:

| Missing | Symptom |
| --- | --- |
| `orders.reconcile_attempts` / `last_reconciled_at` | the reconciler errors on **every** cycle — no recovery at all |
| `webhook_events.processing_started_at` | 9f cannot reclaim a stranded row |
| `worker_heartbeats` + `record_worker_heartbeat` | 9g is blind; the admin panel 500s |
| `payment_review_queue` | 9c/9d obligations have no work list |

Make a hidden ₹1 pass product for these drills rather than paying ₹2,000 twenty
times. Keep it unpublished so no real user can reach it, and delete it afterwards.
Razorpay's minimum is ₹1 (100 paise) — do not use ₹0, which takes the free-order
path and never touches Razorpay at all.

Also run **one** transaction at the real price (₹200 Basic Card) and refund it.
A ₹1 order exercises the plumbing but not the real amount, and amount-specific
problems — the amount-mismatch guard, currency handling, price display — only
show up at the real value.

### 9a. Live credentials actually work

The most common live-mode failure has nothing to do with payments logic:

- `NEXT_PUBLIC_RAZORPAY_KEY_ID` is **baked at build time**. A stale or wrong
  value means the checkout modal never opens. This needs a full rebuild and
  deploy, not a restart.
- The live webhook is a **separate** webhook with its own secret. If
  `RAZORPAY_WEBHOOK_SECRET_CURRENT` still holds the test secret, every live
  delivery 401s — and you will only find out from the reconciler quietly
  recovering payments (`lateDiscoveries` climbing).

Verify before taking any real payment: open checkout and confirm the modal
appears with live branding, then send one dashboard test delivery against the
live webhook and confirm `{"ok":true}`.

### 9b. Real payment methods

Test mode simulates these; live mode is the first time you see the real thing.
Run one ₹1 payment through each method you have enabled:

- UPI via a real PSP app (GPay/PhonePe/Paytm)
- A real debit/credit card, including the issuer's OTP/3DS step
- Netbanking through a real bank page
- RuPay specifically, if your students will use it

Confirm each reaches `FULFILLED` + `captured`. Also confirm which methods your
**live** account actually has enabled — the live account's method list and
per-transaction limits can differ from test mode, and a method that worked in
test may simply be absent live.

### 9c. Real UPI collect after hold expiry

This is the one scenario test mode cannot fake: test-mode UPI resolves instantly,
while a real collect request can sit unapproved in a PSP app for many minutes.

1. Start an **event** checkout and choose UPI **collect** (request pushed to the app).
2. Do not approve it. Wait out the 10-minute hold; the reaper moves the order to
   `EXPIRED` ([`0005`](../supabase/migrations/0005_checkout_and_inventory.sql#L522-L524)).
3. Now approve it in the PSP app. Money is captured against an expired order.
4. Expect one of two outcomes, both correct and **neither silent**:
   - capacity still available → order fulfils, worker logs
     `late capture recovered on a swept order`;
   - capacity resold → `checkout_state = PAYMENT_REVIEW`, payment
     `disposition = REFUND_REQUIRED`, worker logs
     `captured payment cannot be fulfilled — manual refund obligation`.
5. Confirm it appears in the queue: `select * from payment_review_queue;`

Before 0013 this order was never re-checked after step 2, so a lost webhook here
meant money held with nothing issued and nothing logged.

### 9d. Real refund mechanics

Refund one of your ₹1 payments and the ₹200 one from the Razorpay dashboard.
Confirm the money actually returns, and note the settlement timing (typically
T+2 for the original payment, and refunds take days to reach the customer).
Nothing in the codebase calls Razorpay's refund API — refunds are deliberately
manual, so this drill is about knowing the dashboard flow before you need it
under pressure.

### 9e. Reconciliation observability

The reconciler now reports every outcome class separately, so a refund
obligation can no longer hide inside a success count
([`payment-reconciler.ts`](../src/workers/payment-reconciler.ts)). Alert on these:

| Field | Meaning | Action |
| --- | --- | --- |
| `refundRequired` | Captured money that cannot be fulfilled | Refund manually from the dashboard |
| `amountMismatch` | Provider amount ≠ order amount | Investigate before refunding — possible tampering |
| `lateDiscoveries` | A capture the webhook path missed entirely | Webhook is unhealthy; check secret + delivery logs |
| `orphans` | Captured payment with no local mapping | Usually transient; persistent means provisioning is broken |
| `providerErrors` | Razorpay unreachable | Transient; sustained means an API/network problem |

Any non-zero `refundRequired`, `amountMismatch`, or `lateDiscoveries` is logged
at **error** level with the message
`reconciliation found payments needing manual attention`, so a log-based alert on
that string catches all three. A healthy cycle logs at info and says
`reconciliation cycle complete`.

Refunds stay deliberately manual — nothing in the codebase calls Razorpay's
refund API. `payment_review_queue` is the work list; work it daily during the
festival.

### 9f. Crash during webhook processing

The one failure the inbox pattern does not handle by itself. The handler marks
the row `PROCESSING`, Razorpay gets its 2xx, and *then* the process dies — a
deploy landing mid-flight, an OOM kill, a container restart. Razorpay considers
the event delivered and never redelivers it, so nothing external will ever
re-drive it.

1. Take a ₹1 payment and, the moment the row appears, kill the web container:
   ```bash
   watch -n0.5 "docker compose exec -T db psql -U postgres -c \
     \"select id, processing_state, processing_started_at from webhook_events \
       order by received_at desc limit 3;\""
   # in another shell, the instant it reads PROCESSING:
   docker compose kill web && docker compose up -d web
   ```
   If the race is hard to win, simulate it — the recovery path is identical:
   ```sql
   update webhook_events
   set processing_state    = 'PROCESSING',
       processing_started_at = now() - interval '10 minutes'
   where id = '<webhook-event-uuid>';
   ```
2. Confirm the row is genuinely stranded: `processing_state = 'PROCESSING'` with
   a `processing_started_at` older than 5 minutes and nothing advancing it.
3. Within ~60 s the reconciler reclaims it — `retriedWebhooks` goes non-zero and
   the row reaches `PROCESSED`, with the pass issued.

Staleness is measured from `processing_started_at`, not `received_at`, so a row
a healthy worker is legitimately still working on is never stolen out from under
it. A row that dies on every attempt exhausts `maxAttempts` and lands in `DEAD`
rather than looping forever:

```sql
select id, event_type, attempts, processing_state, last_error
from webhook_events where processing_state = 'DEAD';
```

`DEAD` is not self-healing. Anything in it is a manual investigation — the event
was real and was never applied.

### 9g. Worker liveness and the payment-health panel

The reconciler is the safety net for every drill above. When it stops, nothing
errors and no order is flagged — orders simply stop resolving, which is
indistinguishable from a quiet sales day. The heartbeat is the only signal that
separates the two.

1. `select * from worker_heartbeats order by worker_name;` — all five workers
   (`hold-reaper`, `outbox`, `email`, `reconcile`, `exports`) must be present,
   with `last_success_at` recent and `consecutive_failures = 0`. A worker that
   is **absent** is as bad as a stale one, and easier to miss.
2. Open **Admin → Support**. The payment-health panel at the top of the page
   shows the same table plus the `payment_review_queue` and the total refund
   obligation in rupees. It refreshes every 60 s.
3. Prove the alarm works rather than trusting a green panel:
   ```bash
   docker compose stop worker
   ```
   Within a few minutes `reconcile` must show `⚠ stale` in the panel. Then
   `docker compose start worker` and confirm it clears.

Step 3 is the point of the drill. A health panel nobody has ever seen go red is
not evidence that the workers are running.

---

## Faster iteration while debugging

If you end up cycling on webhook payloads, a tunnel to your laptop gives a much
tighter loop than a VPS rebuild — a second Razorpay test webhook can point at it
while the VPS one stays untouched:

```bash
cloudflared tunnel --url http://localhost:3000
```

Register the printed HTTPS URL as an additional test webhook. Doesn't replace
testing on the real domain, but it's better for iterating on handler code.

---

## Post-deploy checklist

- [ ] `https://pulseasa.org/api/health/live` returns 200 through Cloudflare
- [ ] `curl -k https://<VPS_IP>` is refused/dropped — AOP is actually enforcing
- [ ] Unsigned POST to the webhook → 401 (not 403, 503, or a challenge)
- [ ] Signed POST → `{"ok":true}`; replayed event id → `duplicate: true`
- [ ] Login works (Supabase redirect allowlist includes the domain)
- [ ] Test payment reaches `FULFILLED` + `captured`
- [ ] Fulfillment survives closing the tab mid-redirect
- [ ] `0018_payment_reconciliation_hardening.sql` applied — see the table in
      Phase 9 for what each piece is needed for
- [ ] Phase 8e drill 1 passed (test keys): with the webhook **disabled**, a
      killed-tab payment still fulfils within **2–3 min** via the reconciler
      (`minAgeMs` is 2 min — do not call this failed at 60 s)
- [ ] Phase 8e drill 2 passed (test keys): a capture on a force-`EXPIRED` order
      ends `FULFILLED` or `PAYMENT_REVIEW`, never silently lost
- [ ] Phase 8e drill 3 passed (test keys): a duplicate same-product payment is
      `REFUND_REQUIRED`, user holds exactly one active pass
- [ ] Phase 9a passed (live keys): checkout modal opens with live keys, live
      webhook test delivery returns `{"ok":true}`
- [ ] Phase 9c passed (live keys): real UPI collect approved after hold expiry is
      recovered or flagged, never silent
- [ ] Phase 9f passed: a webhook row stranded in `PROCESSING` is reclaimed and
      reaches `PROCESSED`; nothing is sitting in `DEAD`
- [ ] Phase 9g passed: all five workers present in `worker_heartbeats` with
      recent `last_success_at`, and stopping the worker turns the admin
      payment-health panel red
- [ ] `select * from payment_review_queue;` runs and is empty (or worked)
- [ ] Admin → Support payment-health panel loads and shows zero refund obligation
- [ ] No checkout screen tells a user money was not taken: `/basic-card`,
      `/delegate-pass` and the event checkout all show "we could not confirm"
      wording on a cancelled payment, and keep polling
- [ ] Log alert configured on `reconciliation found payments needing manual attention`
- [ ] `systemctl restart pulse-compose` brings the stack back
- [ ] `./infra/scripts/rollback.sh` works (needs one prior deploy recorded)
- [ ] `infra/scripts/backup-db.sh` scheduled — uses the **direct** Postgres URL,
      not the pooler (`pg_dump` fails through poolers)
- [ ] `update-cloudflare-cidrs.sh` scheduled

`docs/10-troubleshooting.md` and the failure table in
`docs/09-deployment-operations.md` cover symptoms beyond the webhook path.
