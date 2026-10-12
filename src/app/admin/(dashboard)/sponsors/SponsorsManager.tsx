"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Award,
  ExternalLink,
  Image as ImageIcon,
  Link as LinkIcon,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";

interface Sponsor {
  id: string;
  name: string;
  category: string;
  tagline: string;
  logoUrl: string;
  websiteUrl: string | null;
  colorKey: "accent" | "secondary" | "muted" | "white";
  sortOrder: number;
  isTitle: boolean;
  isActive: boolean;
  version: number;
}

const CATEGORY_PRESETS = [
  "Title Sponsor",
  "Co-Powered By",
  "Associate Partner",
  "Beverage Partner",
  "Audio & Stage Partner",
  "Media & Outreach Partner",
  "Merchandise Partner",
  "Hospitality Partner",
];

const EMPTY_FORM = {
  name: "",
  category: "Associate Partner",
  tagline: "",
  logoUrl: "",
  websiteUrl: "",
  colorKey: "secondary" as "accent" | "secondary" | "muted" | "white",
  sortOrder: 0,
  isTitle: false,
  isActive: true,
};

const COLOR_MAP = {
  accent: "bg-neo-accent text-black",
  secondary: "bg-neo-secondary text-black",
  muted: "bg-neo-muted text-black",
  white: "bg-white text-black",
};

