import { generateKeyPairSync, createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ID, resetWorld, sb, userSb } from "./helpers/mocks";
import {
  json,
  post,
  expectOkEnvelope,
  expectErrEnvelope,
} from "./helpers/requests";
import type { QrPayload } from "@/domain/scanning";

// QR signing keys for this worker (DER base64 — production storage format).
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.QR_ED25519_PRIVATE_KEY_BASE64 = privateKey
  .export({ type: "pkcs8", format: "der" })
  .toString("base64");
process.env.QR_ED25519_PUBLIC_KEY_BASE64 = publicKey
  .export({ type: "spki", format: "der" })
  .toString("base64");
process.env.QR_SIGNING_KEY_ID = "k1";

vi.mock("@/lib/supabase/service-role", async () => {
  const m = await import("./helpers/mocks");
  return { createServiceRoleClient: () => m.sb };
});
vi.mock("@/lib/supabase/server", async () => {
  const m = await import("./helpers/mocks");
  return { createServerSupabase: async () => m.userSb };
});
vi.mock("@/lib/redis/rate-limits", async () => {
  const m = await import("./helpers/mocks");
  return {
    checkRateLimit: m.rateLimiter.checkRateLimit.bind(m.rateLimiter),
    enforceRateLimit: m.rateLimiter.enforceRateLimit.bind(m.rateLimiter),
  };
});

import { POST as scanRoute } from "@/app/api/scanner/scan/route";
import { signQrToken } from "@/lib/qr/credential";

const SCAN_ID = randomUUID();
const GATE_ID = "6a7e3173-6a73-4617-8a17-6a7e31a76a73";
const DEVICE_CREDENTIAL = "scanner-device-e2e-secret";
const DEVICE_HASH = createHash("sha256").update(DEVICE_CREDENTIAL).digest("hex");

function nowPayload(overrides: Partial<QrPayload> = {}): QrPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    v: 1,
    jti: "6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d",
    fest: "pulse-2026",
    pass: "PS-E2E-0001",
    entv: 1,
    nbf: now - 120,
    exp: now + 3600,
    class: "BASE",
    ...overrides,
  };
}

/** Operator permission + enrolled ACTIVE device consumed by every scan. */
function seedScanGuards(deviceState = "ACTIVE"): void {
  userSb.setActor({ id: ADMIN_ID, email: "gateops@example.com", confirmed: true });
  userSb.onRpc("has_permission", { data: true, error: null }); // scanner.use
  sb.onTable("scanner_devices", {
    data: { id: "dev-row-1", state: deviceState },
    error: null,
  });
}

function scanRequest(rawToken: string, extraBody: Record<string, unknown> = {}): ReturnType<typeof post> {
  return post("/api/scanner/scan", {
    body: {
      scanId: SCAN_ID,
      rawToken,
      gateId: GATE_ID,
      capturedAtDevice: new Date().toISOString(),
      sequenceNumber: 0,
      offlineFlag: false,
      ...extraBody,
    },
    headers: { "x-scanner-device-credential": DEVICE_CREDENTIAL },
  });
}

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.advanceTimersByTime(31_000);
  resetWorld({ actor: { id: ADMIN_ID, email: "gateops@example.com", confirmed: true } });
});

