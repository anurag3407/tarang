"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff, CheckCircle2, AlertTriangle, KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";
import { authGuard } from "@/lib/auth-guard-client";

function safeRedirectTarget(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.includes("\\") || raw.includes("\n") || raw.includes("\r")) return fallback;
  return raw;
}

function formatAuthError(raw: string): string {
  if (!raw) return "Could not update password. Please try again.";
  const lower = raw.toLowerCase();
  if (
    lower.includes("pkce") ||
    lower.includes("code verifier") ||
    lower.includes("both the server and client") ||
    lower.includes("different browser")
  ) {
    return "This reset link was opened in a different browser or has expired. Please request a new password reset link below.";
  }
  if (lower.includes("expired") || lower.includes("otp_expired") || lower.includes("token is expired")) {
    return "This password reset link has expired. Please request a new one below.";
  }
  if (lower.includes("session") || lower.includes("not authenticated") || lower.includes("unauthorized") || lower.includes("jwt")) {
    return "Your password reset session has expired. Please request a new reset link.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (lower.includes("same password") || lower.includes("new password should be different")) {
    return "New password must be different from your old password.";
  }
  if (lower.includes("at least 6 characters") || lower.includes("password should be at least")) {
    return "Password must be at least 6 characters long.";
  }
  return raw;
}

export default function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const next = safeRedirectTarget(searchParams.get("next"), "/dashboard");

  useEffect(() => {
    try {
      const errorParam = searchParams.get("error");
      const msgParam = searchParams.get("message") || searchParams.get("error_description");
      if (errorParam || msgParam) {
        setStatus("error");
        setMessage(formatAuthError(msgParam || "Password reset verification failed."));
      } else if (typeof window !== "undefined" && window.location.hash) {
        const hashParams = new URLSearchParams(window.location.hash.slice(1));
        const hashError = hashParams.get("error_description") || hashParams.get("error");
        if (hashError) {
          setStatus("error");
          setMessage(formatAuthError(decodeURIComponent(hashError.replace(/\+/g, " "))));
        }
      }
    } catch {
      // ignore URL parsing glitches
    }
  }, [searchParams]);

  useEffect(() => {
    let mounted = true;
    try {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data: { user }, error }) => {
        if (!mounted) return;
        if (user && !error) {
          setHasSession(true);
          setUserEmail(user.email ?? null);
        }
        setCheckingSession(false);
      });

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, session) => {
        if (!mounted) return;
        if (event === "PASSWORD_RECOVERY" || session?.user) {
          setHasSession(true);
          setUserEmail(session?.user?.email ?? null);
          setCheckingSession(false);
        }
      });

      return () => {
        mounted = false;
        subscription.unsubscribe();
      };
    } catch {
      if (mounted) setCheckingSession(false);
    }
  }, []);

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!password || !confirmPassword) return;

    if (password.length < 6) {
      setStatus("error");
      setMessage("Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }

    setStatus("loading");
    setMessage("");

    try {
      await authGuard("reset_password", { email: userEmail || undefined });
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) throw error;

      setStatus("success");
      setMessage("Password updated successfully! Redirecting you now…");

      // Redirect after brief pause
      setTimeout(() => {
        window.location.href = next;
      }, 1200);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? formatAuthError(err.message) : "Failed to update password.");
    }
  }

  async function handleBackToLogin() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    window.location.href = "/login";
  }

  if (checkingSession) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="border-8 border-black bg-white dark:bg-neo-card text-black dark:text-white p-8 shadow-neo-lg">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-black dark:border-white border-t-transparent dark:border-t-transparent" />
          <p className="text-sm font-black uppercase tracking-wider">
            Verifying security session…
          </p>
        </div>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="border-8 border-black bg-white dark:bg-neo-card text-black dark:text-white p-6 shadow-neo-lg sm:p-8">
          <div className="mb-4 inline-flex items-center gap-2 border-2 border-black bg-neo-accent px-2.5 py-1 text-xs font-black uppercase text-black shadow-neo-xs">
            <AlertTriangle className="h-4 w-4" />
            Session Required
          </div>

          <h1 className="text-3xl font-black uppercase tracking-tighter">
            Reset Password
          </h1>

          <p className="mt-3 text-sm font-bold text-black/70 dark:text-white/70">
            No active password recovery session was found, or your reset link has expired.
          </p>

          {message && (
            <div className="mt-4 border-4 border-black bg-neo-accent p-3 text-sm font-bold text-black">
              {message}
            </div>
          )}

          <div className="mt-6 space-y-3">
            <Link
              href="/login"
              className="block w-full border-4 border-black bg-neo-secondary py-3 text-center text-sm font-black uppercase tracking-wider text-black shadow-neo-sm transition-transform hover:-translate-y-0.5"
            >
              Request New Reset Link →
            </Link>
            <Link
              href="/admin/login"
              className="block w-full border-2 border-black bg-neo-muted dark:bg-neo-card py-2 text-center text-xs font-black uppercase tracking-wider text-black dark:text-white transition-colors hover:bg-black hover:text-white"
            >
              Staff &amp; Admin Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="border-8 border-black bg-white dark:bg-neo-card text-black dark:text-white p-6 shadow-neo-lg sm:p-8">
        <div className="mb-3 inline-flex items-center gap-2 border-2 border-black bg-neo-secondary px-2.5 py-1 text-xs font-black uppercase text-black shadow-neo-xs">
          <KeyRound className="h-4 w-4" />
          Secure Credential Update
        </div>

        <h1 className="text-3xl font-black uppercase tracking-tighter">
          Set New Password
        </h1>

        <p className="mt-2 text-sm font-bold text-black/70 dark:text-white/70">
          {userEmail ? (
            <>
              Updating password for <span className="font-mono text-black dark:text-neo-secondary font-black">{userEmail}</span>.
            </>
          ) : (
            "Enter and confirm your new account password below."
          )}
        </p>

        <form onSubmit={handleResetPassword} className="mt-6 space-y-4">
          <label className="block text-xs font-black uppercase tracking-widest">
            New Password (min 6 chars)
            <div className="relative mt-1">
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={status === "loading" || status === "success"}
                className="w-full border-4 border-black bg-neo-cream dark:bg-neo-surface text-black dark:text-white px-3 py-2 pr-10 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </label>

          <label className="block text-xs font-black uppercase tracking-widest">
            Confirm New Password
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={status === "loading" || status === "success"}
              className="mt-1 w-full border-4 border-black bg-neo-cream dark:bg-neo-surface text-black dark:text-white px-3 py-2 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
              placeholder="••••••••"
            />
          </label>

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={status === "loading" || status === "success" || !password || !confirmPassword}
          >
            {status === "loading" ? "Updating Password…" : "Update Password"}
          </Button>
        </form>

        {message && (
          <div
            className={`mt-4 border-4 border-black p-3 text-sm font-bold flex items-start gap-2 ${
              status === "error"
                ? "bg-neo-accent text-black"
                : status === "success"
                ? "bg-neo-secondary text-black"
                : "bg-neo-muted text-black"
            }`}
            role="status"
          >
            {status === "success" && <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />}
            {status === "error" && <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />}
            <p className="flex-1">{message}</p>
          </div>
        )}

        <div className="mt-6 border-t-2 border-black/20 pt-4 text-center">
          <button
            type="button"
            onClick={handleBackToLogin}
            className="text-xs font-black uppercase underline hover:text-neo-accent text-black dark:text-white cursor-pointer"
          >
            ← Back to Sign In
          </button>
        </div>
      </div>
    </div>
  );
}
