/**
 * Client-side gate before browser→Supabase auth mutations (V-08).
 *
 * The server route (`/api/auth/guard`) enforces per-IP + per-email ceilings
 * and an optional Turnstile check before the dust settles on GoTrue. Fail
 * open on network errors: the application-layer bucket is best-effort and
 * Supabase still applies its own throttling.
 */
export async function authGuard(
  purpose:
    | "password_signin"
    | "password_signup"
    | "magic_link"
    | "forgot_password"
    | "reset_password"
    | "resend_confirmation"
    | "oauth_google",
  opts: { email?: string; turnstileToken?: string } = {}
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/auth/guard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose,
        email: opts.email?.trim() || undefined,
        turnstileToken: opts.turnstileToken,
      }),
      credentials: "same-origin",
    });
  } catch {
    return;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "Too many attempts. Please try again shortly.");
  }
}
