"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";
import { authGuard } from "@/lib/auth-guard-client";

type AuthMode = "password_signin" | "password_signup" | "magic_link" | "forgot_password";

function formatAuthError(raw: string): string {
  if (!raw) return "Authentication failed. Please try again.";
  const lower = raw.toLowerCase();
  if (
    lower.includes("pkce") ||
    lower.includes("code verifier") ||
    lower.includes("both the server and client") ||
    lower.includes("different browser")
  ) {
    return "This sign-in link was opened in a different browser. If you just registered, your email is confirmed — please sign in with your email and password below.";
  }
  if (lower.includes("invalid login credentials") || lower.includes("invalid_credentials")) {
    return "Incorrect email or password. Please double-check your credentials.";
  }
  if (lower.includes("email not confirmed")) {
    return "Please confirm your email before signing in. Check your inbox and spam folder for the confirmation link.";
  }
  if (lower.includes("user already registered") || lower.includes("already exists")) {
    return "An account with this email already exists. Please sign in below or reset your password.";
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

export default function LoginForm({ adminMode = false }: { adminMode?: boolean }) {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("password_signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
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
    } catch {
      // ignore
    }
  }, [searchParams]);

  const fallbackNext = adminMode ? "/admin" : "/dashboard";
  const next = safeRedirectTarget(searchParams.get("next"), fallbackNext);

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
        setMessage("Signed in successfully! Redirecting…");
        // Force full redirect so server components and session cookies align immediately
        window.location.href = next;
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? formatAuthError(err.message) : "Incorrect email or password");
    }
  }

  async function handlePasswordSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    if (!(await guarded("password_signup", email))) return;
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
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: name.trim() || email.split("@")[0],
          },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw error;

      if (data.session) {
        setStatus("success");
        setMessage("Account created! Redirecting…");
        window.location.href = next;
      } else {
        setStatus("sent");
        setMessage(
          "Account created! Please check your email inbox to confirm your account, then sign in."
        );
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? formatAuthError(err.message) : "Could not create account");
    }
  }

  async function handleResendConfirmation() {
    if (!email) {
      setMessage("Please enter your email address above.");
      setStatus("error");
      return;
    }
    if (!(await guarded("resend_confirmation", email))) return;
    setStatus("loading");
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw error;
      setStatus("sent");
      setMessage("Confirmation email sent! Please check your inbox and spam folder.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? formatAuthError(err.message) : "Could not resend confirmation email");
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
        next && next !== "/dashboard"
          ? `/reset-password?next=${encodeURIComponent(next)}`
          : "/reset-password";
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

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="border-8 border-black bg-white p-6 shadow-neo-lg sm:p-8">
        <h1 className="text-3xl font-black uppercase tracking-tighter">
          {adminMode
            ? "Staff Sign In"
            : mode === "password_signup"
            ? "Create Account"
            : mode === "forgot_password"
            ? "Reset Password"
            : "Sign In"}
        </h1>
        <p className="mt-2 text-sm font-bold text-black/70">
          {adminMode
            ? "Organizing committee access. Requires an active staff assignment."
            : mode === "password_signup"
            ? "Register to purchase passes, enter competitions and get your gate ticket."
            : mode === "forgot_password"
            ? "Enter your registered email address to receive password reset instructions."
            : "Sign in to buy your delegate pass and register for events."}
        </p>

        {/* Mode Selector Tabs */}
        {!adminMode && mode !== "forgot_password" && (
          <div className="mt-6 flex border-4 border-black bg-neo-cream dark:bg-neo-surface p-1 shadow-neo-xs">
            <button
              type="button"
              onClick={() => {
                setMode("password_signin");
                setMessage("");
                setStatus("idle");
              }}
              className={`flex-1 py-2 text-xs font-black uppercase tracking-wider transition-colors ${
                mode === "password_signin"
                  ? "border-2 border-black bg-neo-secondary text-black shadow-neo-xs"
                  : "text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("password_signup");
                setMessage("");
                setStatus("idle");
              }}
              className={`flex-1 py-2 text-xs font-black uppercase tracking-wider transition-colors ${
                mode === "password_signup"
                  ? "border-2 border-black bg-neo-secondary text-black shadow-neo-xs"
                  : "text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white"
              }`}
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("magic_link");
                setMessage("");
                setStatus("idle");
              }}
              className={`flex-1 py-2 text-xs font-black uppercase tracking-wider transition-colors ${
                mode === "magic_link"
                  ? "border-2 border-black bg-neo-secondary text-black shadow-neo-xs"
                  : "text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white"
              }`}
            >
              Magic Link
            </button>
          </div>
        )}

        <div className="mt-6 space-y-4">
          {/* Google OAuth (Available on main sign-in and sign-up) */}
          {mode !== "forgot_password" && (
            <>
              <Button
                variant="dark"
                className="w-full"
                onClick={handleGoogle}
                disabled={status === "loading"}
              >
                Continue with Google
              </Button>

              <div className="flex items-center gap-3">
                <div className="h-1 flex-1 bg-black dark:bg-white/20" />
                <span className="text-xs font-black uppercase">or with email</span>
                <div className="h-1 flex-1 bg-black dark:bg-white/20" />
              </div>
            </>
          )}

          {/* 1. Password Sign In Form */}
          {mode === "password_signin" && (
            <form onSubmit={handlePasswordSignIn} className="space-y-4">
              <label className="block text-xs font-black uppercase tracking-widest">
                Email
                <div className="relative mt-1">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border-4 border-black bg-neo-cream px-3 py-2 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black"
                    placeholder="you@college.edu"
                  />
                </div>
              </label>

              <label className="block text-xs font-black uppercase tracking-widest">
                <div className="flex items-center justify-between">
                  <span>Password</span>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("forgot_password");
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
                    className="w-full border-4 border-black bg-neo-cream px-3 py-2 pr-10 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-black/60 hover:text-black"
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
                {status === "loading" ? "Signing In…" : "Sign In with Password"}
              </Button>
            </form>
          )}

          {/* 2. Password Sign Up Form */}
          {mode === "password_signup" && (
            <form onSubmit={handlePasswordSignUp} className="space-y-4">
              <label className="block text-xs font-black uppercase tracking-widest">
                Full Name
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full border-4 border-black bg-neo-cream px-3 py-2 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black"
                  placeholder="e.g. Rohan Sharma"
                />
              </label>

              <label className="block text-xs font-black uppercase tracking-widest">
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full border-4 border-black bg-neo-cream px-3 py-2 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black"
                  placeholder="you@college.edu"
                />
              </label>

              <label className="block text-xs font-black uppercase tracking-widest">
                Create Password (min 6 chars)
                <div className="relative mt-1">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border-4 border-black bg-neo-cream px-3 py-2 pr-10 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-black/60 hover:text-black"
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

              <label className="block text-xs font-black uppercase tracking-widest">
                Confirm Password
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1 w-full border-4 border-black bg-neo-cream px-3 py-2 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black"
                  placeholder="••••••••"
                />
              </label>

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={status === "loading" || !email || !password || !confirmPassword}
              >
                {status === "loading" ? "Creating Account…" : "Create My Account"}
              </Button>
            </form>
          )}

          {/* 3. Magic Link Form */}
          {mode === "magic_link" && (
            <form onSubmit={handleMagicLink} className="space-y-4">
              <label className="block text-xs font-black uppercase tracking-widest">
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full border-4 border-black bg-neo-cream px-3 py-2 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black"
                  placeholder="you@college.edu"
                />
              </label>
              <Button
                type="submit"
                variant="secondary"
                className="w-full"
                disabled={status === "loading" || !email}
              >
                {status === "loading" ? "Sending Link…" : "Email me a sign-in link"}
              </Button>
            </form>
          )}

          {/* 4. Forgot Password Form */}
          {mode === "forgot_password" && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <label className="block text-xs font-black uppercase tracking-widest">
                Enter your account email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full border-4 border-black bg-neo-cream px-3 py-2 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black"
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
                  setMode("password_signin");
                  setMessage("");
                  setStatus("idle");
                }}
                className="block w-full text-center text-xs font-black uppercase underline"
              >
                ← Back to Sign In
              </button>
            </form>
          )}

          {/* Alert Message Box */}
          {message && (
            <div
              className={`border-4 border-black p-3 text-sm font-bold ${
                status === "error"
                  ? "bg-neo-accent text-black"
                  : status === "success" || status === "sent"
                  ? "bg-neo-secondary text-black"
                  : "bg-neo-muted text-black"
              }`}
              role="status"
            >
              <p>{message}</p>
              {(status === "sent" || message.toLowerCase().includes("confirm")) && (
                <button
                  type="button"
                  onClick={handleResendConfirmation}
                  className="mt-2 block text-xs font-black uppercase underline hover:opacity-80"
                >
                  Didn&apos;t get the email? Click to resend verification
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Staff / Admin Portal Switcher */}
      <div className="mt-6 border-4 border-black bg-neo-muted dark:bg-neo-card text-black dark:text-white p-5 text-center shadow-neo-sm">
        <p className="text-sm font-black uppercase tracking-wider text-black dark:text-white">
          Organizing Committee or Fest Crew?
        </p>
        <p className="mt-1 text-xs font-bold text-black/70 dark:text-white/70">
          Access the control room, event manager, schedule &amp; gate scanner.
        </p>
        <Link
          href="/admin/login"
          className="mt-3 inline-block border-2 border-black bg-black px-4 py-2 text-xs font-black uppercase tracking-widest text-white shadow-neo-sm transition-transform hover:-translate-y-0.5"
        >
          Staff &amp; Admin Sign In →
        </Link>
      </div>
    </div>
  );
}
