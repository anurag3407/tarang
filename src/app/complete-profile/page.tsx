"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * /complete-profile — capture required name/college/phone/consent before
 * purchase (plan §11.3). Submits to the same-origin profile API.
 */
export default function CompleteProfilePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    displayName: "",
    collegeName: "",
    phoneE164: "",
    consent: false,
  });
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.message ?? "Could not save profile");
      }
      router.push("/dashboard");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not save profile");
    }
  }

  const inputClass =
    "mt-1 w-full border-4 border-black bg-white px-3 py-2 text-base font-bold focus:outline-none focus:ring-2 focus:ring-black";

  return (
    <div className="mx-auto max-w-md px-4 py-20">
      <div className="border-8 border-black bg-white p-8 shadow-neo-lg">
        <h1 className="text-3xl font-black uppercase tracking-tighter">
          Complete your profile
        </h1>
        <p className="mt-2 text-sm font-bold text-black/70">
          Required before buying a Pronite Pass. Used for entry verification.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block text-xs font-black uppercase tracking-widest">
            Full name
            <input
              required
              minLength={2}
              maxLength={120}
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-black uppercase tracking-widest">
            College
            <input
              required
              minLength={2}
              maxLength={160}
              value={form.collegeName}
              onChange={(e) => setForm({ ...form, collegeName: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-black uppercase tracking-widest">
            Phone (with country code)
            <input
              required
              type="tel"
              placeholder="+919876543210"
              value={form.phoneE164}
              onChange={(e) => setForm({ ...form, phoneE164: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="flex items-start gap-3 text-sm font-bold">
            <input
              type="checkbox"
              required
              checked={form.consent}
              onChange={(e) => setForm({ ...form, consent: e.target.checked })}
              className="mt-1 h-5 w-5 border-2 border-black"
            />
            I agree to the fest code of conduct and consent to my details being
            used for entry verification.
          </label>

          {message && (
            <p className="border-4 border-black bg-neo-accent px-3 py-2 text-sm font-bold" role="alert">
              {message}
            </p>
          )}

          <Button type="submit" variant="primary" className="w-full" disabled={status === "loading"}>
            {status === "loading" ? "Saving…" : "Save & continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}
