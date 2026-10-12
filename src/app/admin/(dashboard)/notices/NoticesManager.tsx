"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatDateTimeIST } from "@/lib/dates";

/**
 * Notice admin (plan §11.8). Create/edit with optimistic version, tag, pin,
 * scheduled publication and expiry.
 */

interface Notice {
  id: string;
  slug: string;
  tag: string;
  title: string;
  bodyMarkdown: string;
  publishAt: string;
  expiresAt: string | null;
  pinned: boolean;
  status: string;
  version: number;
}

const EMPTY = {
  slug: "",
  tag: "INFO",
  title: "",
  bodyMarkdown: "",
  publishAt: "",
  expiresAt: "",
  pinned: false,
};

export default function NoticesManager() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVersion, setEditingVersion] = useState(0);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/notices");
    const body = await res.json();
    if (body.ok) setNotices(body.data.notices);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(n: Notice) {
    setEditingId(n.id);
    setEditingVersion(n.version);
    setForm({
      slug: n.slug,
      tag: n.tag,
      title: n.title,
      bodyMarkdown: n.bodyMarkdown,
      publishAt: n.publishAt.slice(0, 16),
      expiresAt: n.expiresAt ? n.expiresAt.slice(0, 16) : "",
      pinned: n.pinned,
    });
  }

  function reset() {
    setEditingId(null);
    setForm(EMPTY);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const payload = {
      slug: form.slug,
      tag: form.tag,
      title: form.title,
      bodyMarkdown: form.bodyMarkdown,
      publishAt: new Date(form.publishAt).toISOString(),
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      pinned: form.pinned,
      version: editingId ? editingVersion : 0,
    };
    const url = editingId ? `/api/admin/notices/${editingId}` : "/api/admin/notices";
    const method = editingId ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (body.ok) {
      setMessage(editingId ? "Notice updated." : "Notice created.");
      reset();
      void load();
    } else {
      setMessage(
        body.code === "VERSION_CONFLICT"
          ? "Notice changed elsewhere — reload and retry."
          : body.message ?? "Save failed"
      );
    }
  }

  const inputClass =
    "mt-1 w-full border-4 border-black bg-white px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-black";

  return (
    <div>
      <h1 className="text-3xl font-black uppercase tracking-tighter">Notices</h1>

      <form onSubmit={save} className="mt-6 border-4 border-black bg-white p-4 shadow-neo">
        <h2 className="font-black uppercase">{editingId ? "Edit notice" : "New notice"}</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-black uppercase">
            Title
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputClass} />
          </label>
          <label className="text-xs font-black uppercase">
            Slug
            <input required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className={inputClass} placeholder="venue-change" />
          </label>
          <label className="text-xs font-black uppercase">
            Tag
            <select value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} className={inputClass}>
              {["INFO", "UPDATE", "URGENT", "REGISTRATION"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-black uppercase">
            Publish at
            <input required type="datetime-local" value={form.publishAt} onChange={(e) => setForm({ ...form, publishAt: e.target.value })} className={inputClass} />
          </label>
          <label className="text-xs font-black uppercase">
            Expires at (optional)
            <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className={inputClass} />
          </label>
          <label className="flex items-center gap-2 text-xs font-black uppercase">
            <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} className="h-5 w-5 border-2 border-black" />
            Pin to top
          </label>
        </div>
        <label className="mt-3 block text-xs font-black uppercase">
          Body (markdown)
          <textarea required rows={4} value={form.bodyMarkdown} onChange={(e) => setForm({ ...form, bodyMarkdown: e.target.value })} className={inputClass} />
        </label>
        <div className="mt-3 flex gap-2">
          <Button type="submit" variant="primary">
            {editingId ? "Update" : "Create"}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" onClick={reset}>
              Cancel
            </Button>
          )}
        </div>
        {message && <p className="mt-3 border-2 border-black bg-neo-secondary px-3 py-1 text-sm font-bold">{message}</p>}
      </form>

      <div className="mt-6 space-y-3">
        {notices.map((n) => (
          <div key={n.id} className="flex flex-wrap items-center justify-between gap-3 border-4 border-black bg-white p-4 shadow-neo-sm">
            <div>
              <span className="border-2 border-black bg-neo-muted px-2 py-0.5 text-xs font-black uppercase">{n.tag}</span>
              <span className="ml-2 font-black uppercase">{n.title}</span>
              {n.pinned && <span className="ml-2 text-xs font-black uppercase text-neo-accent">📌 pinned</span>}
              <p className="text-xs font-bold text-black/50">
                {n.status} · publishes {formatDateTimeIST(n.publishAt)}
              </p>
            </div>
            <button onClick={() => startEdit(n)} className="border-2 border-black bg-white px-3 py-1 text-xs font-black uppercase hover:bg-neo-secondary">
              Edit
            </button>
          </div>
        ))}
        {notices.length === 0 && (
          <p className="border-4 border-black bg-white p-6 text-center font-bold text-black/50">No notices yet.</p>
        )}
      </div>
    </div>
  );
}
