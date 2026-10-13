# 13 — Production deployment on AWS Lightsail (tarangfest.in)

This is the **current, canonical** production runbook. Docs 11 and 12 describe the
earlier Hostinger VPS path and are kept for history only.

| | |
|---|---|
| Domain | `tarangfest.in` (+ `www` → 308 to apex), DNS on Cloudflare |
| Instance | Lightsail `Ubuntu-1`, ap-south-1 (Mumbai), 4 GB / 2 vCPU / 80 GB, Ubuntu 24.04 |
| Static IPv4 | `3.6.209.14` (`StaticIp-1`) · private `172.26.5.40` |
| IPv6 | `2406:da1a:2ac:7900:16e0:fa5b:b02:74fd` |
| Admin SSH | `ssh -i LightsailDefaultKey-ap-south-1.pem ubuntu@3.6.209.14` |
| App dir / state | `/opt/tarang` (git checkout + `.env`) · `/var/lib/tarang` |
| Image registry | `ghcr.io/anurag3407/tarang` (built by GitHub Actions) |
| Provisioned | 2026-10-13 with `infra/scripts/bootstrap-lightsail.sh` |

---

## 1. How it fits together

```
 browser ──HTTPS──▶ Cloudflare (WAF, DDoS, TLS, cache)
                        │  Full (strict) TLS + Authenticated Origin Pulls (client cert)
                        ▼
 Lightsail 3.6.209.14 ── UFW: 443 only from Cloudflare ranges, 22 rate-limited
   nginx :443  (rejects unknown SNI, rejects anyone without Cloudflare's client cert)
     │  upstream = active slot (/etc/nginx/conf.d/tarang-upstream.conf)
     ├─▶ web-blue   127.0.0.1:3001  ┐ same image, one is live,
     ├─▶ web-green  127.0.0.1:3002  ┘ the other takes the next release
     └   worker     (outbox, emails, hold reaper, reconciler, exports)
                        │
                        ▼
             Supabase · Upstash Redis · Razorpay · Resend/SES (all external)

 git push main ─▶ GitHub Actions: verify → build image → push GHCR
                                     └─▶ ssh deploy@origin "deploy <sha> <image@digest>"
```

The box holds no database. Everything stateful lives in Supabase/Upstash, so the
server itself is disposable: it can be rebuilt from this repo in ~15 minutes
(§8).

---

## 2. Security model

| Layer | Control |
|---|---|
| Edge | All traffic goes through Cloudflare (proxied DNS). The origin IP serves nothing to anyone else. |
| Firewall | UFW default-deny inbound. **443 allowed only from Cloudflare's published ranges** (refreshed weekly). 22 rate-limited (`ufw limit`). Port 80 closed. |
| TLS at origin | Cloudflare Origin Certificate; `ssl_verify_client on` with Cloudflare's AOP CA, so connections without Cloudflare's client cert get 400. The default server uses `ssl_reject_handshake`, so bare-IP/unknown-SNI scanners can't even complete a handshake. TLS 1.2/1.3 only. |
| SSH | Keys only, no root, no passwords, `MaxAuthTries 3`, `AllowUsers ubuntu deploy`, fail2ban (5 failures → 1 h ban). |
| CI access | The `deploy` user's key is **pinned to one program** (`/usr/local/sbin/tarang-deploy`) via a forced command plus sudoers. It accepts only `deploy <commit already on main> <ghcr.io/anurag3407/tarang@sha256:…>`, `rollback`, `status`. No shell, no TTY, no port forwarding. `authorized_keys` is root-owned. |
| Host key | Pinned in the `LIGHTSAIL_KNOWN_HOSTS` secret. CI never trusts on first use. |
| Registry creds | None stored on the box. Each deploy passes the job's short-lived `GITHUB_TOKEN` over stdin, logs in to a throwaway Docker config, pulls, and deletes it. |
| Containers | Non-root user, read-only root FS, `cap_drop: ALL`, `no-new-privileges`, tini init, pid/memory limits, loopback-only ports. |
| Secrets | `/opt/tarang/.env`, `root:root 0600`, never in git or in the image. Only public `NEXT_PUBLIC_*` values are baked into the image. |
| OS | Unattended security upgrades (no auto-reboot), sysctl network hardening, 4 GB swap, journald capped at 500 MB, Docker log rotation. |
| Headers | HSTS (1 y), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, CSP `frame-ancestors 'none'`. |

