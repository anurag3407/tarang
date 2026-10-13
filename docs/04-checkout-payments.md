# 04 — Checkout & Payments

The most complex part of the codebase. Take your time.

## The state machine (memorize this)

### Checkout states (`orders.checkout_state`)

```
PROVISIONING_PROVIDER ──▶ AWAITING_PAYMENT ──▶ FULFILLED
        │                        │      │
        │                        │      └────▶ EXPIRED (hold expired before payment)
        ▼                        │
     CANCELLED                   └────▶ PAYMENT_REVIEW (uncertain state, reconciler decides)
```

| State | Meaning |
|-------|---------|
| PROVISIONING_PROVIDER | Order created, Razorpay order being created (or was disrupted) |
| AWAITING_PAYMENT | Razorpay order ready, waiting for user to pay |
| FULFILLED | Payment confirmed, pass/registration created, user owns the item |
| EXPIRED | Capacity hold expired before payment settled |
| PAYMENT_REVIEW | Uncertain state — money situation unclear, reconciler resolves |
| CANCELLED | Checkout abandoned or provider rejected |

### Payment states (`payments.provider_status`)

`created`, `authorized`, `captured`, `failed`, `refunded`. Only **captured** triggers fulfillment.

## Step-by-step: buying a base pass

```
┌─────────────────┐  POST /api/checkout/base-pass
│     Browser      │──────────────────────────────┐
└─────────────────┘   body: passProductId +        │
                      Idempotency-Key header       │
                                                   ▼
                    ┌──────────────────────────────────────────────┐
                    │ checkout-service.ts:createBasePassCheckout   │
                    │                                              │
                    │ 1. Call SQL fn create_base_pass_checkout     │
                    │    - Creates orders + order_lines rows       │
                    │    - Snapshots price from current price      │
                    │      version (never uses client's price)     │
                    │    - Reserves capacity hold atomically       │
                    │    - Enforces: no duplicate open base pass,  │
                    │      feature flags, idempotency              │
                    │    Returns: orderId, replayed (if duplicate) │
                    │                                              │
                    │ 2. If replayed → return cached result        │
                    │                                              │
                    │ 3. Else: provision Razorpay order OUTSIDE    │
                    │    the transaction (HTTP call, no DB locks)  │
                    │    - Creates rzp.orders.create with          │
                    │      automatic capture                       │
                    │    - attach_razorpay_order maps              │
                    │      local↔provider order IDs                │
                    │                                              │
                    │ 4. If price = 0: fulfill immediately with    │
                    │    synthetic payment                         │
                    └──────────────────────────────────────────────┘
                                                   │
                                                   ▼
                              Response: {razorpayOrderId, amount, keyId, expiresAt}
                                                   │
                                                   ▼
                              Browser opens Razorpay Checkout widget with that orderId
```

### What the SQL function does (migration 0005)

`create_base_pass_checkout` (and `create_event_checkout`) is the heavyweight:

- Runs in a single transaction.
- **Capacity hold**: inserts `capacity_holds` row with `expires_at` = now + hold minutes.
  This decrements available inventory immediately so nobody else can grab it.
- **Price snapshot**: reads `pass_price_versions.unit_amount_paise` and stores it
  in `order_lines`. Price changes after checkout start don't affect this order.
- **Availability check**: fails with `SOLD_OUT` if `capacity < held + confirmed + 1`.
- **Idempotency**: inserts into `api_idempotency` keyed by `(scope, idempotency_key)`.
  If same key arrives with different payload → `IDEMPOTENCY_MISMATCH` error.

## Step-by-step: payment verification

After Razorpay widget returns to `/api/checkout/razorpay/verify`:

```
1. Verify HMAC signature (razorpayOrderId + paymentId signed with key secret)
   → throw SIGNATURE_INVALID if bad. NEVER trust without this.

2. Look up razorpay_orders mapping → find local_order_id

3. Fetch payment status from Razorpay API (authoritative)

4. If status is "captured":
   └─ Call SQL fn apply_captured_payment
      - Maps payment → local order
      - Transitions order AWAITING_PAYMENT → FULFILLED
      - Inserts delegate_passes / registrations
      - Enqueues outbox jobs (SEND_EMAIL, ISSUE_QR, INVALIDATE_CACHE)
      All in one transaction.

5. If NOT captured: return PROCESSING. Webhook or reconciler decides.
```

**Key rule:** `apply_captured_payment` is the ONLY function that moves money forward.
It's idempotent — calling it twice (webhook + browser callback arrive) doesn't double-credit.

## The webhooks

Razorpay sends `payment.captured`, `payment.failed`, `order.paid`, `refund.*` events to
`/api/webhooks/razorpay`:

```
1. Read exact raw body (needed for HMAC)
2. Verify X-Razorpay-Signature against current OR previous secret (key rotation)
3. Insert into webhook_events (dedup by provider_event_id)
   - Duplicate delivery → return OK without processing
   - DB insert fail → return 503 so Razorpay retries later
4. Process async via after() — don't block the response
5. Processing calls apply_captured_payment / records refund status
```

