import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/redis/rate-limits";
import { getClientIp, hashIdentifier } from "@/lib/request-context";

/**
 * GET /auth/callback — exchange the OAuth/magic-link code or token_hash for a session
 * (plan §11.3). Redirects only to allowlisted same-origin paths; an invalid
 * or external `next` falls back to the dashboard.
 */

const ALLOWED_PREFIXES = [
  "/dashboard",
  "/admin",
  "/scanner",
  "/complete-profile",
  "/events",
  "/checkout",
  "/pronite-pass",
  "/reset-password",
];

function safeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  // Must be a same-origin relative path, no protocol/authority.
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  if (raw.includes("\\") || raw.includes("\n")) return "/dashboard";
  const ok = ALLOWED_PREFIXES.some(
    (p) => raw === p || raw.startsWith(`${p}/`) || raw.startsWith(`${p}?`)
  );
  return ok ? raw : "/dashboard";
}

function getOrigin(req: NextRequest): string {
  // Never trust x-forwarded-host (client-spoofable through nginx) — the
  // Host header is authoritative.
  const host = req.headers.get("host");
  const isLocal = Boolean(
    host &&
      (host.includes("localhost") ||
        host.startsWith("127.0.0.1") ||
        host.startsWith("0.0.0.0"))
  );
  const proto = req.headers.get("x-forwarded-proto") || (isLocal ? "http" : "https");
  if (host && !host.startsWith("0.0.0.0") && !host.startsWith("127.0.0.1")) {
    return `${proto}://${host}`;
  }
  try {
    const reqUrl = new URL(req.url);
    if (reqUrl.host && !reqUrl.host.startsWith("0.0.0.0") && !reqUrl.host.startsWith("127.0.0.1")) {
      return reqUrl.origin;
    }
  } catch {
    // ignore
  }
  return process.env.APP_BASE_URL || (host ? `${proto}://${host}` : "http://localhost:3000");
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = getOrigin(req);

  // Per-IP ceiling on token/code exchanges (V-08). Fails open when Redis is
  // unavailable so a Redis blip never blocks legitimate sign-ins.
  const limiter = await checkRateLimit(
    "auth",
    `ip:${hashIdentifier(getClientIp(req))}`
  );
  if (!limiter.success) {
    return NextResponse.redirect(
      new URL(
        "/login?error=auth&message=Too+many+sign-in+attempts+—+please+retry+later",
        origin
      )
    );
  }

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const errorParam = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  const next = safeNext(url.searchParams.get("next"));

  if (errorParam) {
    // Never reflect provider-supplied error text into the login page (V-12f):
    // `error`/`error_description` are attacker-controllable and would render
    // verbatim in LoginForm, enabling spoofed guidance. Log the raw values
    // server-side and show a fixed message instead.
    logger().warn(
      {
        providerError: (errorParam || "").slice(0, 200),
        providerDescription: (errorDescription || "").slice(0, 500),
      },
      "auth callback rejected by provider"
    );
    const message =
      errorParam === "access_denied"
        ? "Sign-in was cancelled. Please try again."
        : "Authentication failed. Please try again.";
    const desc = encodeURIComponent(message);
    return NextResponse.redirect(new URL(`/login?error=auth&message=${desc}`, origin));
  }

  // Token hash flow (email verification without PKCE cookie dependency)
  if (tokenHash && type) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
    const desc = encodeURIComponent(error.message || "Failed to verify email token");
    return NextResponse.redirect(new URL(`/login?error=auth&message=${desc}`, origin));
  }

  // Authorization code exchange flow (OAuth & PKCE magic link / email confirmation)
  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // If PKCE cookie wasn't found (user clicked email in a different browser/device/mail app),
      // the email has already been verified on Supabase backend. Prompt them to sign in.
      if (
        error.message.includes("PKCE") ||
        error.message.includes("code verifier") ||
        error.message.includes("both the server and client")
      ) {
        if (next.startsWith("/reset-password")) {
          const msg = encodeURIComponent(
            "This reset link was opened in a different browser or has expired. Please request a password reset link directly from this browser."
          );
          return NextResponse.redirect(new URL(`/login?error=auth&message=${msg}`, origin));
        }
        const msg = encodeURIComponent(
          "Email confirmed successfully! Please sign in with your email and password below."
        );
        return NextResponse.redirect(new URL(`/login?message=${msg}`, origin));
      }
      const desc = encodeURIComponent(error.message || "Failed to exchange authorization code");
      return NextResponse.redirect(new URL(`/login?error=auth&message=${desc}`, origin));
    }
    return NextResponse.redirect(new URL(next, origin));
  }

  return NextResponse.redirect(new URL("/login?error=auth&message=No+authorization+code+found", origin));
}
