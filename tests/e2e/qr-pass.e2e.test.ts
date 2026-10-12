import { generateKeyPairSync, createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FESTIVAL_ID,
  PASS_ID,
  USER_ID,
  resetWorld,
  sb,
  userSb,
} from "./helpers/mocks";
import {
  ctx,
  get,
  json,
  post,
  expectOkEnvelope,
  expectErrEnvelope,
} from "./helpers/requests";

// Throwaway Ed25519 keypair for the worker process (DER bytes base64-encoded,
// exactly how production stores them).
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

import { GET as myPassesRoute } from "@/app/api/me/passes/route";
import { GET as passQrRoute } from "@/app/api/me/passes/[passId]/qr/route";
import { POST as enrollDeviceRoute } from "@/app/api/scanner/devices/route";
import { GET as scannerSessionRoute } from "@/app/api/scanner/session/route";
import { verifyQrToken } from "@/lib/qr/credential";

const JTI = "6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d";
const CRED_ID = "cred-e2e-1";
const DEVICE_CREDENTIAL = "device-secret-e2e";
const DEVICE_HASH = createHash("sha256").update(DEVICE_CREDENTIAL).digest("hex");

function seedFestival(): void {
  // Active festival comes from the resetWorld default.
}

function seedIssuance(): void {
  // issueQrCredential — no existing credential.
  sb.onTable("qr_credentials", { data: null, error: null });
  sb.onTable("delegate_passes", {
    data: {
      id: PASS_ID,
      state: "ACTIVE",
      festival_id: FESTIVAL_ID,
      expires_at: null,
      festivals: { slug: "pulse-2026", ends_at: "2027-03-01T00:00:00Z" },
    },
    error: null,
  });
  sb.onTable("qr_credentials", {
    data: {
      id: CRED_ID,
      jti: JTI,
      entitlement_version: 1,
      not_before: new Date(Date.now() - 60_000).toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    },
    error: null,
  });
}

function seedActiveCredentialForSigning(): void {
  sb.onTable("qr_credentials", {
    data: {
      id: CRED_ID,
      jti: JTI,
      entitlement_version: 1,
      state: "ACTIVE",
      festival_id: FESTIVAL_ID,
      not_before: new Date(Date.now() - 60_000).toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      delegate_passes: {
        public_pass_code: "PS-E2E-0001",
        festivals: { slug: "pulse-2026" },
      },
    },
    error: null,
  });
  sb.onTable("qr_credentials", { data: null, error: null }); // token_digest update
}

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.advanceTimersByTime(31_000);
  resetWorld({ actor: { id: USER_ID, email: "student@example.com", confirmed: true } });
});

