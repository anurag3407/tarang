/**
 * public-burst.k6.ts — public read load (plan §16.2 profiles 1–4).
 *
 * Warm-cache 3,000 VUs with realistic think time, plus a sudden ramp variant.
 * Targets the public read endpoints that must stay fast under burst.
 *
 * Run:
 *   k6 run load/public-burst.k6.ts
 *   k6 run -e RAMP=1 load/public-burst.k6.ts   # 0→3000 in 60s variant
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const RAMP = (__ENV.RAMP || "0") === "1";

const errors = new Rate("public_errors");
const ttfb = new Trend("public_ttfb", true);

export const options = {
  scenarios: {
    public_reads: RAMP
      ? {
          executor: "ramping-vus",
          startVUs: 0,
          stages: [
            { duration: "60s", target: 3000 }, // sudden ramp
            { duration: "15m", target: 3000 }, // hold
            { duration: "1m", target: 0 },
          ],
        }
      : {
          executor: "constant-vus",
          vus: 3000,
          duration: "30m", // warm-cache soak
        },
  },
  thresholds: {
    // Plan §16.3 gates.
    http_req_duration: ["p(95)<750", "p(99)<1500"],
    public_errors: ["rate<0.001"],
    http_req_failed: ["rate<0.001"],
  },
};

const PATHS = [
  "/api/public/events",
  "/api/public/schedule",
  "/api/public/notices",
  "/api/public/pass-products",
  "/events",
  "/schedule",
  "/notices",
];

export default function () {
  const path = PATHS[Math.floor(Math.random() * PATHS.length)];
  const res = http.get(`${BASE_URL}${path}`, {
    tags: { name: `public:${path}` },
  });
  ttfb.add(res.timings.waiting);
  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
  });
  errors.add(!ok);

  // Realistic think time: one action every ~10 seconds per user.
  sleep(8 + Math.random() * 4);
}
