import "server-only";
import { env } from "./env";

/**
 * Cloudflare Turnstile verification (plan §11.9).
 *
 * Optional: when no secret is configured the check is skipped (local dev).
 * In staging/production the ask form should configure a site key.
 */
export async function verifyTurnstile(
  token: string | undefined,
  ip: string | null
): Promise<boolean> {
  const e = env();
  const secret = e.TURNSTILE_SECRET_KEY;
  // Not configured: when no secret is configured, skip verification.
  // When a secret is configured, require and verify the widget token.
  if (!secret) return true;
  if (!token) return false;

  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (ip) form.set("remoteip", ip);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // Verification unreachable: fail closed for spam-sensitive forms.
    return false;
  }
}
