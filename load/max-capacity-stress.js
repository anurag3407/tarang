import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "https://pulseasa.org";

const errors = new Rate("error_rate");
const ttfb = new Trend("ttfb_duration", true);
const successfulReqs = new Counter("successful_requests");

export const options = {
  scenarios: {
    max_capacity_step_up: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 50 },   // Warmup: 50 users
        { duration: "15s", target: 100 },  // Step 1: 100 users
        { duration: "15s", target: 200 },  // Step 2: 200 users
        { duration: "20s", target: 350 },  // Step 3: 350 users
        { duration: "25s", target: 500 },  // Step 4: 500 users (Saturation test)
        { duration: "10s", target: 0 },    // Cooldown
      ],
    },
  },
  thresholds: {
    // We don't fail immediately on high load, we want to observe the exact curve
    error_rate: ["rate<0.20"],
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
      "User-Agent": "k6-max-capacity-tester",
    },
    timeout: "10s",
  });

  ttfb.add(res.timings.waiting);
  const isOk = check(res, {
    "status is 200": (r) => r.status === 200,
  });

  if (isOk) {
    successfulReqs.add(1);
    errors.add(0);
  } else {
    errors.add(1);
  }

  // Realistic human think time between clicks
  sleep(1.0 + Math.random() * 1.5);
}