describe("POST /api/scanner/scan — accepted entry (plan §14.6)", () => {
  it("verifies a live token and returns the atomic admission decision", async () => {
    const token = await signQrToken(nowPayload());
    seedScanGuards();
    sb.onTable("qr_credentials", {
      data: {
        jti: nowPayload().jti,
        state: "ACTIVE",
        delegate_pass_id: "pass-row",
        delegate_passes: {
          user_id: "u-1",
          profiles: { display_name: "Aarav Sharma" },
        },
      },
      error: null,
    });
    sb.onRpc("record_scan", {
      data: {
        outcome: "accepted",
        reason: null,
        display: { maskedName: "A******a", passClass: "BASE" },
        recentScans: [{ gateName: "Main Gate", at: new Date().toISOString(), outcome: "accepted" }],
      },
      error: null,
    });

    const res = await scanRoute(scanRequest(token));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.outcome).toBe("accepted");
    expect(body.data.display).toEqual({
      maskedName: "A******a",
      passClass: "BASE",
      eventName: null,
    });

    const rpc = sb.rpcParams("record_scan")!;
    expect(rpc.p_scan_id).toBe(SCAN_ID);
    expect(rpc.p_gate_id).toBe(GATE_ID);
    expect(rpc.p_device_id).toBe("dev-row-1");
    expect(rpc.p_operator_user_id).toBe(ADMIN_ID);
    expect(rpc.p_credential_state).toBe("valid");
    expect(rpc.p_pass_class).toBe("BASE");
    expect(rpc.p_masked_name).toBe("A******a");
    expect(String(rpc.p_credential_digest)).toHaveLength(64);
    // The device lookup keyed on the SHA-256 of the presented credential.
    expect(sb.callsFor("scanner_devices")[0].filters["credential_hash"]).toBe(DEVICE_HASH);
  });

  it("is idempotent per scanId — the SQL function replays the prior result", async () => {
    const token = await signQrToken(nowPayload());
    seedScanGuards();
    sb.onTable("qr_credentials", {
      data: {
        jti: nowPayload().jti,
        state: "ACTIVE",
        delegate_pass_id: "pass-row",
        delegate_passes: { user_id: "u-1", profiles: null },
      },
      error: null,
    });
    sb.onRpc("record_scan", {
      data: { outcome: "duplicate", reason: "already_scanned_at_17_02", display: { maskedName: "A******a" }, recentScans: [] },
      error: null,
    });

    const res = await scanRoute(scanRequest(token));
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.outcome).toBe("duplicate");
    expect(body.data.reasonCode).toBe("already_scanned_at_17_02");
  });

  it("evaluates a refunded pass as outcome refunded", async () => {
    const token = await signQrToken(nowPayload());
    seedScanGuards();
    sb.onTable("qr_credentials", {
      data: {
        jti: nowPayload().jti,
        state: "REVOKED",
        delegate_pass_id: "pass-refunded-row",
        delegate_passes: { user_id: "u-1", state: "REFUNDED", profiles: { display_name: "Refunded User" } },
      },
      error: null,
    });
    sb.onRpc("record_scan", {
      data: { outcome: "refunded", reason: "pass_refunded", display: { maskedName: "R*****r" }, recentScans: [] },
      error: null,
    });

    const res = await scanRoute(scanRequest(token));
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.outcome).toBe("refunded");
    expect(body.data.reasonCode).toBe("pass_refunded");
    const rpc = sb.rpcParams("record_scan")!;
    expect(rpc.p_credential_state).toBe("refunded");
  });
});

describe("POST /api/scanner/scan — forged and stale tokens are audited", () => {
  it.each([
    ["expired", nowPayload({ nbf: Date.now() / 1000 - 7200, exp: Date.now() / 1000 - 3600 })],
    ["not_yet_valid", nowPayload({ nbf: Date.now() / 1000 + 3600, exp: Date.now() / 1000 + 7200 })],
  ])("records a %s attempt without resolving the credential", async (_name, payload) => {
    const token = await signQrToken(payload);
    seedScanGuards();
    sb.onRpc("record_scan", {
      data: null,
      error: null,
    });

    const res = await scanRoute(scanRequest(token));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.outcome).toBe(_name);

    const rpc = sb.rpcParams("record_scan")!;
    expect(rpc.p_credential_jti).toBeNull();
    expect(rpc.p_credential_state).toBe(_name);
    expect(sb.callsFor("qr_credentials")).toHaveLength(0); // never resolved
  });

  it("rejects a tampered payload as invalid_signature but still audits it", async () => {
    const token = await signQrToken(nowPayload());
    const parts = token.split(".");
    const tampered = [parts[0], parts[1], parts[2].slice(0, 8) + "X" + parts[2].slice(9), parts[3]].join(".");
    seedScanGuards();
    sb.onRpc("record_scan", { data: null, error: null });

    const res = await scanRoute(scanRequest(tampered));
    const body = await json(res);
    expectOkEnvelope(body);
    expect(["invalid_signature", "invalid_format"]).toContain(body.data.outcome);
    expect(sb.rpcParams("record_scan")?.p_credential_state).toBe("invalid_signature");
  });

  it("rejects tokens signed under an unknown key id", async () => {
    const token = await signQrToken(nowPayload());
    const parts = token.split(".");
    const forgedKid = [parts[0], "k99", parts[2], parts[3]].join(".");
    seedScanGuards();
    sb.onRpc("record_scan", { data: null, error: null });

    const res = await scanRoute(scanRequest(forgedKid));
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.outcome).toBe("invalid_signature");
  });

  it("garbage input is schema-rejected before any crypto runs", async () => {
    seedScanGuards();

    const res = await scanRoute(scanRequest("short"));
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
    expect(sb.callsFor("record_scan")).toHaveLength(0);
  });
});

