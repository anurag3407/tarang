# 06 — QR Passes & Gate Scanning

## The goal

Every delegate with an active pass gets a QR code. At festival gates, staff scan it.
The system decides: admit, deny (duplicate/revoked/wrong gate), or override.

## How a QR pass is created

### Flow

```
Order fulfilled (delegate_passes row created)
        │
        │ same DB transaction enqueues an ISSUE_QR outbox job
        ▼
Worker outbox dispatcher picks it up (every 5s)
        │
        ▼
qr-service.ts:issueQrCredential(passId)
        │
        ├─ Already has ACTIVE credential? → return it (idempotent)
        ├─ Pass not ACTIVE? → throw CONFLICT
        └─ Insert qr_credentials row:
             - jti = random UUID (the credential's identity)
             - key_id = env QR_SIGNING_KEY_ID (default "k1")
             - not_before = now
             - expires_at = pass expiry, or festival end, or +30 days
             - token_digest = "pending" (filled when QR is viewed)
```

### Credential states

```
ACTIVE ──▶ REPLACED (reissue: old one invalidated)
       └──▶ REVOKED (admin revokes pass)
       └──▶ EXPIRED
```

Only `ACTIVE` credentials are scannable. `REPLACED` means the user got a fresh one
(e.g. after reporting the old QR leaked), the old one no longer works.

## The QR token format

Defined in `src/lib/qr/credential.ts`. The QR encodes a signed token string:

```
P1.<kid>.<base64url(payload)>.<base64url(Ed25519 signature)>
```

- `P1` = format version
- `kid` = signing key ID (from `QR_SIGNING_KEY_ID` env)
- payload (canonical JSON, fixed key order):
  - `v`: 1
  - `jti`: credential UUID
  - `fest`: festival slug (e.g. "tarang")
  - `pass`: public pass code (e.g. "PP-XXXX")
  - `entv`: entitlement version (bumped on reissue)
  - `nbf` / `exp`: unix validity window
  - `class`: "BASE"
- signature = Ed25519 over the canonical payload

**No PII in the token.** Just random IDs and validity dates. Names are looked up
server-side only when needed for masked display.

### Raw token is never stored

Only a **digest** (HMAC-SHA256 of the token) is saved in `qr_credentials.token_digest`.
When the user opens their dashboard pass page, the token is generated fresh on demand
via `buildQrToken`, the digest updated, and the QR rendered. If the DB leaks, attackers
get digests only — they can't reconstruct valid QRs.

### Signing keys (env vars)

| Var | Purpose |
|-----|---------|
| `QR_SIGNING_KEY_ID` | Label for the current key (default `k1`) |
| `QR_ED25519_PRIVATE_KEY_BASE64` | Signs tokens. **Never expose.** |
| `QR_ED25519_PUBLIC_KEY_BASE64` | Verifies tokens at scan time |

Rotation plan: code currently verifies only `QR_SIGNING_KEY_ID` — see `credential.ts:81`
for where previous-key support would be added during rotation.

## Reissue (lost/leaked QR)

`qr-service.ts:reissueQrCredential`:
1. Marks old credential `REPLACED` (old QR stops working at next scan).
2. Creates fresh credential with `entitlement_version + 1`.
3. Next `buildQrToken` signs a new token for the new credential.

Requires permission `pass.reissue`.

## The scanner app

Staff go to `/scanner` (protected page). The app (`src/app/scanner/ScannerApp.tsx`)
uses the device camera (`@zxing/browser`) to read QR codes and POSTs to
`/api/scanner/scan`.

### Dual authentication

Every scan request needs BOTH:

1. **Operator auth** — logged-in Supabase user with `scanner.use` permission.
2. **Device credential** — header `x-scanner-device-credential` matching a
   `scanner_devices` row with state `ACTIVE`.

This means a stolen operator login alone isn't enough, and a device can be revoked
independently (`scanner.device.manage` permission).

### Devices and gates

```
scanner_devices      – enrolled scanning phones (credential stored hashed only)
gates                – physical entrances. Each has:
                        gate_type (GENERAL, EVENT, PRO_SHOW)
                        admission_policy (ONE_PER_DAY, ONE_PER_EVENT, REENTRY_ALLOWED)
                        cooldown_seconds
                        offline_policy (FAIL_CLOSED or ...)
gate_assignments     – which device+operator is allowed at which gate, time window
```

### The scan pipeline (server side)