describe("GET /api/me/passes (plan §14.2)", () => {
  it("lists the caller's passes with product names", async () => {
    seedFestival();
    sb.onTable("delegate_passes", {
      data: [
        {
          id: PASS_ID,
          public_pass_code: "PS-E2E-0001",
          state: "ACTIVE",
          activated_at: "2026-08-20T10:00:00Z",
          expires_at: null,
          pass_products: { name: "Base Delegate Pass" },
        },
        {
          id: "pass-void",
          public_pass_code: "PS-E2E-0002",
          state: "REVOKED",
          activated_at: null,
          expires_at: null,
          pass_products: null,
        },
      ],
      error: null,
    });

    const res = await myPassesRoute(get("/api/me/passes"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    const passes = body.data.passes as Array<Record<string, unknown>>;
    expect(passes[0]).toMatchObject({
      id: PASS_ID,
      publicPassCode: "PS-E2E-0001",
      productName: "Base Delegate Pass",
    });
    expect(passes[1].productName).toBe("Delegate Pass"); // fallback
  });
});

describe("GET /api/me/passes/:passId/qr (plan §14.2.4)", () => {
  it("issues a credential on demand and returns a signed verifiable token", async () => {
    seedFestival();
    sb.onTable("delegate_passes", {
      data: {
        id: PASS_ID,
        user_id: USER_ID,
        state: "ACTIVE",
        public_pass_code: "PS-E2E-0001",
      },
      error: null,
    });
    seedIssuance();
    seedActiveCredentialForSigning();

    const res = await passQrRoute(
      get(`/api/me/passes/${PASS_ID}/qr`),
      ctx({ passId: PASS_ID })
    );

    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.token).toMatch(/^P1\.k1\./);
    expect(body.data.passCode).toBe("PS-E2E-0001");
    expect(String(body.data.warning)).toMatch(/Do not share/i);

    // Roundtrip: the token the dashboard would encode into a QR verifies cleanly.
    const verified = await verifyQrToken(body.data.token as string);
    expect(verified.valid).toBe(true);
    expect(verified.payload).toMatchObject({
      jti: JTI,
      fest: "pulse-2026",
      pass: "PS-E2E-0001",
      entv: 1,
      class: "BASE",
    });

    // Digest persisted; raw token never stored.
    const digestUpdate = sb.callsFor("qr_credentials").find((c) => c.action === "update");
    expect((digestUpdate!.payload as Record<string, unknown>).token_digest).toHaveLength(64);
  });

  it("reuses the existing ACTIVE credential instead of inserting a duplicate", async () => {
    seedFestival();
    sb.onTable("delegate_passes", {
      data: {
        id: PASS_ID,
        user_id: USER_ID,
        state: "ACTIVE",
        public_pass_code: "PS-E2E-0001",
      },
      error: null,
    });
    sb.onTable("qr_credentials", { data: { id: CRED_ID, jti: JTI }, error: null }); // reuse
    seedActiveCredentialForSigning();

    const res = await passQrRoute(
      get(`/api/me/passes/${PASS_ID}/qr`),
      ctx({ passId: PASS_ID })
    );
    expect(res.status).toBe(200);
    expect(sb.callsFor("qr_credentials").filter((c) => c.action === "insert")).toHaveLength(0);
  });

  it("serves a PNG when ?format=png", async () => {
    seedFestival();
    sb.onTable("delegate_passes", {
      data: {
        id: PASS_ID,
        user_id: USER_ID,
        state: "ACTIVE",
        public_pass_code: "PS-E2E-0001",
      },
      error: null,
    });
    sb.onTable("qr_credentials", { data: { id: CRED_ID, jti: JTI }, error: null });
    seedActiveCredentialForSigning();

    const res = await passQrRoute(
      get(`/api/me/passes/${PASS_ID}/qr?format=png`),
      ctx({ passId: PASS_ID })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
  });

  it("403s a pass owned by someone else", async () => {
    seedFestival();
    sb.onTable("delegate_passes", {
      data: { id: PASS_ID, user_id: "77777777-7777-4777-8777-777777777777", state: "ACTIVE" },
      error: null,
    });

    const res = await passQrRoute(get(`/api/me/passes/${PASS_ID}/qr`), ctx({ passId: PASS_ID }));
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
  });

  it("409s an inactive pass", async () => {
    seedFestival();
    sb.onTable("delegate_passes", {
      data: { id: PASS_ID, user_id: USER_ID, state: "REFUNDED" },
      error: null,
    });

    const res = await passQrRoute(get(`/api/me/passes/${PASS_ID}/qr`), ctx({ passId: PASS_ID }));
    expect(res.status).toBe(409);
    expectErrEnvelope(await json(res), "CONFLICT");
  });

  it("404s an unknown pass", async () => {
    seedFestival();
    sb.onTable("delegate_passes", { data: null, error: null });

    const res = await passQrRoute(get(`/api/me/passes/${PASS_ID}/qr`), ctx({ passId: PASS_ID }));
    expect(res.status).toBe(404);
    expectErrEnvelope(await json(res), "NOT_FOUND");
  });
});

describe("QR reissue (service-level, plan §14.2.6)", () => {
  it("revokes the old credential and bumps the entitlement version", async () => {
    const { reissueQrCredential } = await import("@/services/qr-service");

    sb.onTable("qr_credentials", { data: null, error: null }); // revoke update
    sb.onTable("qr_credentials", { data: { entitlement_version: 3 }, error: null }); // prior read
    // issueQrCredential chain:
    sb.onTable("qr_credentials", { data: null, error: null }); // no active
    sb.onTable("delegate_passes", {
      data: {
        id: PASS_ID,
        state: "ACTIVE",
        festival_id: FESTIVAL_ID,
        expires_at: null,
        festivals: { slug: "pulse-2026", ends_at: null },
      },
      error: null,
    });
    sb.onTable("qr_credentials", {
      data: { id: "cred-new", jti: JTI, entitlement_version: 1, not_before: new Date().toISOString(), expires_at: new Date(Date.now() + 86_400_000).toISOString() },
      error: null,
    });

    const issued = await reissueQrCredential(PASS_ID);
    expect(issued.credentialId).toBe("cred-new");

    const bump = sb.callsFor("qr_credentials").filter((c) => c.action === "update").at(-1);
    expect(bump?.filters["id"]).toBe("cred-new");
    expect((bump!.payload as Record<string, unknown>).entitlement_version).toBe(4);

    const replaced = sb.callsFor("qr_credentials")[0];
    expect((replaced.payload as Record<string, unknown>).state).toBe("REPLACED");
  });
});

describe("POST /api/scanner/devices (plan §14.5.2)", () => {
  function grant(permission = true): void {
    userSb.setActor({ id: ADMIN_ID_LOCAL, email: "admin@example.com", confirmed: true });
    userSb.onRpc("has_permission", { data: permission, error: null });
  }

  it("enrolls a device and returns the plaintext credential exactly once", async () => {
    grant();
    sb.onTable("scanner_devices", {
      data: { id: "dev-row-1", public_device_id: "DEV-E2E-1" },
      error: null,
    });

    const res = await enrollDeviceRoute(
      post("/api/scanner/devices", { body: { name: "Gate A phone" } })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.deviceId).toBe("DEV-E2E-1");

    const credential = body.data.credential as string;
    expect(credential.length).toBeGreaterThanOrEqual(32);
    const insert = sb.callsFor("scanner_devices").find((c) => c.action === "insert")!;
    expect(insert.payload).toMatchObject({
      name: "Gate A phone",
      state: "ACTIVE",
      credential_hash: createHash("sha256").update(credential).digest("hex"),
    });
  });

  it("422s a too-short device name", async () => {
    grant();
    const res = await enrollDeviceRoute(
      post("/api/scanner/devices", { body: { name: "x" } })
    );
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
  });

  it("403s operators without scanner.device.manage", async () => {
    grant(false);
    const res = await enrollDeviceRoute(
      post("/api/scanner/devices", { body: { name: "Gate A phone" } })
    );
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
  });
});

describe("GET /api/scanner/session (plan §14.5)", () => {
  beforeEach(() => {
    userSb.setActor({ id: ADMIN_ID_LOCAL, email: "admin@example.com", confirmed: true });
  });

  function grantScannerUse(ok: boolean): void {
    userSb.onRpc("has_permission", { data: ok, error: null });
  }

  function deviceRow(state = "ACTIVE"): Record<string, unknown> {
    return { id: "dev-row-1", public_device_id: "DEV-E2E-1", name: "Gate A phone", state };
  }

  it("resolves the operator's gate assignment with policy defaults", async () => {
    grantScannerUse(true);
    sb.onTable("scanner_devices", { data: deviceRow(), error: null });
    sb.onTable("gate_assignments", {
      data: {
        gate_id: "gate-main",
        valid_from: "2027-02-24T00:00:00Z",
        valid_until: "2027-03-02T00:00:00Z",
        gates: [
          {
            id: "gate-main",
            name: "Main Gate",
            gate_type: "GENERAL",
            admission_policy: "ONE_PER_DAY",
            offline_policy: "FAIL_CLOSED",
            linked_event_id: null,
          },
        ],
      },
      error: null,
    });

    const res = await scannerSessionRoute(
      get("/api/scanner/session", { "x-scanner-device-credential": DEVICE_CREDENTIAL })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.assignment).toMatchObject({
      gateId: "gate-main",
      gateName: "Main Gate",
      admissionPolicy: "ONE_PER_DAY",
      offlinePolicy: "FAIL_CLOSED",
    });
    // The device lookup keyed on the SHA-256 of the presented credential.
    const lookup = sb.callsFor("scanner_devices")[0];
    expect(lookup.filters["credential_hash"]).toBe(DEVICE_HASH);
  });

  it("returns a null assignment for an unassigned but enrolled device", async () => {
    grantScannerUse(true);
    sb.onTable("scanner_devices", { data: deviceRow(), error: null });
    sb.onTable("gate_assignments", { data: null, error: null });

    const res = await scannerSessionRoute(
      get("/api/scanner/session", { "x-scanner-device-credential": DEVICE_CREDENTIAL })
    );
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.assignment).toBeNull();
  });

  it("401s a missing device credential header", async () => {
    grantScannerUse(true);

    const res = await scannerSessionRoute(get("/api/scanner/session"));
    expect(res.status).toBe(401);
    expectErrEnvelope(await json(res), "UNAUTHORIZED");
  });

  it.each([
    ["unknown device", { data: null as unknown, error: null }],
    ["revoked device", { data: { state: "INACTIVE" }, error: null }],
  ])("401s %s", async (_name, response) => {
    grantScannerUse(true);
    sb.onTable("scanner_devices", response);

    const res = await scannerSessionRoute(
      get("/api/scanner/session", { "x-scanner-device-credential": "stolen-credential" })
    );
    expect(res.status).toBe(401);
    expectErrEnvelope(await json(res), "UNAUTHORIZED");
  });
});

const ADMIN_ID_LOCAL = "22222222-2222-4222-8222-222222222222";
