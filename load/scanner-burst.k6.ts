/**
 * scanner-burst.k6.ts — gate scan load (plan §16.2 profile 9).
 *
 * Drives the scan endpoint at ≥3× the expected gates/second. Scans are the
 * most latency-sensitive event-day operation; the gate is p95 well under a
 * second so queues at gates do not build.
 *
 * Requires seeded scanner device credentials + signed QR tokens (never real
 * participant QRs — §16.1).
 *
 * Run:
 *   k6 run -e GATE_ID=<id> -e SCANNER_TOKENS=scanner-tokens.json \
 *     -e QR_TOKENS=qr-tokens.json load/scanner-burst.k6.ts
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";
import { SharedArray } from "k6/data";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const GATE_ID = __ENV.GATE_ID || "";

const scannerTokens = new SharedArray("scannerTokens", function () {
  return JSON.parse(open(__ENV.SCANNER_TOKENS || "scanner-tokens.json"));
});
const qrTokens = new SharedArray("qrTokens", function () {
  return JSON.parse(open(__ENV.QR_TOKENS || "qr-tokens.json"));
});

const errors = new Rate("scan_errors");
const latency = new Trend("scan_latency", true);

export const options = {
  scenarios: {
    scans: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: 100,
      maxVUs: 400,
      stages: [
        { duration: "30s", target: 15 }, // ≥3× expected gates/second
        { duration: "5m", target: 15 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    scan_latency: ["p(95)<800", "p(99)<1500"],
    scan_errors: ["rate<0.005"],
  },
};

let seq = 0;

export default function () {
  const device = scannerTokens[__VU % scannerTokens.length];
  const qr = qrTokens[__ITER % qrTokens.length];
  if (!device || !qr) return;

  const res = http.post(
    `${BASE_URL}/api/scanner/scan`,
    JSON.stringify({
      scanId: uuidv4(),
      rawToken: qr.token,
      gateId: GATE_ID,
      capturedAtDevice: new Date().toISOString(),
      sequenceNumber: seq++,
      offlineFlag: false,
    }),
    {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${device.accessToken}`,
        "x-scanner-device-credential": device.deviceCredential,
      },
      tags: { name: "scanner:scan" },
    }
  );
  latency.add(res.timings.duration);

  const ok = check(res, {
    "scan answered": (r) => r.status < 500,
  });
  errors.add(!ok);

  sleep(0.2 + Math.random() * 0.3);
}
