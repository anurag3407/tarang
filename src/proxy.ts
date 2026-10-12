import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy (Next 16 rename of middleware) — Supabase session refresh +
 * coarse route protection (plan §11.2, §11.3).
 *
 * Runs on the edge runtime, so it reads process.env directly (never the
 * server-only env module) and performs no DB writes. Fine-grained
 * authorization (roles/permissions) is enforced in Route Handlers and
 * server components, not here — a valid session cookie is not proof of a
 * still-active staff assignment.
 */

const PROTECTED_PARTICIPANT = ["/dashboard"];
const PROTECTED_ADMIN = ["/admin"];
const PROTECTED_SCANNER = ["/scanner"];

function isProtected(pathname: string, prefixes: string[]): boolean {
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/") || pathname === "/login" || pathname.startsWith("/login/")) {
    return false;
  }
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

function getOrigin(req: NextRequest): string {
  // Never trust x-forwarded-host: nginx forwards the client-supplied header
  // unchanged, which would let an attacker point login redirects at their
  // own origin. The Host header is set by nginx from the real request.
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
  return process.env.APP_BASE_URL || (host ? `${proto}://${host}` : "https://pulseasa.org");
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Without Supabase configured, skip auth handling entirely (static site).
  if (!url || !anonKey) {
    return supabaseResponse;
  }

  const { pathname } = request.nextUrl;
  const origin = getOrigin(request);

  const needsAuth =
    isProtected(pathname, PROTECTED_PARTICIPANT) ||
    isProtected(pathname, PROTECTED_ADMIN) ||
    isProtected(pathname, PROTECTED_SCANNER);

  const isLoginPage = pathname === "/login" || pathname === "/admin/login";
  const hasAuthCookie = request.cookies
    .getAll()
    .some(
      (c) =>
        c.name.startsWith("sb-") ||
        c.name.includes("supabase") ||
        c.name.includes("auth")
    );

  // Fast-path: bypass remote Supabase Auth network calls for unauthenticated public pages
  if (!needsAuth && !isLoginPage && !hasAuthCookie) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refreshes the session token if expired. Do NOT remove this — it keeps
  // server-rendered pages and Route Handlers authenticated.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (needsAuth && !user) {
    const loginPath = isProtected(pathname, PROTECTED_ADMIN)
      ? "/admin/login"
      : "/login";
    const redirectUrl = new URL(loginPath, origin);
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Signed-in users hitting /login go to their dashboard.
  if (user && (pathname === "/login" || pathname === "/admin/login")) {
    const target = pathname === "/admin/login" ? "/admin" : "/dashboard";
    return NextResponse.redirect(new URL(target, origin));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Run on all pages except static assets and API routes (API routes do
     * their own auth; webhooks must never be intercepted here).
     */
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