The webhook has TWO secrets because Razorpay rotates them. Always keep both set.

## Refunds

Flow: admin cancels registration → refund created in DB → outbox job →
`submitRefund` calls Razorpay → state PENDING → webhook/reconciler marks PROCESSED.

```
REQUESTED ──▶ SUBMITTING ──▶ PENDING ──▶ PROCESSED
                    │
                    ▼ (provider error, retryable)
               REQUESTED (retry with backoff)
               ▼ (deterministic failure)
               FAILED
```

Only captured payments can be refunded. Refund amount is atomically reserved before
the provider call to prevent double-refund.

## Free events and zero-price passes

If `amount_paise === 0`:
- Skip Razorpay entirely.
- `checkout-service.ts:222 fulfillFreeOrder` attaches a synthetic payment ID
  (`free_<orderId>`) and calls `apply_captured_payment` with it.
- User gets their pass/registration immediately.

## What can go wrong?

| Symptom | Likely cause | Where to look |
|---------|-------------|--------------|
| "SOLD_OUT" but event looks available | Capacity holds (unconverted checkouts) still counting | `SELECT count(*) FROM capacity_holds WHERE expires_at > now();` — hold reaper may be stuck, see [05](./05-workers-jobs.md) |
| Order stuck in AWAITING_PAYMENT after payment | Webhook failed or `payment.captured` not yet received | Check `webhook_events` table for the order's provider_event_id; check Razorpay dashboard |
| `SIGNATURE_INVALID` on verify | Wrong `RAZORPAY_KEY_SECRET` or clock skew | Verify env vars + server time |
| `IDEMPOTENCY_MISMATCH` | Client reusing one key with different payloads | Generate new UUID per action |
| Paid but order not FULFILLED | `apply_captured_payment` failed mid-way | Check `payment_applications` and `orders`; reconciler should recover (see [05](./05-workers-jobs.md)) |
| Capacity hold leaked (no one can buy) | `hold_expires_at` passed but reaper didn't run | `SELECT * FROM capacity_holds WHERE expires_at < now() LIMIT 5;` — check worker is alive |
| Free event also tries Razorpay | Bug in amount=0 detection | Check order row's `amount_paise` in DB |

### Diagnostic queries

```sql
-- Latest orders with their Razorpay mapping
SELECT o.public_order_code, o.checkout_state, o.amount_paise, o.created_at,
       rp.razorpay_order_id
FROM orders o LEFT JOIN razorpay_orders rp ON rp.local_order_id = o.id
ORDER BY o.created_at DESC LIMIT 20;

-- Payments never applied (had money, no fulfillment)
SELECT p.razorpay_payment_id, p.provider_status, p.created_at
FROM payments p
WHERE p.provider_status = 'captured'
  AND NOT EXISTS (SELECT 1 FROM payment_applications pa WHERE pa.payment_id = p.id);

-- Open capacity holds expiring soon
SELECT * FROM capacity_holds WHERE expires_at BETWEEN now() AND now() + interval '15 minutes' ORDER BY expires_at;
```

## Discount codes (passes only)

Superadmins issue codes at `/admin/discounts` (permission `discount.manage`, which
is protected: custom roles can never hold it). A code is a flat amount or a
percentage, optionally scoped to one pass product, with optional validity window,
total-use cap and per-person cap. The code and its value are immutable once
issued; limits, validity and the active flag can change. A code that any order
has referenced cannot be deleted — deactivate it.

Flow:

```
POST /api/checkout/discount-preview  { passProductId, code }   → advisory quote
POST /api/checkout/base-pass         { passProductId, discountCode }
  └─ create_base_pass_checkout(..., p_discount_code)
       └─ evaluate_pass_discount(..., p_lock => true)
```

- The browser never sends an amount. `evaluate_pass_discount` is the only place a
  discount is computed, inside the checkout transaction.
- `order_lines` keep the full price; `orders.amount_paise` is the amount charged and
  `orders.discount_paise` the discount. The deferred total check enforces
  `amount_paise + discount_paise = sum(line_amount_paise)`.
- Redemptions are counted from live orders (`PROVISIONING_PROVIDER`,
  `AWAITING_PAYMENT`, `FULFILLED`, `PAYMENT_REVIEW`). Cancelled/expired orders free
  their slot automatically. Checkout locks the code row, so concurrent buyers
  cannot exceed the cap.
- A partial discount never leaves less than ₹1 (Razorpay's minimum). A 100%
  discount makes the order free and it takes the zero-price path above.
- The code is part of the idempotency request hash: retrying a key with a
  different code is `IDEMPOTENCY_MISMATCH`.
- Preview and code-bearing checkouts share the `discount` rate limit
  (20 / 10 min per user and per IP, fail closed). Unknown, inactive, expired and
  wrong-pass codes return the same `DISCOUNT_INVALID` message.
- `discount_codes` has RLS on with no policies and no grants for `anon` /
  `authenticated`; only the service role reads it, after the admin route has
  checked `discount.manage`. Create/update/delete are written to `audit_logs`.
