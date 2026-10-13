"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatPaise } from "@/lib/money";
import { formatDateTimeIST } from "@/lib/dates";

/**
 * Discount codes (superadmin only). Issue flat or percent codes for passes,
 * cap their use, and deactivate them. The code and its value are fixed once
 * issued; limits, validity and the active flag can change.
 */

interface Usage {
  fulfilledCount: number;
  pendingCount: number;
  fulfilledDiscountPaise: number;
}

interface DiscountCode {
  id: string;
  code: string;
  description: string;
  discountType: "FLAT" | "PERCENT";
  amountOffPaise: number | null;
  percentOff: number | null;
  passProductId: string | null;
  maxRedemptions: number | null;
  perUserLimit: number;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  usage: Usage;
}

interface PassProductOption {
  id: string;
  name: string;
  onSale: boolean;
}

const EMPTY = {
  code: "",
  description: "",
  discountType: "FLAT" as "FLAT" | "PERCENT",
  value: "",
  passProductId: "",
  maxRedemptions: "",
  perUserLimit: "1",
  validFrom: "",
  validUntil: "",
};

// No 0/O or 1/I/L: codes get read out loud and typed from posters.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(length = 10): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function codeStatus(c: DiscountCode): { label: string; className: string } {
  const now = Date.now();
  if (!c.isActive) return { label: "Inactive", className: "bg-neo-muted" };
  if (c.validUntil && Date.parse(c.validUntil) <= now) return { label: "Expired", className: "bg-neo-muted" };
  if (c.validFrom && Date.parse(c.validFrom) > now) return { label: "Scheduled", className: "bg-neo-secondary" };
  if (c.maxRedemptions !== null && c.usage.fulfilledCount + c.usage.pendingCount >= c.maxRedemptions)
    return { label: "Used up", className: "bg-neo-accent" };
  return { label: "Active", className: "bg-green-300" };
}

function describeValue(c: DiscountCode): string {
  return c.discountType === "FLAT" ? `${formatPaise(c.amountOffPaise ?? 0)} off` : `${c.percentOff}% off`;
}

