# 12 — Migrating an existing Hostinger VPS to PULSE

Companion to [`11-vps-razorpay-golive.md`](./11-vps-razorpay-golive.md), which assumes a
**fresh** box. This one covers the case where the VPS already runs a different
project, and records the three decisions taken for this deploy:

| Decision | Choice |
|---|---|
| Old project on the box | Nothing to keep — **wipe** |
| Domain DNS | **Already on Cloudflare** (skip the nameserver move) |
| GitHub rights on `anurag3407/fest` | **Collaborator, not admin** — no Actions Variables |

Read this for the ordering and the deltas; follow doc 11 for the phase detail it
points at. Substitute your domain for `pulseasa.org` throughout.

---

## Why "change the GitHub import and redeploy" isn't a path

The old project was almost certainly code-on-the-box behind a process manager
(PM2 or a panel) with distro nginx or Apache and certbot. PULSE is a different
shape end to end:

| | Old shape (typical) | PULSE |
|---|---|---|
| Artifact | source tree on the host | immutable OCI image, digest-addressed |
| Install | `npm install` on the box | never — image is prebuilt |
| Process | PM2 / panel supervisor | `docker compose`, web + worker |
| TLS | certbot / Let's Encrypt | Cloudflare origin cert + Authenticated Origin Pulls |
| nginx | distro package (1.24) | nginx.org mainline (**≥ 1.25.1** required) |

