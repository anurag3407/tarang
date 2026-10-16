"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Mail, Phone, Award, Sparkles, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FEST, HAS_CONTACT } from "@/lib/data";

type Status = "idle" | "sending" | "sent" | "error";

export default function CampusAmbassadorForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [entryCode, setEntryCode] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [form, setForm] = useState({
    leadName: "",
    email: "",
    phone: "",
    college: "",
    groupSize: "",
    notes: "",
  });

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage("");

    try {
      const res = await fetch("/api/public/group-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.message ?? "Could not submit your application. Please try again.");
      }
      setEntryCode(body.data.entryCode);
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to submit campus ambassador application");
    }
  }

  function handleReset() {
    setForm({ leadName: "", email: "", phone: "", college: "", groupSize: "", notes: "" });
    setEntryCode("");
    setErrorMessage("");
    setStatus("idle");
  }

  if (status === "sent") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <div className="border-8 border-black bg-white dark:bg-neo-card text-black dark:text-white p-10 text-center shadow-neo-xl">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border-4 border-black bg-neo-secondary text-black shadow-neo">
            <CheckCircle2 className="h-10 w-10" strokeWidth={3} />
          </div>
          <h2 className="text-4xl font-black uppercase tracking-tighter text-black dark:text-white">
            Campus Ambassador Application Received!
          </h2>
          <p className="mt-4 text-lg font-bold leading-snug text-black dark:text-zinc-300">
            Your application reference code is{" "}
            <span className="bg-neo-secondary text-black px-2 font-black tracking-widest">
              {entryCode}
            </span>
            . The TARANG 2026 Core Team will review your application and contact you over email and phone with onboarding details.
          </p>
          <div className="mt-8">
            <Button variant="primary" onClick={handleReset}>
              Submit Another Application
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
      <div className="grid gap-12 lg:grid-cols-5">
        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="space-y-6 border-8 border-black bg-white dark:bg-neo-card text-black dark:text-white p-8 shadow-neo-xl lg:col-span-3"
        >
          <div className="border-b-4 border-black pb-4">
            <h2 className="text-2xl font-black uppercase tracking-tight">
              ⚡ Ambassador Application Form
            </h2>
            <p className="text-xs font-bold text-black/70 dark:text-zinc-400 mt-1">
              Fill in your details below to become the official TARANG 2026 Ambassador for your campus.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label
                htmlFor="leadName"
                className="mb-2 block text-sm font-black uppercase tracking-widest"
              >
                Full Name *
              </label>
              <input
                id="leadName"
                name="leadName"
                required
                value={form.leadName}
                onChange={(e) => setForm({ ...form, leadName: e.target.value })}
                placeholder="e.g. Aarav Sharma"
                className="h-14 w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white px-4 text-lg font-bold placeholder:text-black/40 dark:placeholder:text-zinc-500 focus-visible:bg-neo-secondary dark:focus-visible:bg-neo-surface focus-visible:shadow-neo-sm focus-visible:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-black uppercase tracking-widest"
              >
                Email Address *
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@college.edu"
                className="h-14 w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white px-4 text-lg font-bold placeholder:text-black/40 dark:placeholder:text-zinc-500 focus-visible:bg-neo-secondary dark:focus-visible:bg-neo-surface focus-visible:shadow-neo-sm focus-visible:outline-none"
              />
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label
                htmlFor="phone"
                className="mb-2 block text-sm font-black uppercase tracking-widest"
              >
                Phone / WhatsApp *
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+91 98765 43210"
                className="h-14 w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white px-4 text-lg font-bold placeholder:text-black/40 dark:placeholder:text-zinc-500 focus-visible:bg-neo-secondary dark:focus-visible:bg-neo-surface focus-visible:shadow-neo-sm focus-visible:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="college"
                className="mb-2 block text-sm font-black uppercase tracking-widest"
              >
                College / Institution *
              </label>
              <input
                id="college"
                name="college"
                required
                value={form.college}
                onChange={(e) => setForm({ ...form, college: e.target.value })}
                placeholder="Your college / university name"
                className="h-14 w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white px-4 text-lg font-bold placeholder:text-black/40 dark:placeholder:text-zinc-500 focus-visible:bg-neo-secondary dark:focus-visible:bg-neo-surface focus-visible:shadow-neo-sm focus-visible:outline-none"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="groupSize"
              className="mb-2 block text-sm font-black uppercase tracking-widest"
            >
              Estimated Contingent / Delegation Size *
            </label>
            <input
              id="groupSize"
              name="groupSize"
              type="number"
              required
              min={1}
              max={500}
              value={form.groupSize}
              onChange={(e) => setForm({ ...form, groupSize: e.target.value })}
              placeholder="Expected number of students coming from your college"
              className="h-14 w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white px-4 text-lg font-bold placeholder:text-black/40 dark:placeholder:text-zinc-500 focus-visible:bg-neo-secondary dark:focus-visible:bg-neo-surface focus-visible:shadow-neo-sm focus-visible:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="notes"
              className="mb-2 block text-sm font-black uppercase tracking-widest"
            >
              Why do you want to be a Campus Ambassador?
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={4}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Tell us about student clubs, societies, or events you lead in your college..."
              className="w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white p-4 text-lg font-bold placeholder:text-black/40 dark:placeholder:text-zinc-500 focus-visible:bg-neo-secondary dark:focus-visible:bg-neo-surface focus-visible:shadow-neo-sm focus-visible:outline-none"
            />
          </div>

          {errorMessage && (
            <p className="border-4 border-black bg-neo-accent p-3 text-sm font-bold text-black" role="alert">
              {errorMessage}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full sm:w-auto text-sm font-black uppercase"
            disabled={status === "sending"}
          >
            {status === "sending" ? (
              "Submitting Application…"
            ) : (
              <>
                Apply as Campus Ambassador <Send className="h-5 w-5 ml-1" strokeWidth={3} />
              </>
            )}
          </Button>
        </form>

        {/* Side info */}
        <aside className="space-y-6 lg:col-span-2">
          <div className="-rotate-1 border-4 border-black bg-neo-secondary p-6 text-black shadow-neo">
            <h2 className="text-2xl font-black uppercase tracking-tighter text-black flex items-center gap-2">
              <Award className="h-6 w-6" /> Ambassador Perks
            </h2>
            <ul className="mt-4 space-y-3 text-base font-bold leading-snug text-black">
              <li>✨ Official certificate of leadership from TARANG, NIT Patna.</li>
              <li>🎟️ Free Pronite Passes based on contingent size.</li>
              <li>👕 Exclusive TARANG Merchandise &amp; Welcome Kit.</li>
              <li>🤝 Network with student leaders from colleges across the country.</li>
            </ul>
          </div>

          <div className="rotate-1 border-4 border-black bg-black p-6 text-white shadow-neo">
            <h2 className="text-2xl font-black uppercase tracking-tighter text-neo-secondary flex items-center gap-2">
              <Sparkles className="h-6 w-6" /> Your Role
            </h2>
            <p className="mt-3 text-base font-bold leading-snug">
              As a Campus Ambassador, you will be the official face of TARANG 2026 at your institution — spreading the word, coordinating team registrations, and leading your college contingent.
            </p>
          </div>

          <div className="border-4 border-black bg-neo-muted p-6 text-black shadow-neo">
            <h2 className="text-2xl font-black uppercase tracking-tighter text-black">
              Questions? Contact Us
            </h2>
            <ul className="mt-4 space-y-3">
              {FEST.email && (
              <li className="flex items-center gap-3">
                <Mail className="h-6 w-6 shrink-0 text-black" strokeWidth={3} />
                <a
                  href={`mailto:${FEST.email}`}
                  className="text-base font-bold underline decoration-4 underline-offset-4 text-black"
                >
                  {FEST.email}
                </a>
              </li>
              )}
              {FEST.phone && (
              <li className="flex items-center gap-3">
                <Phone className="h-6 w-6 shrink-0 text-black" strokeWidth={3} />
                <span className="text-base font-bold text-black">{FEST.phone}</span>
              </li>
              )}
              {!HAS_CONTACT && (
                <li className="text-base font-bold text-black">
                  Contact details are being finalised — use this form and the help desk will reply.
                </li>
              )}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