export default function DiscountCodesManager() {
  const [codes, setCodes] = useState<DiscountCode[]>([]);
  const [products, setProducts] = useState<PassProductOption[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [editing, setEditing] = useState<{ id: string; maxRedemptions: string; perUserLimit: string; validUntil: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/discount-codes");
      const body = await res.json();
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!body.ok) throw new Error(body.message ?? "Could not load discount codes");
      setCodes(body.data.codes);
      setProducts(body.data.passProducts);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not load discount codes", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(url: string, method: string, payload?: unknown): Promise<{ ok: boolean; message?: string; data?: unknown }> {
    const res = await fetch(url, {
      method,
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({ ok: false, message: "Request failed" }));
    if (!body.ok && Array.isArray(body.details?.issues) && body.details.issues.length > 0) {
      return { ok: false, message: body.details.issues.join(" · ") };
    }
    return body;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const value = Number(form.value);
    const result = await send("/api/admin/discount-codes", "POST", {
      code: form.code,
      description: form.description,
      discountType: form.discountType,
      amountOffRupees: form.discountType === "FLAT" ? value : null,
      percentOff: form.discountType === "PERCENT" ? value : null,
      passProductId: form.passProductId || null,
      maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
      perUserLimit: Number(form.perUserLimit || 1),
      validFrom: fromLocalInput(form.validFrom),
      validUntil: fromLocalInput(form.validUntil),
    });
    setBusy(false);
    if (result.ok) {
      setMessage({ text: `Code ${form.code.trim().toUpperCase()} issued.`, type: "success" });
      setForm(EMPTY);
      void load();
    } else {
      setMessage({ text: result.message ?? "Could not create code", type: "error" });
    }
  }

  async function update(c: DiscountCode, patch: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    const result = await send(`/api/admin/discount-codes/${c.id}`, "PATCH", { ...patch, version: c.version });
    setBusy(false);
    if (result.ok) {
      setMessage({ text: success, type: "success" });
      setEditing(null);
    } else {
      setMessage({ text: result.message ?? "Update failed", type: "error" });
    }
    void load();
  }

  async function remove(c: DiscountCode) {
    if (!window.confirm(`Delete code ${c.code}? This cannot be undone.`)) return;
    setBusy(true);
    setMessage(null);
    const result = await send(`/api/admin/discount-codes/${c.id}`, "DELETE");
    setBusy(false);
    setMessage(result.ok ? { text: `Code ${c.code} deleted.`, type: "success" } : { text: result.message ?? "Delete failed", type: "error" });
    void load();
  }

  const inputClass =
    "mt-1 w-full border-4 border-black bg-white px-3 py-2 text-sm font-bold text-black focus:outline-none focus:ring-2 focus:ring-black";
  const productName = (id: string | null) => (id ? products.find((p) => p.id === id)?.name ?? "Unknown pass" : "Any pass");

  if (loading) return <p className="mt-8 text-center font-bold text-black/60">Loading discount codes…</p>;

  if (forbidden) {
    return (
      <div className="mx-auto max-w-md border-8 border-black bg-neo-accent p-8 text-center shadow-neo-lg">
        <h1 className="text-2xl font-black uppercase tracking-tighter">Superadmin only</h1>
        <p className="mt-2 font-bold">Only superadmins can issue and manage discount codes.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-black uppercase tracking-tighter">Discount Codes</h1>
      <p className="mt-1 text-sm font-bold text-black/70">
        Codes reduce the pass price at checkout. The discount is computed on the server; a pending checkout holds a
        redemption until it is paid, cancelled or expires.
      </p>

      <form onSubmit={create} className="mt-6 border-4 border-black bg-white p-4 shadow-neo">
        <h2 className="font-black uppercase">Issue a new code</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-xs font-black uppercase">
            Code
            <div className="flex gap-2">
              <input
                required
                minLength={4}
                maxLength={32}
                pattern="[A-Za-z0-9][A-Za-z0-9_\-]{3,31}"
                title="4–32 letters, digits, - or _"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                className={`${inputClass} font-mono`}
                placeholder="TARANG100"
              />
              <button
                type="button"
                onClick={() => setForm({ ...form, code: generateCode() })}
                className="mt-1 border-4 border-black bg-neo-secondary px-3 hover:bg-white"
                title="Generate a random code"
                aria-label="Generate a random code"
              >
                <Shuffle className="h-4 w-4" />
              </button>
            </div>
          </label>
          <label className="text-xs font-black uppercase">
            Discount type
            <select
              value={form.discountType}
              onChange={(e) => setForm({ ...form, discountType: e.target.value as "FLAT" | "PERCENT", value: "" })}
              className={inputClass}
            >
              <option value="FLAT">Flat amount (₹)</option>
              <option value="PERCENT">Percentage (%)</option>
            </select>
          </label>
          <label className="text-xs font-black uppercase">
            {form.discountType === "FLAT" ? "Amount off (₹)" : "Percent off"}
            <input
              required
              type="number"
              min={form.discountType === "FLAT" ? 0.01 : 1}
              max={form.discountType === "FLAT" ? 1000000 : 100}
              step={form.discountType === "FLAT" ? 0.01 : 1}
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              className={inputClass}
              placeholder={form.discountType === "FLAT" ? "200" : "25"}
            />
          </label>
          <label className="text-xs font-black uppercase">
            Applies to
            <select value={form.passProductId} onChange={(e) => setForm({ ...form, passProductId: e.target.value })} className={inputClass}>
              <option value="">Any pass</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.onSale ? "" : " (not on sale)"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-black uppercase">
            Total uses (blank = unlimited)
            <input
              type="number"
              min={1}
              step={1}
              value={form.maxRedemptions}
              onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="text-xs font-black uppercase">
            Uses per person
            <input
              required
              type="number"
              min={1}
              max={100}
              step={1}
              value={form.perUserLimit}
              onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="text-xs font-black uppercase">
            Valid from (optional)
            <input type="datetime-local" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} className={inputClass} />
          </label>
          <label className="text-xs font-black uppercase">
            Valid until (optional)
            <input type="datetime-local" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} className={inputClass} />
          </label>
          <label className="text-xs font-black uppercase">
            Note (internal)
            <input
              maxLength={300}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className={inputClass}
              placeholder="e.g. Sponsor giveaway"
            />
          </label>
        </div>
        <div className="mt-4">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Issue code"}
          </Button>
        </div>
      </form>

      {message && (
        <p
          role="status"
          className={`mt-4 border-2 border-black px-3 py-2 text-sm font-bold ${message.type === "success" ? "bg-green-300" : "bg-neo-accent"}`}
        >
          {message.text}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {codes.map((c) => {
          const status = codeStatus(c);
          const used = c.usage.fulfilledCount;
          return (
            <div key={c.id} className="border-4 border-black bg-white p-4 shadow-neo-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-lg font-black tracking-wider">{c.code}</span>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard?.writeText(c.code)}
                      className="text-black/50 hover:text-black"
                      title="Copy code"
                      aria-label={`Copy ${c.code}`}
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <span className={`border-2 border-black px-2 py-0.5 text-xs font-black uppercase ${status.className}`}>
                      {status.label}
                    </span>
                    <span className="border-2 border-black bg-neo-cream px-2 py-0.5 text-xs font-black uppercase">
                      {describeValue(c)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-bold text-black/60">
                    {productName(c.passProductId)} · {c.perUserLimit} per person
                    {c.validFrom ? ` · from ${formatDateTimeIST(c.validFrom)}` : ""}
                    {c.validUntil ? ` · until ${formatDateTimeIST(c.validUntil)}` : ""}
                  </p>
                  {c.description && <p className="mt-1 text-xs font-bold text-black/50">{c.description}</p>}
                </div>
                <div className="text-right text-xs font-black uppercase">
                  <p>
                    Used {used}
                    {c.maxRedemptions !== null ? ` / ${c.maxRedemptions}` : ""}
                    {c.usage.pendingCount > 0 ? ` (+${c.usage.pendingCount} pending)` : ""}
                  </p>
                  <p className="text-black/50">Given {formatPaise(c.usage.fulfilledDiscountPaise).replace("FREE", "₹0")}</p>
                </div>
              </div>

              {editing?.id === c.id ? (
                <form
                  className="mt-3 grid gap-3 border-t-2 border-dashed border-black/40 pt-3 md:grid-cols-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void update(
                      c,
                      {
                        maxRedemptions: editing.maxRedemptions ? Number(editing.maxRedemptions) : null,
                        perUserLimit: Number(editing.perUserLimit || 1),
                        validUntil: fromLocalInput(editing.validUntil),
                      },
                      `Limits for ${c.code} updated.`
                    );
                  }}
                >
                  <label className="text-xs font-black uppercase">
                    Total uses (blank = unlimited)
                    <input
                      type="number"
                      min={1}
                      value={editing.maxRedemptions}
                      onChange={(e) => setEditing({ ...editing, maxRedemptions: e.target.value })}
                      className={inputClass}
                    />
                  </label>
                  <label className="text-xs font-black uppercase">
                    Uses per person
                    <input
                      required
                      type="number"
                      min={1}
                      max={100}
                      value={editing.perUserLimit}
                      onChange={(e) => setEditing({ ...editing, perUserLimit: e.target.value })}
                      className={inputClass}
                    />
                  </label>
                  <label className="text-xs font-black uppercase">
                    Valid until
                    <input
                      type="datetime-local"
                      value={editing.validUntil}
                      onChange={(e) => setEditing({ ...editing, validUntil: e.target.value })}
                      className={inputClass}
                    />
                  </label>
                  <div className="flex items-end gap-2">
                    <button type="submit" disabled={busy} className="border-2 border-black bg-neo-secondary px-3 py-2 text-xs font-black uppercase hover:bg-white">
                      Save
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="border-2 border-black bg-white px-3 py-2 text-xs font-black uppercase hover:bg-neo-muted">
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void update(c, { isActive: !c.isActive }, `Code ${c.code} ${c.isActive ? "deactivated" : "activated"}.`)
                    }
                    className="border-2 border-black bg-white px-3 py-1 text-xs font-black uppercase hover:bg-neo-secondary"
                  >
                    {c.isActive ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setEditing({
                        id: c.id,
                        maxRedemptions: c.maxRedemptions === null ? "" : String(c.maxRedemptions),
                        perUserLimit: String(c.perUserLimit),
                        validUntil: toLocalInput(c.validUntil),
                      })
                    }
                    className="border-2 border-black bg-white px-3 py-1 text-xs font-black uppercase hover:bg-neo-secondary"
                  >
                    Edit limits
                  </button>
                  {used === 0 && c.usage.pendingCount === 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(c)}
                      className="border-2 border-black bg-white px-3 py-1 text-xs font-black uppercase hover:bg-neo-accent"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {codes.length === 0 && (
          <p className="border-4 border-black bg-white p-6 text-center font-bold text-black/50">No discount codes yet.</p>
        )}
      </div>
    </div>
  );
}
