import { describe, expect, it } from "vitest";
import {
  razorpayConfigured,
  redisConfigured,
  resendConfigured,
  supabaseConfigured,
} from "@/lib/env";

// The vitest config supplies test Supabase + Razorpay values and leaves
// Redis/Resend unset, so these flags must reflect exactly that.

describe("environment contract (plan §6)", () => {
  it("detects configured providers from test env", () => {
    expect(supabaseConfigured()).toBe(true);
    expect(razorpayConfigured()).toBe(true);
    expect(redisConfigured()).toBe(false);
    expect(resendConfigured()).toBe(false);
  });
});
