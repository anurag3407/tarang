"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import PaymentHealthPanel from "./PaymentHealthPanel";
import { formatDateTimeIST } from "@/lib/dates";

/**
 * Support / query resolver dashboard (plan §11.9).
 * Open → In progress → Resolved with a resolution note.
 */

interface Question {
  id: string;
  ticketCode: string;
  name: string;
  email: string;
  college: string | null;
  topic: string;
  question: string;
  status: string;
  resolutionNote: string | null;
  createdAt: string;
}

export default function SupportDashboard() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [filter, setFilter] = useState("OPEN");
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams();
      if (filter !== "ALL") params.set("status", filter);
      const res = await fetch(`/api/admin/questions?${params}`);
      const body = await res.json();
      if (!body.ok) throw new Error(body.message ?? "Could not load questions");
      setQuestions(body.data.questions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load questions");
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(id: string, status: string) {
    const res = await fetch(`/api/admin/questions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status,
        ...(status === "RESOLVED" ? { resolutionNote: note } : {}),
      }),
    });
    const body = await res.json();
    if (!body.ok) setError(body.message ?? "Update failed");
    setResolving(null);
    setNote("");
    void load();
  }

  return (
    <div>
      {/* Money first: a stalled reconciler or an unrefunded capture outranks
          any question in the queue below. */}
      <PaymentHealthPanel />

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-black uppercase tracking-tighter">Support</h1>
        <div className="flex gap-1">
          {["OPEN", "IN_PROGRESS", "RESOLVED", "ALL"].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`border-2 border-black px-3 py-1 text-xs font-black uppercase ${
                filter === s ? "bg-neo-secondary" : "bg-white"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-4 border-4 border-black bg-neo-accent p-3 font-bold">{error}</p>}

      <div className="mt-6 space-y-4">
        {questions.map((q) => (
          <div key={q.id} className="border-4 border-black bg-white p-4 shadow-neo">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="border-2 border-black bg-neo-muted px-2 py-0.5 text-xs font-black uppercase">
                  {q.ticketCode}
                </span>
                <span className="ml-2 font-black uppercase">{q.topic}</span>
              </div>
              <span className="text-xs font-bold text-black/50">
                {formatDateTimeIST(q.createdAt)}
              </span>
            </div>
            <p className="mt-2 text-sm font-bold">
              {q.name} · {q.email}
              {q.college ? ` · ${q.college}` : ""}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{q.question}</p>

            {resolving === q.id ? (
              <div className="mt-3 border-4 border-black bg-neo-cream p-3">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Resolution note (sent to the participant)…"
                  className="w-full border-4 border-black bg-white p-2 text-sm font-bold focus:outline-none"
                  rows={3}
                />
                <div className="mt-2 flex gap-2">
                  <Button variant="secondary" onClick={() => setStatus(q.id, "RESOLVED")}>
                    Mark resolved
                  </Button>
                  <Button variant="outline" onClick={() => setResolving(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                {q.status === "OPEN" && (
                  <Button variant="muted" onClick={() => setStatus(q.id, "IN_PROGRESS")}>
                    Start
                  </Button>
                )}
                {q.status !== "RESOLVED" && (
                  <Button variant="secondary" onClick={() => setResolving(q.id)}>
                    Resolve
                  </Button>
                )}
                {q.resolutionNote && (
                  <p className="self-center text-xs font-bold text-black/50">
                    Note: {q.resolutionNote}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
        {questions.length === 0 && (
          <p className="border-4 border-black bg-white p-6 text-center font-bold text-black/50">
            No questions in this state.
          </p>
        )}
      </div>
    </div>
  );
}