---

## 3. Status: what's done and what's left

Already done (2026-10-13):

- [x] Server provisioned and hardened (bootstrap run, then rebooted onto the patched kernel)
- [x] Docker 29, compose v5, nginx mainline 1.31 from nginx.org
- [x] UFW + fail2ban + SSH hardening verified: root login refused, CI key refused for every command outside the grammar
- [x] `deploy` user with the CI public key; private key stored as GitHub secret
- [x] GitHub secrets `LIGHTSAIL_HOST`, `LIGHTSAIL_SSH_KEY`, `LIGHTSAIL_KNOWN_HOSTS`
- [x] Origin TLS: **temporary self-signed placeholder** (replace in step B)

Still to do, in this order:

### A. Lightsail firewall (console)

Lightsail → `Ubuntu-1` → **Networking**. In both the IPv4 and IPv6 firewall:

- Keep **SSH (22)**
- **Add HTTPS (443)**
- **Delete HTTP (80)**

UFW on the box already restricts 443 to Cloudflare. The Lightsail firewall just needs
to let it through.

While you're there: **Snapshots → enable automatic snapshots** (daily). It's cheap
insurance for the box config and `.env`.

### B. Cloudflare (dashboard for `tarangfest.in`)

1. **DNS.** Both records proxied (orange cloud):

   | Type | Name | Content | Proxy |
   |---|---|---|---|
   | A | `@` | `3.6.209.14` | Proxied |
   | A | `www` | `3.6.209.14` | Proxied |

   Cloudflare serves IPv6 to visitors on its own, so no AAAA record is needed.
   **Never grey-cloud these records.** A DNS-only record bypasses Cloudflare and the
   origin will refuse the connection.

2. **SSL/TLS → Overview → Full (strict).**
3. **SSL/TLS → Edge Certificates:** Always Use HTTPS **On**, Minimum TLS **1.2**.
4. **Origin certificate.** SSL/TLS → Origin Server → *Create Certificate* (RSA,
   hosts `tarangfest.in, *.tarangfest.in`, 15 years). Install it on the box:

   ```bash
   ssh -i LightsailDefaultKey-ap-south-1.pem ubuntu@3.6.209.14
   sudo nano /etc/nginx/tls/origin.pem    # paste "Origin Certificate"
   sudo nano /etc/nginx/tls/origin.key    # paste "Private Key" (shown once)
   sudo chmod 600 /etc/nginx/tls/origin.key
   sudo rm -f /etc/nginx/tls/PLACEHOLDER-CERT
   sudo nginx -t && sudo systemctl reload nginx
   ```

5. **Authenticated Origin Pulls.** SSL/TLS → Origin Server → *Authenticated Origin
   Pulls* → **On**. nginx already requires the client cert, so the site returns
   400 through Cloudflare until this is on.
6. **Webhooks must skip bot checks.** Security → WAF → Custom rules → *Create rule*:
   `URI Path` *starts with* `/api/webhooks/` → **Skip** all remaining custom rules,
   rate limiting, managed rules and Bot Fight Mode. Razorpay's POSTs are not
   browsers, and a challenge counts as a failed delivery.

### C. `/opt/tarang/.env` on the server

```bash
sudo install -m 600 -o root -g root /dev/null /opt/tarang/.env   # only if it doesn't exist
sudo nano /opt/tarang/.env
```

Start from `.env.example`. Production-specific values:

