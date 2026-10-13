import { beforeEach, describe, expect, it } from "vitest";
import { resetWorld } from "./helpers/mocks";
import { post } from "./helpers/requests";
import { POST as authGuard } from "@/app/api/auth/guard/route";

/**
 * POST /api/auth/guard (V-08) — app-layer throttle/bot gate in front of the
 * browser→Supabase auth mutations. No Redis in tests, so the Upstash bucket
 * fails open and the route exercises schema/CSRF/Turnstile handling.
 */
describe("POST /api/auth/guard (V-08)", () => {
  beforeEach(() => {
    resetWorld({ actor: null });
  });

  it("accepts a valid pre-auth gate request", async () => {
    const res = await authGuard(
      post("/api/auth/guard", {
        body: { purpose: "password_signin", email: "Member@Tarang.Example" },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { ok: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data?.ok).toBe(true);
  });

  it("accepts password reset and recovery gate requests", async () => {
    const forgotRes = await authGuard(
      post("/api/auth/guard", {
        body: { purpose: "forgot_password", email: "user@example.com" },
      })
    );
    expect(forgotRes.status).toBe(200);

    const resetRes = await authGuard(
      post("/api/auth/guard", {
        body: { purpose: "reset_password", email: "user@example.com" },
      })
    );
    expect(resetRes.status).toBe(200);
  });

  it("accepts email-less purposes (OAuth start)", async () => {
    const res = await authGuard(
      post("/api/auth/guard", { body: { purpose: "oauth_google" } })
    );
    expect(res.status).toBe(200);
  });

  it("rejects unknown purposes", async () => {
    const res = await authGuard(
      post("/api/auth/guard", { body: { purpose: "smoke_secret" } })
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("rejects malformed emails", async () => {
    const res = await authGuard(
      post("/api/auth/guard", {
        body: { purpose: "magic_link", email: "not-an-email" },
      })
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("rejects cross-origin submissions via the CSRF origin check", async () => {
    const res = await authGuard(
      post("/api/auth/guard", {
        body: { purpose: "password_signin" },
        origin: "https://evil.example",
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("BAD_REQUEST");
  });
});
