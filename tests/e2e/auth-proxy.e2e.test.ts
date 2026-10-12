import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { resetWorld } from "./helpers/mocks";
import { BASE_URL, get } from "./helpers/requests";

/**
 * Session state for the @supabase/ssr stub used by proxy().
 */
const ssrState: { user: unknown } = { user: null };

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: ssrState.user }, error: null }),
    },
  }),
}));

/** Exchange behavior for the auth callback route. */
const callbackState: { error: string | null } = { error: null };

vi.mock("@/lib/supabase/server", async () => ({
  createServerSupabase: async () => ({
    auth: {
      exchangeCodeForSession: async () =>
        callbackState.error ? { error: new Error(callbackState.error) } : { error: null },
    },
  }),
}));

import { proxy } from "@/proxy";
import { GET as authCallback } from "@/app/auth/callback/route";

// Baseline env as injected by vitest.config.ts `test.env`, captured at module
// scope. Restored after every test so per-test mutations (e.g. the "static
// site" test) never leak into later tests in this file.
const SAVED_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SAVED_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function restoreEnv(key: string, value: string | undefined): void {
  // Assigning `undefined` to process.env coerces it to the string "undefined"
  // in Node, which would poison env()-validated code in later tests. Delete
  // the key instead when the baseline value is unset.
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

beforeEach(() => {
  resetWorld({ actor: null });
  ssrState.user = null;
  callbackState.error = null;
});

afterEach(() => {
  restoreEnv("NEXT_PUBLIC_SUPABASE_URL", SAVED_URL);
  restoreEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", SAVED_KEY);
});

function withUser(user: unknown): void {
  ssrState.user = user;
}

describe("proxy — coarse route protection (plan §11.2)", () => {
  it("redirects anonymous /dashboard traffic to /login preserving the target", async () => {
    const req = get("/dashboard/orders");
    const res = await proxy(req as unknown as NextRequest);
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/dashboard/orders");
  });

  it("sends anonymous admin traffic to the admin login", async () => {
    const res = await proxy(get("/admin/events") as unknown as NextRequest);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/admin/login");
    expect(loc.searchParams.get("next")).toBe("/admin/events");
  });

  it("lets anonymous users browse public pages untouched", async () => {
    const res = await proxy(get("/events/hackathon") as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets anonymous users access login and admin login pages without redirect", async () => {
    const loginRes = await proxy(get("/login") as unknown as NextRequest);
    expect(loginRes.status).toBe(200);
    expect(loginRes.headers.get("location")).toBeNull();

    const adminLoginRes = await proxy(get("/admin/login") as unknown as NextRequest);
    expect(adminLoginRes.status).toBe(200);
    expect(adminLoginRes.headers.get("location")).toBeNull();

    const adminLoginWithNext = await proxy(get("/admin/login?next=/admin/events") as unknown as NextRequest);
    expect(adminLoginWithNext.status).toBe(200);
    expect(adminLoginWithNext.headers.get("location")).toBeNull();
  });

  it("bounces signed-in users away from both login pages", async () => {
    withUser({ id: "u-1" });

    const participant = await proxy(get("/login") as unknown as NextRequest);
    expect(new URL(participant.headers.get("location")!).pathname).toBe("/dashboard");

    const staff = await proxy(get("/admin/login") as unknown as NextRequest);
    expect(new URL(staff.headers.get("location")!).pathname).toBe("/admin");
  });

  it("keeps authenticated users on protected pages", async () => {
    withUser({ id: "u-1" });

    for (const path of ["/dashboard", "/admin", "/scanner"]) {
      const res = await proxy(get(path) as unknown as NextRequest);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("degrades to a static site when Supabase is not configured", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "";

    // Even a protected path passes straight through — pages render statically.
    const res = await proxy(get("/dashboard") as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("GET /auth/callback — open-redirect hardening (plan §11.3)", () => {
  it("bounces provider errors back to the login screen", async () => {
    const res = await authCallback(get("/auth/callback?error=access_denied"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(res.headers.get("location")).toContain("error=auth");
  });

  it("requires an exchange code", async () => {
    const res = await authCallback(get("/auth/callback"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("falls back to login when the code exchange fails", async () => {
    callbackState.error = "invalid grant";

    const res = await authCallback(get("/auth/callback?code=good&next=/dashboard"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("lands on allowlisted same-origin targets after a successful exchange", async () => {
    for (const next of [
      "/dashboard",
      "/admin/settings",
      "/scanner",
      "/complete-profile",
      "/events/hackathon",
      "/checkout/base-pass",
      "/reset-password",
    ]) {
      callbackState.error = null;
      const res = await authCallback(get(`/auth/callback?code=c&next=${encodeURIComponent(next)}`));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).toString()).toBe(`${BASE_URL}${next}`);
    }
  });

  it.each([
    ["absolute external url", "https://evil.example/phish"],
    ["protocol-relative url", "//evil.example"],
    ["backslash trick", "/\\evil"],
    ["newline smuggling", "/dashboard%0aSet-Cookie:x"],
    ["non-allowlisted path", "/totally-unrelated"],
    ["prefix lookalike", "/dashboardX"],
  ] as const)("rewrites unsafe next=%s to the dashboard fallback", async (_name, next) => {
    callbackState.error = null;
    const res = await authCallback(
      get(`/auth/callback?code=c&next=${encodeURIComponent(next)}`)
    );
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).toString()).toBe(`${BASE_URL}/dashboard`);
  });

  it("defaults to the dashboard when next is absent", async () => {
    callbackState.error = null;
    const res = await authCallback(get("/auth/callback?code=c"));
    expect(new URL(res.headers.get("location")!).toString()).toBe(`${BASE_URL}/dashboard`);
  });
});