There is no repo to re-point. The overlaps are all conflicts: whatever holds
ports 80/443, a certbot renewal hook that reloads a config we replaced, a panel
that wants to own Docker's lifecycle, and an nginx that rejects `http2 on;` at
[`pulse-single-domain.conf:43`](../infra/nginx/conf.d/pulse-single-domain.conf#L43).

**So: reinstall the OS.** This costs nothing, because the box is deliberately
almost stateless — image in GHCR (or rebuilt by
[`deploy-local.sh`](../infra/scripts/deploy-local.sh)), config in git, database in
Supabase. Local state is `/opt/pulse/.env`, two files in `/etc/nginx/tls/`, the
`exports-data` + `next-cache` volumes, and `/var/lib/pulse` deploy state
(current/previous image, active slot). Nothing on the old box belongs to PULSE.

> If you later need to migrate a VPS that *does* host something you must keep,
> stop and do it in-place instead — see [In-place, if you ever can't wipe](#in-place-if-you-ever-cant-wipe).

---

## Step 0 — Before you touch anything

**Record the IPv4.** Hostinger normally preserves it across a reinstall, but
confirm in hPanel afterwards: if it changes, the Cloudflare A records need
updating and your `ufw` rules stay valid regardless.

**Note what the old project left in DNS.** Since the zone is already on
Cloudflare, it likely holds records for the old deploy — stale `A`, `CNAME`, or
`TXT` for a previous host, and possibly a `_acme-challenge` from certbot. List
them now; you'll prune them in Step 3.

**Commit the repo prerequisites.** The VPS runs what git and CI contain, so
unpushed work simply doesn't exist to the deploy:

- The Phase-0 fixes in `Dockerfile`, `docker-compose.yml`, `ci.yml`, `.env.example`
- [`infra/nginx/conf.d/pulse-single-domain.conf`](../infra/nginx/conf.d/pulse-single-domain.conf)
  — **was untracked.** Step 5 copies it out of the clone; on a fresh box an
  untracked file is simply absent.
- [`.gitattributes`](../.gitattributes) — pins `*.sh` to LF. With
  `core.autocrlf=true` on Windows the stored blobs happen to be LF today, but a
  CRLF shebang fails on Linux as `bad interpreter: /usr/bin/env bash^M`, which is
  opaque enough to cost an afternoon.

---

## Step 1 — Wipe the box

hPanel → VPS → **OS & Panel → Reinstall OS** → plain **Ubuntu 24.04**.

Not a panel template, not the Docker-preinstalled one. Doc 11 Phase 1 installs
Docker and nginx itself, and a panel layer fights `pulse-compose.service` for
Docker's lifecycle.

Decline all three add-ons (malware scanner, auto-backups, Docker manager) —
[doc 11 explains why each one misfits](./11-vps-razorpay-golive.md#hostinger-add-ons-decline-all-three),
including why VPS snapshots are the wrong spend when the irreplaceable data lives
in Supabase.

---

## Step 2 — Base setup

Straight through **[doc 11 Phase 1](./11-vps-razorpay-golive.md#phase-1--vps-base-setup)**
with no changes: `deploy` user, SSH hardening, Docker, nginx from nginx.org
mainline, two SSH keys, `ufw` locked to Cloudflare ranges.

Two things that bite specifically on Hostinger:

- The **hPanel firewall sits in front of `ufw`** and can silently drop 443. Check
  it even after `ufw` looks right.
- Verify `nginx -v` reports **≥ 1.25.1** before going further. If it says 1.24
  you got the distro package and Step 5 will fail `nginx -t`.

> Generate the webhook secret now, so it isn't a blocker in Step 8:
> `openssl rand -hex 32`. **You choose this value** — Razorpay doesn't issue it.

---

## Step 3 — Cloudflare (mostly already done)

The zone is Active, so **skip the nameserver move** (doc 11 Phase 2 step 1). Do
these:

1. **Prune the old project's records.** Delete anything pointing at the previous
   deploy, plus stale `_acme-challenge` TXT records from certbot — the new TLS
   path never uses ACME.

2. **A records → the VPS IP, both Proxied (orange cloud):**

   | Type | Name | Content | Proxy |
   |---|---|---|---|
   | A | `@` | `<VPS_IP>` | Proxied |
   | A | `www` | `<VPS_IP>` | Proxied |

   Grey-cloud (DNS-only) bypasses Cloudflare, and AOP then rejects the connection
   because no client certificate is presented.

3. **SSL/TLS → Full (strict).** If the old project ran Flexible, *this must
   change* — Flexible sends plain HTTP to origin port 80, which nginx never
   listens on. Symptom: error 521.

4. **Always Use HTTPS: On.**

5. **WAF skip for webhooks — do not skip this step.** Razorpay's POST is a
   non-browser request; Bot Fight Mode or a managed rule will challenge it, and a
   challenge is not a 2xx, so Razorpay records a delivery failure.

   Security → WAF → Custom rules → *Create rule*:
   - `URI Path` **starts with** `/api/webhooks/`
   - Action **Skip** → check *All remaining custom rules*, *Bot Fight Mode*,
     *Managed rules*, *Rate limiting rules*

6. **Clear leftovers from the old site:** Page Rules, Redirect Rules, Workers
   routes, and Transform Rules on this zone. A stale redirect rule will happily
   rewrite PULSE's paths.

---

## Step 4 — Origin TLS

**[Doc 11 Phase 3](./11-vps-razorpay-golive.md#phase-3--origin-tls-certificates)**
unchanged: origin cert + key into `/etc/nginx/tls/`, fetch the AOP CA, then enable
Authenticated Origin Pulls at the zone.

Order matters — enable AOP only *after* the CA file is on the box, or `nginx -t`
fails on an `ssl_verify_client on` config with no CA to read.

If the zone already had an origin certificate from the old project you can reuse
it, provided it covers this hostname. Generating a fresh one is cleaner; the
private key is shown only once either way.

---

## Step 5 — nginx config

**[Doc 11 Phase 4](./11-vps-razorpay-golive.md#phase-4--install-the-nginx-config)**.
Install `pulse-single-domain.conf` — **not** `pulse.conf`. Both declare
`upstream next_app`, the `$connection_upgrade` map, and a `default_server`, so
installing both fails `nginx -t` on duplicates.

On a freshly reinstalled box also:

```bash
# nginx.org's package ships a sample server block that collides with ours.
sudo rm -f /etc/nginx/conf.d/default.conf
# Nothing should remain in sites-enabled; distro-style dirs aren't used here.
ls /etc/nginx/sites-enabled/ 2>/dev/null
```

---

## Step 6 — Clone and `.env`

**[Doc 11 Phase 5](./11-vps-razorpay-golive.md#phase-5--application-directory-and-env)**.
The clone URL there is already this repository, so there is no "GitHub import" to
change:

```bash
sudo -u deploy git clone https://github.com/anurag3407/fest.git /opt/pulse
```

Collaborator read access is enough to clone and pull. Set every `*_SITE_URL` and
`APP_BASE_URL` to the exact `https://` origin with no trailing slash — wrong
values make `/api/checkout/razorpay/verify` return `ORIGIN_NOT_ALLOWED` and
payments never confirm in the browser.

Don't forget the **Supabase auth redirect allowlist** (Site URL + `https://your-domain/**`).
Skipping it is the usual cause of "login bounces back to the login page".

---

## Step 7 — Getting an image onto the box

This is the one place your permissions change the plan. Two options; **A is
better if you can get it.**

### Option A — have Anurag set three repo Variables (preferred)

Setting Actions **Variables**, **Secrets**, and **Environments** all require
*admin* on the repo. Write access is not enough. Message to send him verbatim:

> Repo → Settings → Secrets and variables → Actions → **Variables** tab → New
> repository variable, three of them:
>
> - `NEXT_PUBLIC_SUPABASE_URL` = `<the Supabase project URL>`
> - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = `<the publishable/anon key>`
> - `NEXT_PUBLIC_RAZORPAY_KEY_ID` = `<rzp_test_... for now>`
>
> These are **Variables, not Secrets** — all three are public by design (they ship
> in the client bundle). They must be Variables because
> [`ci.yml:106-108`](../.github/workflows/ci.yml#L106-L108) reads `vars.*`.

**Why this matters more than it looks:** an unset `vars.*` expands to an **empty
string, not an error**. CI stays green, Trivy passes, the image pushes — and the
browser gets `undefined` for the Supabase URL and throws at
[`browser.ts:17`](../src/lib/supabase/browser.ts#L17). A green pipeline shipping a
dead login is the failure mode to avoid.

Because `NEXT_PUBLIC_*` is inlined at build time, **the image is
environment-specific**. Changing the Supabase project or Razorpay key id needs a
**rebuild**, not a restart.

Then pull on the box. You do *not* need admin for this — a collaborator's own PAT
with `read:packages` can read the package:

```bash
echo '<your PAT>' | docker login ghcr.io -u <your-github-username> --password-stdin
cd /opt/pulse
export PULSE_IMAGE=ghcr.io/anurag3407/fest@sha256:<digest from the image job>
./infra/scripts/deploy.sh
```

### Option B — build on the VPS (unblocked today)

No dependency on anyone else. [`deploy-local.sh`](../infra/scripts/deploy-local.sh)
reads the three `NEXT_PUBLIC_*` values from `/opt/pulse/.env`, builds, and hands
off to `deploy.sh` for readiness, `nginx -t`, reload, and drain — so both paths
behave identically after the build:

```bash
cd /opt/pulse && git pull && ./infra/scripts/deploy-local.sh
```

It refuses to build if any of the three values is missing, rather than producing
the silently-broken image described above. Images are tagged
`pulse:local-<sha>` — immutable per commit, so `rollback.sh` still has a real
previous image to return to.

**Add swap before the first build.** A Next 16 production build inside Docker
peaks well above what a 4 GB box has spare, and the OOM killer surfaces as a
confusing mid-build failure:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

What you give up: no SBOM and **no Trivy CRITICAL/HIGH gate** — nothing scans
this image. Build load also lands on the production box, and the image exists
only there. Treat Option B as the bridge and move to A before the event.

### Either way

`deploy-staging` runs on every push to `main` and **will fail** without
`STAGING_SSH_*` secrets and a `staging` environment — both admin-only. Expect a
red X on pushes; it does not block the `image` job, which runs first. Ignore it,
or ask Anurag to point the staging secrets at this same box.

---

## Step 8 — Survive reboots, then the webhook

```bash
sudo cp infra/systemd/pulse-compose.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pulse-compose
sudo systemctl enable nginx
```

Then **[doc 11 Phases 7 and 8](./11-vps-razorpay-golive.md#phase-7--register-the-razorpay-webhook)**:
register the webhook with the secret from Step 2, and work the test ladder —
unsigned POST → **401**, signed POST → `{"ok":true}`, replay → `duplicate: true`,
then a real test-card payment.

The 401 is worth more than it looks: it proves DNS, the Cloudflare proxy, the AOP
handshake, nginx routing, the WAF skip, and a configured secret, all at once. Doc
11 §8a has a table decoding 503 / 403 / 521 / 502 / timeout, which are each a
different failure.

> `pulse-compose.service` has `EnvironmentFile=/opt/pulse/.env`, so it must exist
> before `systemctl enable --now` or the unit fails to start.

---

## In-place, if you ever can't wipe

Not this deploy, but recorded for the next one. The blockers, in the order they
bite:

1. **Port 80/443 owner.** `ss -tlnp | grep -E ':(80|443)\b'` — Apache or distro
   nginx must be stopped *and* disabled, or it returns at reboot.
2. **nginx version.** Distro 1.24 rejects `http2 on;`. Replacing it with
   nginx.org mainline while another site depends on its config is the ugly part.
3. **certbot renewal hooks** that reload nginx and can clobber the config.
4. **A panel owning Docker** — it will fight `pulse-compose.service`.
5. **Port 3000** already taken by the old app — harmless: compose binds only
   `127.0.0.1:3001` (web-blue) and `127.0.0.1:3002` (web-green), both loopback-only.

Inventory first:

```bash
docker ps -a; pm2 list 2>/dev/null; crontab -l 2>/dev/null
systemctl list-units --type=service --state=running \
  | grep -viE 'systemd|dbus|cron|ssh|networkd|resolved|journal'
ls /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ /var/www/ 2>/dev/null
```

---

## Migration checklist

- [ ] IPv4 confirmed after reinstall; Cloudflare A records match it, both Proxied
- [ ] Stale DNS records, Page/Redirect/Transform Rules and Worker routes removed
- [ ] SSL/TLS mode is **Full (strict)**, not Flexible
- [ ] WAF skip rule covers `/api/webhooks/`
- [ ] `nginx -v` ≥ 1.25.1
- [ ] Only `pulse-single-domain.conf` installed; `default.conf` removed
- [ ] `.env` has the https origins, no trailing slashes; `chmod 600`
- [ ] Supabase redirect allowlist includes the domain
- [ ] Image path chosen (A: Variables set by owner / B: `deploy-local.sh` + swap)
- [ ] `https://<domain>/api/health/live` returns 200 through Cloudflare
- [ ] `curl -k https://<VPS_IP>` refused — AOP actually enforcing
- [ ] Unsigned webhook POST → 401; signed → `{"ok":true}`; replay → `duplicate`
- [ ] Test payment reaches `FULFILLED` + `captured`, and survives closing the tab
- [ ] `systemctl restart pulse-compose` brings the stack back
- [ ] Backups: `backup-db.sh` scheduled against the **direct** Postgres URL
