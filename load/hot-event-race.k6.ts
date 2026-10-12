/**
 * hot-event-race.k6.ts — capacity race (plan §16.2 profile 5).
 *
 * Thousands of virtual users race for the final small capacity of one hot
 * event. The correctness assertion is NOT latency here — it is that the
 * system never oversells: confirmed + held units must never exceed capacity.
 * After the run, verify via SQL:
 *
 *   select capacity_units, held_units, confirmed_units
 *   from event_inventory where event_id = '<hot-event-id>';
 *
 * and assert held_units + confirmed_units <= capacity_units.
 *
 * Run:
 *   k6 run -e EVENT_ID=<id> -e TOKENS_FILE=tokens.json load/hot-event-race.k6.ts
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter } from "k6/metrics";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";
import { SharedArray } from "k6/data";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const EVENT_ID = __ENV.EVENT_ID || "";

const tokens = new SharedArray("tokens", function () {
  return JSON.parse(open(__ENV.TOKENS_FILE || "tokens.json"));
});

const soldOut = new Counter("race_sold_out");
const confirmed = new Counter("race_confirmed");
const errors = new Rate("race_errors");

export const options = {
  scenarios: {
    race: {
      executor: "shared-iterations",
      vus: 2000,
      iterations: 6000, // more attempts than capacity
      maxDuration: "5m",
    },
  },
  thresholds: {
    // The gate is zero oversell (checked in SQL after the run), plus no
    // uncontrolled 5xx.
    race_errors: ["rate<0.01"],
    http_req_failed: ["rate<0.05"],
  },
};

export default function () {
  const token = tokens[__VU % tokens.length]?.accessToken;
  if (!token) return;

  const res = http.post(
    `${BASE_URL}/api/checkout/events/${EVENT_ID}`,
    JSON.stringify({ teamSize: 1 }),
    {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "idempotency-key": uuidv4(),
      },
      tags: { name: "race:event-checkout" },
    }
  );

  const ok = check(res, {
    "controlled response": (r) => r.status < 500,
  });
  errors.add(!ok);

  if (res.status === 200 || res.status === 201) confirmed.add(1);
  if (res.status === 409) soldOut.add(1);

  sleep(Math.random());
}