export default function SponsorsManager() {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVersion, setEditingVersion] = useState(0);
  const [message, setMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sponsors");
      const body = await res.json();
      if (body.ok) setSponsors(body.data.sponsors);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(s: Sponsor) {
    setEditingId(s.id);
    setEditingVersion(s.version);
    setForm({
      name: s.name,
      category: s.category,
      tagline: s.tagline || "",
      logoUrl: s.logoUrl,
      websiteUrl: s.websiteUrl || "",
      colorKey: s.colorKey || "secondary",
      sortOrder: s.sortOrder || 0,
      isTitle: Boolean(s.isTitle),
      isActive: Boolean(s.isActive),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setEditingId(null);
    setEditingVersion(0);
    setForm(EMPTY_FORM);
    setUploadError("");
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/admin/sponsors/upload", {
        method: "POST",
        body: formData,
      });

      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.message ?? "Upload failed");
      }

      setForm((prev) => ({ ...prev, logoUrl: body.data.url }));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (!form.logoUrl) {
      setMessage("Please upload an image logo or enter a valid logo URL.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      category: form.category.trim(),
      tagline: form.tagline.trim(),
      logoUrl: form.logoUrl.trim(),
      websiteUrl: form.websiteUrl.trim() || null,
      colorKey: form.colorKey,
      sortOrder: Number(form.sortOrder) || 0,
      isTitle: Boolean(form.isTitle),
      isActive: Boolean(form.isActive),
      version: editingId ? editingVersion : 0,
    };

    const url = editingId ? `/api/admin/sponsors/${editingId}` : "/api/admin/sponsors";
    const method = editingId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    if (body.ok) {
      setMessage(editingId ? "Sponsor updated successfully!" : "Sponsor created successfully!");
      reset();
      void load();
    } else {
      setMessage(
        body.code === "VERSION_CONFLICT"
          ? "Sponsor changed elsewhere — please reload and retry."
          : body.message ?? "Failed to save sponsor."
      );
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

    const res = await fetch(`/api/admin/sponsors/${id}`, {
      method: "DELETE",
    });
    const body = await res.json();
    if (body.ok) {
      setMessage(`Sponsor "${name}" deleted.`);
      if (editingId === id) reset();
      void load();
    } else {
      setMessage(body.message ?? "Delete failed");
    }
  }

  const inputClass =
    "mt-1 w-full border-4 border-black bg-white px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-black";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter">
            Sponsors &amp; Partners
          </h1>
          <p className="mt-1 text-sm font-bold text-black/70">
            Upload logos, configure hyperlinks, and organize festival partner tiers.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            reset();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="inline-flex items-center gap-1 border-4 border-black bg-neo-secondary px-3 py-2 text-xs font-black uppercase tracking-wider shadow-neo-sm hover:bg-white"
        >
          <Plus className="h-4 w-4" /> Add New Sponsor
        </button>
      </div>

      {/* Editor Form */}
      <form
        onSubmit={save}
        className="mt-6 border-4 border-black bg-white p-5 shadow-neo sm:p-6"
      >
        <div className="flex items-center justify-between border-b-2 border-black/20 pb-3">
          <h2 className="text-xl font-black uppercase">
            {editingId ? "Edit Sponsor" : "Create New Sponsor"}
          </h2>
          {form.isTitle && (
            <span className="inline-flex items-center gap-1 border-2 border-black bg-neo-accent px-2 py-0.5 text-xs font-black uppercase">
              <Award className="h-3.5 w-3.5" /> Title Sponsor
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {/* Sponsor Name */}
          <label className="text-xs font-black uppercase tracking-wider">
            Sponsor / Brand Name
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
              placeholder="e.g. Apex Healthcare"
            />
          </label>

          {/* Category Tier */}
          <label className="text-xs font-black uppercase tracking-wider">
            Category Tier
            <div className="mt-1 flex gap-2">
              <input
                required
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full border-4 border-black bg-white px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="e.g. Title Sponsor"
                list="category-presets"
              />
              <datalist id="category-presets">
                {CATEGORY_PRESETS.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>
          </label>

          {/* Website URL (Hyperlink on Image) */}
          <label className="text-xs font-black uppercase tracking-wider">
            Website Hyperlink (Opened when image is clicked)
            <div className="relative mt-1">
              <input
                type="url"
                value={form.websiteUrl}
                onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
                className="w-full border-4 border-black bg-white px-3 py-2 pl-9 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="https://brand.com"
              />
              <LinkIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-black/50" />
            </div>
          </label>

          {/* Sort Order */}
          <label className="text-xs font-black uppercase tracking-wider">
            Sort Order (Lower appears first)
            <input
              type="number"
              min={0}
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
              className={inputClass}
            />
          </label>

          {/* Color Card Theme */}
          <label className="text-xs font-black uppercase tracking-wider">
            Card Accent Theme
            <select
              value={form.colorKey}
              onChange={(e) =>
                setForm({
                  ...form,
                  colorKey: e.target.value as "accent" | "secondary" | "muted" | "white",
                })
              }
              className={inputClass}
            >
              <option value="secondary">Neon Yellow (Secondary)</option>
              <option value="accent">Coral Red (Accent)</option>
              <option value="muted">Mint / Cyan (Muted)</option>
              <option value="white">Clean White</option>
            </select>
          </label>

          {/* Toggles */}
          <div className="flex flex-col justify-center gap-3 pt-3">
            <label className="flex items-center gap-2 text-xs font-black uppercase">
              <input
                type="checkbox"
                checked={form.isTitle}
                onChange={(e) => setForm({ ...form, isTitle: e.target.checked })}
                className="h-5 w-5 border-2 border-black"
              />
              ⭐ Title Sponsor (Spotlight Banner)
            </label>
            <label className="flex items-center gap-2 text-xs font-black uppercase">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="h-5 w-5 border-2 border-black"
              />
              Active on Public Site
            </label>
          </div>
        </div>

        {/* Tagline */}
        <label className="mt-4 block text-xs font-black uppercase tracking-wider">
          Tagline / Short Summary
          <textarea
            rows={2}
            value={form.tagline}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
            className={inputClass}
            placeholder="e.g. Leading healthcare technologies and surgical systems."
          />
        </label>

        {/* Image Upload & Logo URL Section */}
        <div className="mt-4 border-2 border-dashed border-black/40 bg-neo-cream p-4">
          <p className="text-xs font-black uppercase tracking-wider">
            Sponsor Logo Image (Clickable with Hyperlink)
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={handleFileUpload}
              className="hidden"
              id="sponsor-logo-upload"
            />
            <label
              htmlFor="sponsor-logo-upload"
              className="cursor-pointer inline-flex items-center gap-2 border-2 border-black bg-black px-3 py-2 text-xs font-black uppercase tracking-wider text-white shadow-neo-xs hover:bg-neo-accent hover:text-black"
            >
              <Upload className="h-4 w-4" />
              {isUploading ? "Uploading Image…" : "Upload Logo File"}
            </label>

            <span className="text-xs font-bold text-black/60">or enter image URL directly:</span>
          </div>

          <input
            value={form.logoUrl}
            onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
            className="mt-2 w-full border-2 border-black bg-white px-3 py-1.5 text-xs font-bold focus:outline-none"
            placeholder="https://... or /uploads/sponsors/..."
          />

          {uploadError && (
            <p className="mt-2 text-xs font-bold text-red-600">{uploadError}</p>
          )}

          {/* Live Preview of Uploaded Logo & Hyperlink */}
          {form.logoUrl && (
            <div className="mt-3 flex items-center gap-4 border-2 border-black bg-white p-3 shadow-neo-xs">
              {form.websiteUrl ? (
                <a
                  href={form.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative block h-16 w-28 shrink-0 overflow-hidden border-2 border-black bg-neo-cream"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.logoUrl}
                    alt="Logo preview"
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                  <span className="absolute bottom-1 right-1 bg-black p-0.5 text-white">
                    <ExternalLink className="h-2.5 w-2.5" />
                  </span>
                </a>
              ) : (
                <div className="h-16 w-28 shrink-0 overflow-hidden border-2 border-black bg-neo-cream">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.logoUrl}
                    alt="Logo preview"
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              <div className="space-y-0.5 text-xs">
                <p className="font-black uppercase">{form.name || "Brand Name"}</p>
                <p className="text-[11px] font-bold text-black/70">
                  {form.category} · {form.websiteUrl ? (
                    <a
                      href={form.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {form.websiteUrl}
                    </a>
                  ) : (
                    "No hyperlink set"
                  )}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Submit Buttons */}
        <div className="mt-5 flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={isUploading}>
            {editingId ? "Update Sponsor" : "Create Sponsor"}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" onClick={reset}>
              Cancel
            </Button>
          )}
        </div>

        {message && (
          <p className="mt-4 border-2 border-black bg-neo-secondary px-3 py-2 text-sm font-bold">
            {message}
          </p>
        )}
      </form>

      {/* Sponsors List */}
      <div className="mt-8 space-y-4">
        <h2 className="text-xl font-black uppercase tracking-tight">
          Current Festival Sponsors ({sponsors.length})
        </h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {sponsors.map((s) => (
            <div
              key={s.id}
              className={`flex flex-col justify-between border-4 border-black p-4 shadow-neo ${
                COLOR_MAP[s.colorKey || "secondary"]
              }`}
            >
              <div>
                <div className="flex items-center justify-between border-b-2 border-black/20 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="border-2 border-black bg-white px-2 py-0.5 text-[11px] font-black uppercase">
                      {s.category}
                    </span>
                    {s.isTitle && (
                      <span className="border-2 border-black bg-black px-2 py-0.5 text-[11px] font-black uppercase text-white">
                        ⭐ Title
                      </span>
                    )}
                  </div>
                  <span
                    className={`border-2 border-black px-2 py-0.5 text-[10px] font-black uppercase ${
                      s.isActive ? "bg-neo-secondary" : "bg-neo-accent"
                    }`}
                  >
                    {s.isActive ? "Active" : "Hidden"}
                  </span>
                </div>

                <div className="mt-3 flex items-start gap-3">
                  {/* Clickable hyperlinked image */}
                  {s.websiteUrl ? (
                    <a
                      href={s.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Visit ${s.name} (${s.websiteUrl})`}
                      className="group relative block h-16 w-24 shrink-0 overflow-hidden border-2 border-black bg-white shadow-neo-xs"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.logoUrl}
                        alt={s.name}
                        className="h-full w-full object-cover transition-transform duration-100 group-hover:scale-105"
                      />
                      <span className="absolute bottom-0 right-0 bg-black p-0.5 text-white">
                        <ExternalLink className="h-3 w-3" />
                      </span>
                    </a>
                  ) : (
                    <div className="h-16 w-24 shrink-0 overflow-hidden border-2 border-black bg-white shadow-neo-xs">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.logoUrl}
                        alt={s.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-lg font-black uppercase">{s.name}</h3>
                    <p className="line-clamp-2 text-xs font-bold text-black/80">
                      {s.tagline || "No description"}
                    </p>
                    {s.websiteUrl && (
                      <a
                        href={s.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-black uppercase underline hover:text-black/70"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Website Link
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t-2 border-black/20 pt-3">
                <span className="text-[10px] font-mono font-bold text-black/60">
                  Order: #{s.sortOrder} · v{s.version}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(s)}
                    className="border-2 border-black bg-white px-3 py-1 text-xs font-black uppercase shadow-neo-xs hover:bg-neo-secondary"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id, s.name)}
                    className="border-2 border-black bg-neo-accent p-1 text-black shadow-neo-xs hover:bg-red-600 hover:text-white"
                    title="Delete Sponsor"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {sponsors.length === 0 && (
          <div className="border-4 border-black bg-white p-8 text-center shadow-neo-sm">
            <ImageIcon className="mx-auto h-8 w-8 text-black/40" />
            <p className="mt-2 text-sm font-bold text-black/60">
              No sponsors configured yet. Fill out the form above to add your first partner.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