```ini
NODE_ENV=production
APP_ENV=production                    # namespaces Redis keys tarang:production:*

# CSRF allowlist — exact origin, no trailing slash. Wrong values make payment
# verification fail with ORIGIN_NOT_ALLOWED.
APP_BASE_URL=https://tarangfest.in
PUBLIC_SITE_URL=https://tarangfest.in
REGISTRATION_SITE_URL=https://tarangfest.in
ADMIN_SITE_URL=https://tarangfest.in
SCANNER_SITE_URL=https://tarangfest.in
HOOKS_BASE_URL=https://tarangfest.in

# Same key on both blue/green slots, or server actions break on every deploy.
# Generate once: openssl rand -base64 32
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=...

# Deploys run migrations with this. Use the SESSION pooler (port 5432), not 6543.
SUPABASE_DB_SESSION_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres

# Shared default scanner credential is a dev convenience; off in production.
SCANNER_ALLOW_DEFAULT_CREDENTIAL=false
```

Rules:

- **Don't** set `DEPLOYMENT_ID` here. Each deploy sets it to the commit SHA.
- Docker Compose expands `$` inside `.env`. Wrap any value that contains `$` in
  **single quotes**: `KEY='pa$$word'`.
- The `NEXT_PUBLIC_*` values also go in `.env`, and they **must** match the GitHub
  Variables in step D. The browser bundle uses the build-time copy.
- After editing `.env` on a running system, redeploy, or restart **all three**
  services (§6). Never restart just one.

### D. GitHub repository settings

Settings → Secrets and variables → Actions:

| Kind | Name | Value |
|---|---|---|
| Variable | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| Variable | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable/anon key |
| Variable | `NEXT_PUBLIC_RAZORPAY_KEY_ID` | `rzp_live_…` |
| Variable | `PRODUCTION_URL` *(optional)* | `https://tarangfest.in` (default) |
| Secret | `SENTRY_AUTH_TOKEN` *(optional)* | enables source-map upload |
| Secret | `LIGHTSAIL_HOST` / `LIGHTSAIL_SSH_KEY` / `LIGHTSAIL_KNOWN_HOSTS` | ✅ already set |

These three variables are public by design, which is why they are Variables rather than
Secrets. They get compiled into the browser bundle. The build fails fast if any is missing.

Recommended: Settings → Environments → `production` → add yourself as a
**required reviewer** if you want a manual approval gate before each deploy, and
Settings → Branches → protect `main` (require the *Verify* check).

### E. Supabase and Razorpay

- Supabase → Authentication → URL Configuration: **Site URL** `https://tarangfest.in`;
  **Redirect URLs** add `https://tarangfest.in/**`.
- Razorpay → Webhooks: URL `https://tarangfest.in/api/webhooks/razorpay`, secret =
  `RAZORPAY_WEBHOOK_SECRET_CURRENT` from `.env`. Test it with docs/11 Phase 8.

### F. First deploy

Push to `main`, or run Actions → **CI/CD** → *Run workflow* → `deploy`. Then:

```bash
curl -s https://tarangfest.in/api/health/ready        # {"status":"ready"}
curl -sk https://3.6.209.14/ ; echo $?                # handshake refused (35) — good
```

---

## 4. What a deploy does

On every push to `main` (`.github/workflows/ci.yml`):

1. **verify:** `pnpm install --frozen-lockfile`, typegen, lint, typecheck, unit tests.
   Pull requests stop here.
2. **build:** Docker image built on GitHub's runners with the three `NEXT_PUBLIC_*`
   Variables and `DEPLOYMENT_ID=<sha>`, pushed as
   `ghcr.io/anurag3407/tarang:<sha>`. The job outputs the immutable `@sha256:` digest.
