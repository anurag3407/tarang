# Load & correctness tests (plan §16)

k6 scripts for the PULSE 2026 platform. Run against a staging environment
that mirrors production (same image, Nginx, Cloudflare rules, Supabase
compute, Upstash plan) with production-scale seed data (250 events, 10,000
users) and **seeded auth tokens** — never real OTP/email or real participant
QRs.

## Scripts

| Script | Profile | What it proves |
|---|---|---|
| `public-burst.k6.ts` | §16.2 #1–4 | Public reads stay fast at 3,000 VUs; ramp variant tests 0→3000 in 60s |
| `checkout-burst.k6.ts` | §16.2 #6 | Base-pass order creation under burst; idempotency + holds hold up |
| `hot-event-race.k6.ts` | §16.2 #5 | Thousands race for final capacity — **zero oversell** (verify in SQL) |
| `scanner-burst.k6.ts` | §16.2 #9 | Gate scans at ≥3× expected rate with p95 < 800ms |

## Usage

```bash
# Public reads (warm cache, 30 min)
k6 run -e BASE_URL=https://staging.pulse.example load/public-burst.k6.ts

# Sudden ramp variant
k6 run -e BASE_URL=... -e RAMP=1 load/public-burst.k6.ts

# Checkout burst (needs seeded tokens + pass product id)
k6 run -e BASE_URL=... -e TOKENS_FILE=tokens.json \
  -e PASS_PRODUCT_ID=<uuid> load/checkout-burst.k6.ts

# Hot event race (verify zero oversell in SQL afterwards)
k6 run -e BASE_URL=... -e TOKENS_FILE=tokens.json \
  -e EVENT_ID=<uuid> load/hot-event-race.k6.ts

# Scanner burst
k6 run -e BASE_URL=... -e GATE_ID=<uuid> \
  -e SCANNER_TOKENS=scanner-tokens.json -e QR_TOKENS=qr-tokens.json \
  load/scanner-burst.k6.ts
```

## Token files

- `tokens.json` — array of `{ "accessToken": "<supabase jwt>" }` for seeded users.
- `scanner-tokens.json` — array of `{ "accessToken", "deviceCredential" }`.
- `qr-tokens.json` — array of `{ "token": "<signed P1 QR token>" }`.

Generate these against staging with the service-role key; never commit them.

## Gates (plan §16.3)

Pass the complete profile **three consecutive times**. Key gates:

- Dynamic read p95 ≤ 750ms, p99 ≤ 1.5s
- Critical write p95 ≤ 1s, p99 ≤ 2s
- Origin 5xx ≤ 0.1% (excluding injected failures)
- Inventory: zero oversells / invariant violations
- Financial: zero duplicate applications, no lost captured payments

After `hot-event-race`, assert:

```sql
select capacity_units, held_units, confirmed_units
from event_inventory
where event_id = '<hot-event-id>';
-- must satisfy: held_units + confirmed_units <= capacity_units
```
