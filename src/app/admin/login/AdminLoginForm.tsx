"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";
import { authGuard } from "@/lib/auth-guard-client";

function formatAuthError(raw: string): string {
  if (!raw) return "Authentication failed. Please try again.";
  const lower = raw.toLowerCase();
  if (
    lower.includes("pkce") ||
    lower.includes("code verifier") ||
    lower.includes("both the server and client") ||
    lower.includes("different browser")
  ) {
    return "This sign-in link was opened in a different browser. Please sign in with your email and password below.";
  }
  if (lower.includes("invalid login credentials") || lower.includes("invalid_credentials")) {
    return "Incorrect email or password. Please double-check your credentials.";
  }
  if (lower.includes("email not confirmed")) {
    return "Please confirm your email before signing in. Check your inbox and spam folder.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (lower.includes("expired") || lower.includes("otp_expired")) {
    return "This sign-in link has expired. Please request a new one below.";
  }
  return raw;
}

function safeRedirectTarget(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.includes("\\") || raw.includes("\n") || raw.includes("\r")) return fallback;
  return raw;
}

/**
 * Admin login (plan §11.3): same Supabase identity as participants, then the
 * server checks for an active staff assignment in src/app/admin/layout.tsx.
 */
function AdminLoginForm() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"password" | "magic_link" | "forgot_password">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const errorParam = searchParams.get("error");
    const msgParam = searchParams.get("message") || searchParams.get("error_description");
    if (errorParam || msgParam) {
      setStatus("error");
      setMessage(formatAuthError(msgParam || "Authentication failed. Please try again."));
    } else if (typeof window !== "undefined" && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const hashError = hashParams.get("error_description") || hashParams.get("error");
      if (hashError) {
        setStatus("error");
        setMessage(formatAuthError(decodeURIComponent(hashError.replace(/\+/g, " "))));
      }
    }
  }, [searchParams]);

  const next = safeRedirectTarget(searchParams.get("next"), "/admin");

  /** App-layer throttle/bot gate before each browser→Supabase auth call (V-08). */
  async function guarded(
    purpose: Parameters<typeof authGuard>[0],
    email = ""
  ): Promise<boolean> {
    try {
      await authGuard(purpose, { email });
      return true;
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not submit. Please try again.");
      return false;
    }
  }

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    if (!(await guarded("password_signin", email))) return;
    setStatus("loading");
    setMessage("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      if (data.session) {
        setStatus("success");
        setMessage("Signed in! Redirecting to Control Room…");
        window.location.href = next;
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? formatAuthError(err.message) : "Incorrect email or password");
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    if (!(await guarded("magic_link", email))) return;
    setStatus("loading");
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw error;
      setStatus("sent");
      setMessage("Check your inbox for the sign-in link.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? formatAuthError(err.message) : "Could not send sign-in link");
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    if (!(await guarded("forgot_password", email))) return;
    setStatus("loading");
    setMessage("");
    try {
      const supabase = createClient();
      const resetNext =
        next && next !== "/admin"
          ? `/reset-password?next=${encodeURIComponent(next)}`
          : "/reset-password?next=/admin";
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(resetNext)}`,
      });
      if (error) throw error;
      setStatus("sent");
      setMessage("Password reset instructions sent to your email. Check your inbox and spam folder.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? formatAuthError(err.message) : "Could not send password reset email");
    }
  }

  async function handleGoogle() {
    if (!(await guarded("oauth_google"))) return;
    setStatus("loading");
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Sign-in failed");
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="border-8 border-black bg-neo-muted dark:bg-neo-card text-black dark:text-white p-6 shadow-neo-lg sm:p-8">
        <div className="flex items-center justify-between">
          <span className="border-2 border-black bg-black px-2 py-0.5 text-xs font-black uppercase tracking-wider text-white">
            Staff Portal
          </span>
          <Link href="/" className="text-xs font-black uppercase underline">
            ← Fest Home
          </Link>
        </div>

        <h1 className="mt-4 text-3xl font-black uppercase tracking-tighter">
          {tab === "forgot_password" ? "Staff Password Reset" : "Staff Sign In"}
        </h1>
        <p className="mt-2 text-sm font-bold text-black/70 dark:text-white/70">
          {tab === "forgot_password"
            ? "Enter your staff email address to receive password reset instructions."
            : "Organizing committee and fest crew access. Your account must have an active staff assignment."}
        </p>

        {/* Tab Switcher */}
        {tab !== "forgot_password" && (
          <div className="mt-6 flex border-4 border-black bg-white dark:bg-neo-surface p-1 shadow-neo-xs">
            <button
              type="button"
              onClick={() => {
                setTab("password");
                setMessage("");
                setStatus("idle");
              }}
              className={`flex-1 py-1.5 text-xs font-black uppercase tracking-wider transition-colors ${
                tab === "password"
                  ? "border-2 border-black bg-neo-secondary text-black shadow-neo-xs"
                  : "text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white"
              }`}
            >
              Password
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("magic_link");
                setMessage("");
                setStatus("idle");
              }}
              className={`flex-1 py-1.5 text-xs font-black uppercase tracking-wider transition-colors ${
                tab === "magic_link"
                  ? "border-2 border-black bg-neo-secondary text-black shadow-neo-xs"
                  : "text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white"
              }`}
            >
              Magic Link
            </button>
          </div>
        )}

        <div className="mt-6 space-y-4">
          {tab !== "forgot_password" && (
            <>
              <Button variant="dark" className="w-full" onClick={handleGoogle} disabled={status === "loading"}>
                Continue with Google
              </Button>

              <div className="flex items-center gap-3">
                <div className="h-1 flex-1 bg-black dark:bg-white/20" />
                <span className="text-xs font-black uppercase">or with staff credentials</span>
                <div className="h-1 flex-1 bg-black dark:bg-white/20" />
              </div>
            </>
          )}

          {/* 1. Password Sign In Form */}
          {tab === "password" && (
            <form onSubmit={handlePasswordSignIn} className="space-y-4">
              <label className="block text-xs font-black uppercase tracking-widest">
                Staff Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white px-3 py-2 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
                  placeholder="you@college.edu"
                />
              </label>

              <label className="block text-xs font-black uppercase tracking-widest">
                <div className="flex items-center justify-between">
                  <span>Password</span>
                  <button
                    type="button"
                    onClick={() => {
                      setTab("forgot_password");
                      setMessage("");
                      setStatus("idle");
                    }}
                    className="text-[11px] font-black uppercase underline hover:text-neo-accent"
                  >
                    Forgot?
                  </button>
                </div>
                <div className="relative mt-1">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white px-3 py-2 pr-10 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </label>

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={status === "loading" || !email || !password}
              >
                {status === "loading" ? "Signing In…" : "Sign In to Admin Portal"}
              </Button>
            </form>
          )}

          {/* 2. Magic Link Form */}
          {tab === "magic_link" && (
            <form onSubmit={handleMagicLink} className="space-y-4">
              <label className="block text-xs font-black uppercase tracking-widest">
                Staff Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white px-3 py-2 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
                  placeholder="you@college.edu"
                />
              </label>
              <Button type="submit" variant="secondary" className="w-full" disabled={status === "loading" || !email}>
                {status === "loading" ? "Sending Link…" : "Email me a sign-in link"}
              </Button>
            </form>
          )}

          {/* 3. Forgot Password Form */}
          {tab === "forgot_password" && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <label className="block text-xs font-black uppercase tracking-widest">
                Staff Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white px-3 py-2 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
                  placeholder="you@college.edu"
                />
              </label>
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={status === "loading" || !email}
              >
                {status === "loading" ? "Sending…" : "Send Reset Link"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setTab("password");
                  setMessage("");
                  setStatus("idle");
                }}
                className="block w-full text-center text-xs font-black uppercase underline"
              >
                ← Back to Staff Sign In
              </button>
            </form>
          )}

          {message && (
            <div
              className={`border-4 border-black p-3 text-sm font-bold ${
                status === "error"
                  ? "bg-neo-accent text-black"
                  : status === "success" || status === "sent"
                  ? "bg-neo-secondary text-black"
                  : "bg-white text-black"
              }`}
              role="status"
            >
              {message}
            </div>
          )}
        </div>
      </div>

      {/* Participant Switcher */}
      <div className="mt-6 border-4 border-black bg-white p-5 text-center shadow-neo-sm">
        <p className="text-sm font-black uppercase tracking-wider text-black">
          Are you a fest participant or attendee?
        </p>
        <p className="mt-1 text-xs font-bold text-black/70">
          Sign in to purchase base passes, view your QR ticket, or manage event registrations.
        </p>
        <Link
          href="/login"
          className="mt-3 inline-block border-2 border-black bg-neo-secondary px-4 py-2 text-xs font-black uppercase tracking-widest text-black shadow-neo-sm transition-transform hover:-translate-y-0.5"
        >
          Delegate Sign In →
        </Link>
      </div>
    </div>
  );
}

export default function AdminLoginFormWrapper() {
  return (
    <Suspense>
      <AdminLoginForm />
    </Suspense>
  );
}
