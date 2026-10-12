import type { Metadata } from "next";
import { AuthStage } from "@/components/ui/AuthStage";
import { Suspense } from "react";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign In & Register | TARANG 2026",
  description:
    "Sign in or register to buy your delegate pass, register for events, and get your gate ticket.",
};

function LoginFormSkeleton() {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="border-8 border-black bg-white p-6 shadow-neo-lg sm:p-8">
        <h1 className="text-3xl font-black uppercase tracking-tighter">Sign In</h1>
        <p className="mt-2 text-sm font-bold text-black/70">
          Sign in to buy your delegate pass and register for events.
        </p>
        <div className="mt-6 h-48 animate-pulse bg-neo-muted/50 border-4 border-black" />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthStage>
      <Suspense fallback={<LoginFormSkeleton />}>
        <LoginForm adminMode={false} />
      </Suspense>
    </AuthStage>
  );
}