3. **deploy** (serialised: one at a time, never cancelled midway). It SSHes to
   `deploy@3.6.209.14`, and the forced command runs `/usr/local/sbin/tarang-deploy`:
   1. takes a lock (`/run/lock/tarang-deploy.lock`) so manual and CI deploys never overlap
   2. validates arguments; refuses if `.env` is missing
   3. `git fetch`, then verifies the commit is on `origin/main`, then checks out that exact commit in `/opt/tarang`
   4. logs in to GHCR with the job token (stdin), pulls the digest with 3 retries, then deletes the credentials
   5. hands off to `infra/scripts/deploy.sh` (from that commit):
      - **migrations**: `docker compose run --rm migrate` applies any
        `supabase/migrations/*.sql` not yet recorded, each file in one transaction.
        If one fails, **the deploy aborts and the live slot is untouched**
      - starts the idle slot (blue↔green) with the new image
      - polls `http://127.0.0.1:<port>/api/health/ready` for up to 60 s. On failure the
        candidate is torn down and **traffic never moves**
      - rewrites the upstream file, `nginx -t`, reload (atomic cutover)
      - restarts the worker on the new image
      - drains the old slot for 20 s, then stops it
      - records `current-image` / `previous-image` / `active-slot` / `deploy-history.log`
      - prunes release images older than the last 5 deploys
4. **Public health check** through Cloudflare (warning only), then `status`.

Everything the entrypoint prints is also appended to `/var/log/tarang-deploy.log`.

**Migrations run while the old version is still serving.** Write them expand-then-
contract: add columns and tables first, and drop them in a later release.

---

## 5. Rollback

- **From GitHub:** Actions → CI/CD → *Run workflow* → `rollback`. This redeploys
  `previous-image` through the same blue/green path.
- **On the box:**
  ```bash
  sudo tarang-deploy rollback                                    # previous image
  sudo tarang-deploy rollback ghcr.io/anurag3407/tarang@sha256:… # a specific one
  ```
  The last 5 release images stay on disk, so rollback needs no registry access.
  `grep image= /var/lib/tarang/deploy-history.log` lists them.
- Rollback history is one step deep: a second plain `rollback` refuses to flip-flop.
  Pass an explicit digest instead.
- Rollback does **not** undo database migrations. That's why they must stay backwards-compatible.

---

## 6. Day-to-day operations (as `ubuntu`)

```bash
sudo tarang-deploy status                       # commit, slot, image, containers, history
cd /opt/tarang
export TARANG_IMAGE=$(cat /var/lib/tarang/current-image)   # compose needs it for every command
sudo -E docker compose ps
sudo -E docker compose logs -f --tail=200 worker
sudo -E docker compose logs -f --tail=200 web-$(cat /var/lib/tarang/active-slot)
sudo tail -f /var/log/nginx/access.log          # JSON lines; ip = real client IP
sudo tail -n 100 /var/log/tarang-deploy.log
```

**After editing `.env`**, restart the live slot and the worker together (or just redeploy):

```bash
cd /opt/tarang && export TARANG_IMAGE=$(cat /var/lib/tarang/current-image)
sudo -E docker compose up -d --force-recreate --no-deps web-$(cat /var/lib/tarang/active-slot) worker
```

**Manual deploy of a commit already built by CI** (for example, re-running after fixing `.env`):

```bash
sudo tarang-deploy deploy <full-40-char-sha> ghcr.io/anurag3407/tarang@sha256:<digest>
```

(Without a token on stdin it can only use an image already on the box, or a public package.)

**Infra changes** (anything under `infra/`: nginx, systemd units, `tarang-deploy.sh`,
`update-cloudflare-cidrs.sh`) are **not** applied by deploys. Deploys only move
the app. After the change is deployed to `/opt/tarang`, re-converge the host:

```bash
cd /opt/tarang && sudo ./infra/scripts/bootstrap-lightsail.sh
```

It's idempotent. It keeps the origin cert, `.env`, the active slot and the CI key.
It reloads nginx rather than restarting it, and restarts Docker only if `daemon.json` changed.

**Kernel updates** install automatically but never reboot on their own. When
`/var/run/reboot-required` exists, pick a quiet moment and run `sudo reboot`. On boot,
`tarang-compose.service` brings the live slot and the worker back up.

