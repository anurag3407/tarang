"use client";

import { useState, type FormEvent } from "react";
import { Users, CheckCircle2, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FEST, HAS_CONTACT } from "@/lib/data";

type Status = "idle" | "sending" | "sent" | "error";

export default function GroupEntryForm() {
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
        throw new Error(body.message ?? "Could not submit your group entry. Please try again.");
      }
      setEntryCode(body.data.entryCode);
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to submit group entry");
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
            Group entry received!
          </h2>
          <p className="mt-4 text-lg font-bold leading-snug text-black dark:text-zinc-300">
            Your entry code is{" "}
            <span className="bg-neo-secondary text-black px-2 font-black tracking-widest">
              {entryCode}
            </span>
            . We&apos;ll confirm entry details with the group lead over email
            soon — keep that code handy.
          </p>
          <div className="mt-8">
            <Button variant="primary" onClick={handleReset}>
              Register another group
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
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label
                htmlFor="leadName"
                className="mb-2 block text-sm font-black uppercase tracking-widest"
              >
                Group lead name *
              </label>
              <input
                id="leadName"
                name="leadName"
                required
                value={form.leadName}
                onChange={(e) => setForm({ ...form, leadName: e.target.value })}
                placeholder="Full name of the lead"
                className="h-14 w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white px-4 text-lg font-bold placeholder:text-black/40 dark:placeholder:text-zinc-500 focus-visible:bg-neo-secondary dark:focus-visible:bg-neo-surface focus-visible:shadow-neo-sm focus-visible:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-black uppercase tracking-widest"
              >
                Lead email *
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
                Lead phone *
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
                College
              </label>
              <input
                id="college"
                name="college"
                value={form.college}
                onChange={(e) => setForm({ ...form, college: e.target.value })}
                placeholder="Your college / institute"
                className="h-14 w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white px-4 text-lg font-bold placeholder:text-black/40 dark:placeholder:text-zinc-500 focus-visible:bg-neo-secondary dark:focus-visible:bg-neo-surface focus-visible:shadow-neo-sm focus-visible:outline-none"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="groupSize"
              className="mb-2 block text-sm font-black uppercase tracking-widest"
            >
              Number of people *
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
              placeholder="Total people in the group, including the lead"
              className="h-14 w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white px-4 text-lg font-bold placeholder:text-black/40 dark:placeholder:text-zinc-500 focus-visible:bg-neo-secondary dark:focus-visible:bg-neo-surface focus-visible:shadow-neo-sm focus-visible:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="notes"
              className="mb-2 block text-sm font-black uppercase tracking-widest"
            >
              Anything else?
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={5}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Preferred entry day, accommodation needs, questions — anything the team should know."
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
            className="w-full sm:w-auto"
            disabled={status === "sending"}
          >
            {status === "sending" ? (
              "Submitting…"
            ) : (
              <>
                Register group <Users className="h-5 w-5" strokeWidth={3} />
              </>
            )}
          </Button>
        </form>

        {/* Side info */}
        <aside className="space-y-6 lg:col-span-2">
          <div className="-rotate-1 border-4 border-black bg-neo-secondary p-6 text-black shadow-neo">
            <h2 className="text-2xl font-black uppercase tracking-tighter text-black">
              How it works
            </h2>
            <ol className="mt-4 space-y-3 text-base font-bold leading-snug text-black">
              <li>1. One person registers the whole group here.</li>
              <li>2. The team confirms entry details over email.</li>
              <li>3. Show the confirmation at the gate — the group walks in together.</li>
            </ol>
          </div>
          <div className="rotate-1 border-4 border-black bg-black p-6 text-white shadow-neo">
            <h2 className="text-2xl font-black uppercase tracking-tighter text-neo-secondary">
              Good to know
            </h2>
            <p className="mt-3 text-base font-bold leading-snug">
              Submit one entry per group — no need for every member to fill
              anything. The group lead is the single point of contact, so use
              an email and phone number you check often.
            </p>
          </div>
          <div className="border-4 border-black bg-neo-muted p-6 text-black shadow-neo">
            <h2 className="text-2xl font-black uppercase tracking-tighter text-black">
              Talk to us instead
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
