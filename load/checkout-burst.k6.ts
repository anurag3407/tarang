/**
 * checkout-burst.k6.ts — base-pass order burst (plan §16.2 profile 6).
 *
 * Hammers the base-pass checkout creation endpoint with unique idempotency
 * keys to exercise hold acquisition, provider provisioning, and the outbox
 * under burst. Uses seeded auth tokens (never real OTP/email — §16.1).
 *
 * Run:
 *   k6 run -e TOKENS_FILE=tokens.json load/checkout-burst.k6.ts
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";
import { SharedArray } from "k6/data";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const PASS_PRODUCT_ID = __ENV.PASS_PRODUCT_ID || "";

// Seeded Supabase access tokens (one per virtual user).
const tokens = new SharedArray("tokens", function () {
  // TOKENS_FILE is a JSON array of { accessToken } objects.
  return JSON.parse(open(__ENV.TOKENS_FILE || "tokens.json"));
});

const errors = new Rate("checkout_errors");
const conflicts = new Counter("checkout_conflicts");
const latency = new Trend("checkout_latency", true);

export const options = {
  scenarios: {
    checkout_burst: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      maxVUs: 1000,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "2m", target: 150 },
        { duration: "5m", target: 150 },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    // Critical write gates (plan §16.3).
    checkout_latency: ["p(95)<1000", "p(99)<2000"],
    checkout_errors: ["rate<0.01"],
  },
};

export default function () {
  const token = tokens[__VU % tokens.length]?.accessToken;
  if (!token) return;

  const res = http.post(
    `${BASE_URL}/api/checkout/base-pass`,
    JSON.stringify({ passProductId: PASS_PRODUCT_ID }),
    {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "idempotency-key": uuidv4(),
      },
      tags: { name: "checkout:base-pass" },
    }
  );
  latency.add(res.timings.duration);

  const ok = check(res, {
    "status is 2xx or controlled 409": (r) =>
      r.status < 300 || r.status === 409,
  });
  if (res.status === 409) conflicts.add(1);
  errors.add(!ok);

  sleep(1 + Math.random() * 2);
}