`POST /api/scanner/scan` → `scan-service.ts:performScan` → SQL `record_scan`:

1. **Verify token** — Ed25519 signature + `nbf`/`exp` window (server clock).
   Fail → outcome `invalid_signature` / `expired` / `not_yet_valid` (still recorded for audit).
2. **Lookup credential** by `jti` → get pass owner's display name, masked
   (e.g. "A*****n") for the operator screen.
3. **Validate gate** — gate exists + active; this device+operator has a valid
   `gate_assignments` row for this gate right now. Fail → `wrong_gate`.
4. **Idempotency** — same `scan_id` retried returns the exact prior result (no double-count).
5. **Credential state** — not ACTIVE → `revoked` / `expired`.
6. **Admission policy**:
   - Scope key = date (`ONE_PER_DAY`), event (`ONE_PER_EVENT`), or none (`REENTRY_ALLOWED`).
   - Already admitted in scope → `duplicate` (or `accepted_reentry`).
   - Event/pro-show gate → must have CONFIRMED registration for linked event, else `wrong_event`.
   - Offline-provisional scan + gate FAIL_CLOSED policy → `cooldown` (deny unless override).
   - Otherwise → `accepted`.
7. **Override** — if `override: true` and outcome wasn't accepted, requires
   `scanner.supervise` permission; outcome becomes `manual_override` (audited).
8. **Insert scan_attempts** (append-only audit) and **admissions** row under a
   unique constraint — a race between two gates is caught and downgraded to
   `duplicate` / `race_duplicate`.
9. Return limited display context: masked name, pass class, last few scans.

### Scan results (outcomes)

| Outcome | Meaning |
|---------|---------|
| `accepted` | Entry granted, admission recorded |
| `accepted_reentry` | Already admitted but reentry allowed |
| `manual_override` | Supervisor forced entry (audited) |
| `duplicate` | Already admitted in this scope |
| `revoked` / `expired` / `not_yet_valid` | Credential problem |
| `invalid_signature` | Token won't verify — likely fake or key mismatch |
| `unknown_credential` | Valid signature but jti not in DB |
| `wrong_gate` / `wrong_event` | Right pass, wrong place |
| `cooldown` | Offline scan rejected by fail-closed policy |

## What can go wrong?

| Symptom | Likely cause | Where to check |
|---------|-------------|----------------|
| Every scan says invalid_signature | Signing key env vars differ between web and when QRs were issued | Compare `QR_SIGNING_KEY_ID`, `QR_ED25519_PUBLIC_KEY_BASE64` on server vs issuance history |
| User reports QR "expired" immediately | Clock skew between user device and server, or credential `expires_at` passed | Check `qr_credentials.expires_at`; sessions use server time for scanning, but QR display uses client time |
| Scanner says device not enrolled | Device revoked or credential header missing | `scanner_devices.state`, header `x-scanner-device-credential` |
| Valid pass but wrong_gate | No active gate_assignment, or assignment window passed | `SELECT * FROM gate_assignments WHERE device_id=... AND gate_id=...;` check valid_from/valid_until |
| Person denied as duplicate but swears they weren't in | Admission policy scope mismatch, or someone else scanned with their QR | Query `admissions` + `scan_attempts` by credential_id — history shows gate + time |
| manual_override spam | Staff overusing override | Query `scan_attempts` WHERE outcome='manual_override' grouped by operator — flag training issue |
| No QR on dashboard pass | ISSUE_QR outbox job not processed | Check worker alive; `outbox_jobs` state for that pass; `qr_credentials` row exists? |
| QR works but display name masked weirdly | masking trims short names | `scan-service.ts:maskName` — cosmetic only |

### Useful queries

```sql
-- Recent scans at a gate
SELECT sa.received_at_server, sa.outcome, sa.reason_code, g.name
FROM scan_attempts sa JOIN gates g ON g.id = sa.gate_id
WHERE g.name = 'Main Gate' ORDER BY sa.received_at_server DESC LIMIT 20;

-- Duplicate scan races
SELECT * FROM scan_attempts WHERE outcome = 'duplicate' AND reason_code = 'race_duplicate';

-- Credential for a pass code
SELECT qc.jti, qc.state, qc.expires_at, qc.entitlement_version
FROM qr_credentials qc JOIN delegate_passes dp ON dp.id = qc.delegate_pass_id
WHERE dp.public_pass_code = 'PP-...';
```
