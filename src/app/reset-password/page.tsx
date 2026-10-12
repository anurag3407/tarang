import type { Metadata } from "next";
import { Suspense } from "react";
import ResetPasswordForm from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set New Password | TARANG 2026",
  description: "Set a new password for your TARANG 2026 account.",
  robots: { index: false },
};

function ResetPasswordSkeleton() {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="border-8 border-black bg-white p-6 shadow-neo-lg sm:p-8">
        <h1 className="text-3xl font-black uppercase tracking-tighter">Set New Password</h1>
        <p className="mt-2 text-sm font-bold text-black/70">
          Enter and confirm your new account password below.
        </p>
        <div className="mt-6 h-48 animate-pulse bg-neo-muted/50 border-4 border-black" />
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordSkeleton />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
