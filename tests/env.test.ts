import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emailProvider,
  razorpayConfigured,
  redisConfigured,
  resendConfigured,
  sesConfigured,
  supabaseConfigured,
} from "@/lib/env";

// The vitest config supplies test Supabase + Razorpay values and leaves
// Redis/Resend/SES unset, so these flags must reflect exactly that.

describe("environment contract (plan §6)", () => {
  it("detects configured providers from test env", () => {
    expect(supabaseConfigured()).toBe(true);
    expect(razorpayConfigured()).toBe(true);
    expect(redisConfigured()).toBe(false);
    expect(resendConfigured()).toBe(false);
    expect(sesConfigured()).toBe(false);
  });
});

describe("email provider switch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // env() caches per module instance, so each case loads a fresh copy.
  async function freshEnv(useSes: string | undefined) {
    vi.resetModules();
    vi.stubEnv("USE_SES", useSes);
    return import("@/lib/env");
  }

  it("defaults to Resend when USE_SES is unset", async () => {
    expect(emailProvider()).toBe("resend");
    expect((await freshEnv(undefined)).emailProvider()).toBe("resend");
  });

  it("uses Resend when USE_SES=false", async () => {
    expect((await freshEnv("false")).emailProvider()).toBe("resend");
  });

  it("uses Amazon SES when USE_SES=true", async () => {
    const mod = await freshEnv("true");
    expect(mod.emailProvider()).toBe("ses");
    expect(mod.emailConfigured()).toBe(false);
    vi.stubEnv("AWS_SES_REGION", "ap-south-1");
    vi.resetModules();
    expect((await import("@/lib/env")).emailConfigured()).toBe(true);
  });
});
