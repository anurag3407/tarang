"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatDateTimeIST } from "@/lib/dates";

/**
 * Schedule admin (plan §11.7). Standalone ceremony/pro-show entries with
 * optimistic version; venue/time conflict detection happens server-side.
 */

interface Entry {
  id: string;
  linkedEventId: string | null;
  linkedEventName: string | null;
  title: string | null;
  startsAt: string;
  endsAt: string;
  categoryKey: string;
  isNight: boolean;
  dayTheme: string | null;
  status: string;
  version: number;
  venueName: string | null;
}

const EMPTY = {
  title: "",
  categoryKey: "ceremony",
  startsAt: "",
  endsAt: "",
  isNight: false,
  dayTheme: "",
};

export default function ScheduleManager() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/schedule");
    const body = await res.json();
    if (body.ok) setEntries(body.data.entries);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const res = await fetch("/api/admin/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        linkedEventId: null,
        title: form.title,
        venueId: null,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        categoryKey: form.categoryKey,
        isNight: form.isNight,
        dayTheme: form.dayTheme || null,
        version: 0,
      }),
    });
    const body = await res.json();
    if (body.ok) {
      setMessage("Entry created (draft).");
      setForm(EMPTY);
      void load();
    } else {
      setMessage(body.message ?? "Create failed");
    }
  }

  const inputClass =
    "mt-1 w-full border-4 border-black bg-white px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-black";

  return (
    <div>
      <h1 className="text-3xl font-black uppercase tracking-tighter">Schedule</h1>

      <form onSubmit={create} className="mt-6 border-4 border-black bg-white p-4 shadow-neo">
        <h2 className="font-black uppercase">New standalone entry</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-black uppercase">
            Title
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputClass} placeholder="Opening Ceremony" />
          </label>
          <label className="text-xs font-black uppercase">
            Category key
            <input required value={form.categoryKey} onChange={(e) => setForm({ ...form, categoryKey: e.target.value })} className={inputClass} />
          </label>
          <label className="text-xs font-black uppercase">
            Starts
            <input required type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className={inputClass} />
          </label>
          <label className="text-xs font-black uppercase">
            Ends
            <input required type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className={inputClass} />
          </label>
          <label className="text-xs font-black uppercase">
            Day theme (optional)
            <input value={form.dayTheme} onChange={(e) => setForm({ ...form, dayTheme: e.target.value })} className={inputClass} />
          </label>
          <label className="flex items-center gap-2 text-xs font-black uppercase">
            <input type="checkbox" checked={form.isNight} onChange={(e) => setForm({ ...form, isNight: e.target.checked })} className="h-5 w-5 border-2 border-black" />
            Night event
          </label>
        </div>
        <Button type="submit" variant="primary" className="mt-3">
          Add entry
        </Button>
        {message && <p className="mt-3 border-2 border-black bg-neo-secondary px-3 py-1 text-sm font-bold">{message}</p>}
      </form>

      <div className="mt-6 space-y-2">
        {entries.map((en) => (
          <div key={en.id} className="flex flex-wrap items-center justify-between gap-3 border-4 border-black bg-white px-4 py-3 shadow-neo-sm">
            <div>
              <p className="font-black uppercase">
                {en.linkedEventName ?? en.title ?? "Untitled"}
                {en.isNight && <span className="ml-2 text-xs text-neo-accent">🌙</span>}
              </p>
              <p className="text-xs font-bold text-black/50">
                {formatDateTimeIST(en.startsAt)}
                {en.venueName ? ` · ${en.venueName}` : ""}
                {en.dayTheme ? ` · ${en.dayTheme}` : ""}
              </p>
            </div>
            <span className="border-2 border-black bg-neo-muted px-2 py-0.5 text-xs font-black uppercase">
              {en.status}
            </span>
          </div>
        ))}
        {entries.length === 0 && (
          <p className="border-4 border-black bg-white p-6 text-center font-bold text-black/50">No schedule entries.</p>
        )}
      </div>
    </div>
  );
}