**Health endpoints:** `/api/health/live` (process up), `/api/health/ready`
(Supabase reachable), `/api/health/dependencies` (detail). Point an external
uptime monitor (UptimeRobot, Better Stack…) at `https://tarangfest.in/api/health/ready`.
In Lightsail → Metrics, add alarms for CPU and burst capacity.

---

## 7. Break-glass recovery

| Situation | Fix |
|---|---|
| **Your SSH is refused / times out** | fail2ban probably banned your IP (5 bad logins), or `ufw limit` kicked in (more than 6 connects in 30 s). Use Lightsail console → *Connect using SSH* (browser; works from AWS's IPs), then `sudo fail2ban-client set sshd unbanip <your-ip>`. Your IPv6 address is a separate identity and also works. |
| CI deploy key leaked | It can only deploy commits already on `main`, using this repo's images. Still, rotate it: `ssh-keygen -t ed25519 -f k -N ""`, then `sudo DEPLOY_PUBKEY="$(cat k.pub)" ./infra/scripts/bootstrap-lightsail.sh` on the box, then put `k` into the `LIGHTSAIL_SSH_KEY` secret. |
| Site down, origin healthy | Check Cloudflare: SSL mode, AOP toggle, proxied DNS, origin cert expiry. `curl -sk --resolve tarangfest.in:443:127.0.0.1 https://tarangfest.in/` on the box returns **400** when nginx is fine (no client cert). |
| 502 from nginx | The upstream port and the running slot disagree. Run `cat /etc/nginx/conf.d/tarang-upstream.conf` and `sudo tarang-deploy status`, then redeploy or roll back. |
| Disk filling | `docker system df`; release images are pruned to 5 automatically. Run `sudo docker builder prune -af` and `sudo journalctl --vacuum-size=200M`. |
| Server lost / rebuild from scratch | New Ubuntu 24.04 instance → attach `StaticIp-1` → copy the repo's `infra/` over → `sudo DEPLOY_PUBKEY="<CI public key>" ./infra/scripts/bootstrap-lightsail.sh` → restore `.env` and the origin cert/key → update `LIGHTSAIL_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 3.6.209.14`) → run the workflow. |

---

## 8. Files

| Path | Role |
|---|---|
| `.github/workflows/ci.yml` | verify → build → deploy / rollback |
| `Dockerfile` | multi-stage image: Next standalone + `dist/worker.cjs` + `dist/migrate.cjs` + migrations |
| `docker-compose.yml` | `web-blue`, `web-green`, `worker`, `migrate` (profile `tools`) |
| `infra/scripts/bootstrap-lightsail.sh` | provisions/re-converges the host |
| `infra/scripts/tarang-deploy.sh` | → `/usr/local/sbin/tarang-deploy`, the CI entrypoint |
| `infra/scripts/deploy.sh` / `rollback.sh` | blue/green orchestration |
| `infra/scripts/update-cloudflare-cidrs.sh` | → `/usr/local/sbin/tarang-update-cloudflare-cidrs` (nginx real-IP + UFW), weekly timer |
| `infra/scripts/deploy-local.sh` | fallback: build the image on the box itself (slow on 4 GB; avoid during traffic) |
| `infra/nginx/nginx.conf`, `snippets/*`, `conf.d/tarang-single-domain.conf` | → `/etc/nginx/…` (`tarang.conf` after envsubst) |
| `infra/systemd/tarang-*.service/.timer` | boot-time compose up; weekly Cloudflare CIDR refresh |

Paths on the box: `/etc/tarang-deploy.conf` (entrypoint config),
`/etc/nginx/tls/` (origin cert/key, AOP CA), `/etc/ssh/sshd_config.d/10-tarang-hardening.conf`,
`/etc/fail2ban/jail.d/tarang.local`, `/etc/sysctl.d/99-tarang-hardening.conf`,
`/etc/docker/daemon.json`.
