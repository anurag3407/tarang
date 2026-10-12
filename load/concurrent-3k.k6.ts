/**
 * 3000-concurrent-user burst test against local standalone build.
 * Mirrors repo gates (plan §16.3): p95<750ms p99<1500ms err<0.1%.
 * Read-only public paths — no mutations, no checkout.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3100";
const HOLD_S = Number(__ENV.HOLD_SECONDS || "180");

const errors = new Rate("public_errors");
const ttfb = new Trend("public_ttfb", true);

export const options = {
  scenarios: {
    public_reads: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "60s", target: 3000 },
        { duration: `${HOLD_S}s`, target: 3000 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
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
  const ok = check(res, { "status is 200": (r) => r.status === 200 });
  errors.add(!ok);
  sleep(8 + Math.random() * 4);
}
