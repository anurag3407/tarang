import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "https://pulseasa.org";

const errors = new Rate("errors");
const ttfb = new Trend("ttfb", true);

export const options = {
  scenarios: {
    concurrent_200_users: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "15s", target: 200 }, // Ramp up to 200 concurrent users
        { duration: "30s", target: 200 }, // Sustain 200 concurrent users
        { duration: "10s", target: 0 },   // Ramp down
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"], // Less than 1% failure rate
    http_req_duration: ["p(95)<1500"], // 95% of requests under 1.5s
  },
};

const PATHS = [
  "/",
  "/events",
  "/schedule",
  "/notices",
  "/api/public/events",
  "/api/public/schedule",
  "/api/public/pass-products",
  "/api/public/notices",
];

export default function () {
  const path = PATHS[Math.floor(Math.random() * PATHS.length)];
  const res = http.get(`${BASE_URL}${path}`, {
    headers: {
      "User-Agent": "k6-load-tester/200-users",
    },
  });

  ttfb.add(res.timings.waiting);
  const isOk = check(res, {
    "status is 200": (r) => r.status === 200,
  });

  errors.add(!isOk);

  // Think time between clicks (1.5s - 3.5s per active simulated user)
  sleep(1.5 + Math.random() * 2);
}