describe("POST /api/scanner/scan — device security (plan §14.5.2)", () => {
  it("401s when the device credential header is missing", async () => {
    userSb.setActor({ id: ADMIN_ID, email: "gateops@example.com", confirmed: true });
    userSb.onRpc("has_permission", { data: true, error: null });
    const token = await signQrToken(nowPayload());

    const req = post("/api/scanner/scan", {
      body: { scanId: SCAN_ID, rawToken: token, gateId: GATE_ID },
    });
    const res = await scanRoute(req);
    expect(res.status).toBe(401);
    expectErrEnvelope(await json(res), "UNAUTHORIZED");
  });

  it("401s an unknown or revoked device credential", async () => {
    const token = await signQrToken(nowPayload());
    userSb.setActor({ id: ADMIN_ID, email: "gateops@example.com", confirmed: true });
    userSb.onRpc("has_permission", { data: true, error: null });
    sb.onTable("scanner_devices", { data: { id: "dev-row-1", state: "INACTIVE" }, error: null });

    const res = await scanRoute(scanRequest(token));
    expect(res.status).toBe(401);
    expectErrEnvelope(await json(res), "UNAUTHORIZED");
    expect(sb.callsFor("scanner_devices")[0].filters["credential_hash"]).toBe(
      createHash("sha256").update(DEVICE_CREDENTIAL).digest("hex")
    );
  });
});

describe("POST /api/scanner/scan — supervisor override (plan §14.7)", () => {
  it("requires scanner.supervise before honoring an override flag", async () => {
    const token = await signQrToken(nowPayload());
    seedScanGuards();
    // Second permission check (override) fails.
    userSb.onRpc("has_permission", { data: false, error: null });

    const res = await scanRoute(scanRequest(token, { override: true, overrideReason: "Wristband damaged" }));
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
    expect(sb.callsFor("record_scan")).toHaveLength(0);
  });

  it("forwards the override context to record_scan when permitted", async () => {
    const token = await signQrToken(nowPayload());
    seedScanGuards();
    userSb.onRpc("has_permission", { data: true, error: null }); // scanner.supervise
    sb.onTable("qr_credentials", {
      data: {
        jti: nowPayload().jti,
        state: "ACTIVE",
        delegate_pass_id: "p",
        delegate_passes: { user_id: "u", profiles: null },
      },
      error: null,
    });
    sb.onRpc("record_scan", { data: { outcome: "manual_override", reason: null, display: null, recentScans: [] }, error: null });

    const res = await scanRoute(scanRequest(token, { override: true, overrideReason: "Wristband damaged" }));
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.outcome).toBe("manual_override");
    const rpc = sb.rpcParams("record_scan")!;
    expect(rpc.p_override).toBe(true);
    expect(rpc.p_override_reason).toBe("Wristband damaged");
  });
});

describe("POST /api/scanner/scan — validation matrix", () => {
  const tokenPromise = signQrToken(nowPayload());

  it.each([
    ["bad scanId uuid", { scanId: "nope" }],
    ["negative sequenceNumber", { sequenceNumber: -1 }],
    ["extra strict field", { attackerField: true }],
    ["missing capturedAtDevice", { capturedAtDevice: undefined }],
  ] as const)("%s -> 422", async (_name, patch) => {
    seedScanGuards();
    const token = await tokenPromise;
    const body: Record<string, unknown> = {
      scanId: SCAN_ID,
      rawToken: token,
      gateId: GATE_ID,
      capturedAtDevice: new Date().toISOString(),
      sequenceNumber: 0,
      offlineFlag: false,
    };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete body[k];
      else body[k] = v;
    }

    const res = await scanRoute(post("/api/scanner/scan", { body, headers: { "x-scanner-device-credential": DEVICE_CREDENTIAL } }));
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
  });

  it("500s INTERNAL when the atomic scan cannot be recorded", async () => {
    const token = await tokenPromise;
    seedScanGuards();
    sb.onTable("qr_credentials", {
      data: {
        jti: nowPayload().jti,
        state: "ACTIVE",
        delegate_pass_id: "p",
        delegate_passes: null,
      },
      error: null,
    });
    sb.onRpc("record_scan", { data: null, error: { message: "deadlock detected" } });

    const res = await scanRoute(scanRequest(token));
    expect(res.status).toBe(500);
    expectErrEnvelope(await json(res), "INTERNAL");
  });
});
