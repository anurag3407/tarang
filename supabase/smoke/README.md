# DB smoke suite (real PostgreSQL)

Regression gate for RPC-level bugs that vitest mocks cannot catch (G1/G3/G7/G8,
E1, V-01/V-09, G4). Each file is self-contained and **must run against a fresh
database**: bootstrap → migrations `0001`–`0030` → `seed.sql` first.

## Run locally (mirrors CI)

```sh
# 1. bootstrap the local Supabase stand-ins (auth schema, anon/authenticated/service_role)
psql -v ON_ERROR_STOP=1 -f supabase/smoke/bootstrap.sql

# 2. fresh schema — migrations + seed (non-idempotent suites follow)
#    e.g. `drop schema public cascade; create schema public;` then:
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -f "$f"; done
psql -v ON_ERROR_STOP=1 -q -f supabase/seed.sql

# 3. run the suites in order
for f in supabase/smoke/0[1-5]-*.sql; do
  psql -v ON_ERROR_STOP=1 -f "$f" || exit 1
done
```

Each suite ends with an `ALL … PASS` banner; any `ASSERT FAIL` or SQL error
aborts the run (exit non-zero) via `\set ON_ERROR_STOP on`.

- `01-smoke-checkout-and-scan.sql` — checkouts, fulfillment, QR issuance, scan admission/replay/tamper.
- `02-terminal-payments.sql` — terminal-state payment policy + provider-cancel outbox.
- `03-festival-rbac.sql` — festival-scoped RBAC.
- `04-gate-assignment-offline.sql` — gate assignment + offline policy.
- `05-export-lease-and-purge.sql` — export job leases, backoff, purge, privileges.
