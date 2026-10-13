"use client";

import { useState, type FormEvent } from "react";
import { Send, CheckCircle2, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FEST, HAS_CONTACT } from "@/lib/data";

const TOPICS = [
  "Registration",
  "Passes & Entry",
  "Events & Rules",
  "Sponsorship",
  "Volunteering",
  "Accommodation",
  "Something else",
];

type Status = "idle" | "sending" | "sent" | "error";

export default function AskForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [ticket, setTicket] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    college: "",
    topic: "",
    question: "",
  });

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage("");

    try {
      const res = await fetch("/api/public/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.message ?? "Could not submit your question. Please try again.");
      }
      setTicket(body.data.ticketCode);
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to submit question");
    }
  }

  function handleReset() {
    setForm({ name: "", email: "", college: "", topic: "", question: "" });
    setTicket("");
    setErrorMessage("");
    setStatus("idle");
  }

  if (status === "sent") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <div className="border-8 border-black bg-white p-10 text-center shadow-neo-xl">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border-4 border-black bg-neo-secondary shadow-neo">
            <CheckCircle2 className="h-10 w-10" strokeWidth={3} />
          </div>
          <h2 className="text-4xl font-black uppercase tracking-tighter">
            Question received!
          </h2>
          <p className="mt-4 text-lg font-bold leading-snug">
            Your ticket ID is{" "}
            <span className="bg-neo-secondary px-2 font-black tracking-widest">
              {ticket}
            </span>
            . The help desk replies within 24 hours — faster during fest week.
          </p>
          <div className="mt-8">
            <Button variant="primary" onClick={handleReset}>
              Ask another question
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
                htmlFor="name"
                className="mb-2 block text-sm font-black uppercase tracking-widest"
              >
                Your name *
              </label>
              <input
                id="name"
                name="name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Full name"
                className="h-14 w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white px-4 text-lg font-bold placeholder:text-black/40 dark:placeholder:text-zinc-500 focus-visible:bg-neo-secondary dark:focus-visible:bg-neo-surface focus-visible:shadow-neo-sm focus-visible:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-black uppercase tracking-widest"
              >
                Email *
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
            <div>
              <label
                htmlFor="topic"
                className="mb-2 block text-sm font-black uppercase tracking-widest"
              >
                Topic *
              </label>
              <select
                id="topic"
                name="topic"
                required
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
                className="h-14 w-full border-4 border-black bg-white dark:bg-neo-surface text-black dark:text-white px-4 text-lg font-bold focus-visible:bg-neo-secondary dark:focus-visible:bg-neo-surface focus-visible:shadow-neo-sm focus-visible:outline-none"
              >
                <option value="" disabled>
                  Pick a topic
                </option>
                {TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="question"
              className="mb-2 block text-sm font-black uppercase tracking-widest"
            >
              Your question *
            </label>
            <textarea
              id="question"
              name="question"
              required
              minLength={10}
              rows={6}
              value={form.question}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
              placeholder="Type your question here — the more detail, the faster we can help."
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
              "Sending…"
            ) : (
              <>
                Send question <Send className="h-5 w-5" strokeWidth={3} />
              </>
            )}
          </Button>
        </form>

        {/* Side info */}
        <aside className="space-y-6 lg:col-span-2">
          <div className="-rotate-1 border-4 border-black bg-neo-secondary p-6 text-black shadow-neo">
            <h2 className="text-2xl font-black uppercase tracking-tighter text-black">
              Faster channels
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
          <div className="rotate-1 border-4 border-black bg-black p-6 text-white shadow-neo">
            <h2 className="text-2xl font-black uppercase tracking-tighter text-neo-secondary">
              During fest week
            </h2>
            <p className="mt-3 text-base font-bold leading-snug">
              Skip the form — walk up to the help desk near the Student Centre.
              It&apos;s open 8 AM to 10 PM across both fest days, and someone in a
              yellow tee can answer almost anything on the spot.
            </p>
          </div>
          <div className="border-4 border-black bg-neo-muted p-6 text-black shadow-neo">
            <h2 className="text-2xl font-black uppercase tracking-tighter text-black">
              Before you ask
            </h2>
            <p className="mt-3 text-base font-bold leading-snug text-black">
              Most questions about passes, entry and registration are already
              answered in the FAQs.
            </p>
            <a
              href="/faqs"
              className="mt-4 inline-block border-4 border-black bg-white dark:bg-neo-card text-black dark:text-white px-4 py-2 text-sm font-black uppercase tracking-widest shadow-neo-sm transition-transform duration-100 hover:-translate-y-0.5"
            >
              Check the FAQs →
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
