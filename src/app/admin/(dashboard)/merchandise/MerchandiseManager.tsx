"use client";

import { useCallback, useEffect, useState } from "react";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  ShoppingBag,
  Plus,
  Trash2,
  Edit2,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  X,
} from "lucide-react";

interface AdminMerchandise {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  detailsMarkdown: string | null;
  category: string;
  pricePaise: number;
  images: string[];
  sizes: string[];
  stockUnits: number;
  heldUnits: number;
  confirmedUnits: number;
  availableUnits: number;
  salesState: "DRAFT" | "SCHEDULED" | "OPEN" | "PAUSED" | "SOLD_OUT" | "CLOSED" | "CANCELLED";
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  featured: boolean;
  sortOrder: number;
  version: number;
  createdAt: string;
}

const CATEGORY_PRESETS = [
  "Apparel",
  "Hoodies & Jackets",
  "T-Shirts & Polos",
  "Accessories",
  "Collectibles & Pins",
  "Drinkware & Bottles",
  "Limited Drop",
];

const EMPTY_FORM = {
  name: "",
  slug: "",
  tagline: "",
  description: "",
  detailsMarkdown: "",
  category: "Apparel",
  priceRupees: 999,
  images: [""],
  sizes: ["S", "M", "L", "XL", "XXL"],
  stockUnits: 100,
  salesState: "OPEN" as AdminMerchandise["salesState"],
  status: "PUBLISHED" as AdminMerchandise["status"],
  featured: false,
  sortOrder: 0,
};

const inputClass =
  "mt-1 block w-full border-2 border-black bg-white px-3 py-2 text-xs font-bold text-black shadow-neo-xs outline-none focus:bg-neo-cream";

export default function MerchandiseManager() {
  const [items, setItems] = useState<AdminMerchandise[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVersion, setEditingVersion] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [syncingSheets, setSyncingSheets] = useState(false);
  const [newSizeInput, setNewSizeInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/merchandise");
      const body = await res.json();
      if (body.ok) {
        setItems(body.data.merchandise);
      }
    } catch {
      setMessage({ type: "error", text: "Failed to load merchandise" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleNameChange(name: string) {
    if (!editingId) {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      setForm((prev) => ({ ...prev, name, slug }));
    } else {
      setForm((prev) => ({ ...prev, name }));
    }
  }

  function handleImageChange(index: number, value: string) {
    const updated = [...form.images];
    updated[index] = value;
    setForm({ ...form, images: updated });
  }

  function addImageField() {
    if (form.images.length < 10) {
      setForm({ ...form, images: [...form.images, ""] });
    }
  }

  function removeImageField(index: number) {
    if (form.images.length > 1) {
      const updated = form.images.filter((_, i) => i !== index);
      setForm({ ...form, images: updated });
    } else {
      setForm({ ...form, images: [""] });
    }
  }

  function addCustomSize(sizeToAdd?: string) {
    const target = (sizeToAdd ?? newSizeInput).trim();
    if (!target) return;
    if (!form.sizes.includes(target)) {
      setForm((prev) => ({ ...prev, sizes: [...prev.sizes, target] }));
    }
    if (!sizeToAdd) setNewSizeInput("");
  }

  function removeSize(sizeToRemove: string) {
    setForm((prev) => ({
      ...prev,
      sizes: prev.sizes.filter((s) => s !== sizeToRemove),
    }));
  }

  function openCreateModal() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setEditingVersion(0);
    setModalOpen(true);
    setMessage(null);
  }

  function openEditModal(item: AdminMerchandise) {
    setForm({
      name: item.name,
      slug: item.slug,
      tagline: item.tagline ?? "",
      description: item.description,
      detailsMarkdown: item.detailsMarkdown ?? "",
      category: item.category,
      priceRupees: Math.round(item.pricePaise / 100),
      images: item.images && item.images.length > 0 ? item.images : [""],
      sizes: item.sizes && item.sizes.length > 0 ? item.sizes : ["S", "M", "L", "XL", "XXL"],
      stockUnits: item.stockUnits,
      salesState: item.salesState,
      status: item.status,
      featured: item.featured,
      sortOrder: item.sortOrder,
    });
    setEditingId(item.id);
    setEditingVersion(item.version);
    setModalOpen(true);
    setMessage(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const validImages = form.images.map((img) => img.trim()).filter(Boolean);
    if (validImages.length === 0) {
      setMessage({ type: "error", text: "Please provide at least 1 image URL (recommended: 4-5 images)." });
      return;
    }

    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim().toLowerCase(),
        tagline: form.tagline.trim(),
        description: form.description.trim(),
        detailsMarkdown: form.detailsMarkdown.trim() || null,
        category: form.category,
        priceRupees: Number(form.priceRupees),
        images: validImages,
        sizes: form.sizes.length > 0 ? form.sizes : ["Standard"],
        stockUnits: Number(form.stockUnits),
        salesState: form.salesState,
        status: form.status,
        featured: form.featured,
        sortOrder: Number(form.sortOrder),
        version: editingVersion,
      };

      const url = editingId ? `/api/admin/merchandise/${editingId}` : "/api/admin/merchandise";
      const method = editingId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.message || "Failed to save merchandise product");
      }

      setMessage({
        type: "success",
        text: editingId ? "Merchandise updated successfully!" : "Merchandise created successfully!",
      });
      setModalOpen(false);
      await load();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Error saving merchandise product",
      });
    }
  }

  async function triggerGoogleSheetsSync() {
    setSyncingSheets(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/exports/sheets-sync", { method: "POST" });
      const body = await res.json();
      if (body.ok) {
        setMessage({
          type: "success",
          text: `Google Sheets sync executed (${body.data?.syncedOrders ?? 0} orders processed).`,
        });
      } else {
        throw new Error(body.message || "Sync failed");
      }
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to sync with Google Sheets",
      });
    } finally {
      setSyncingSheets(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-4 border-black bg-white p-6 shadow-neo">
        <div>
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-6 w-6 text-black" />
            <h1 className="text-2xl font-black uppercase tracking-tight">Merchandise Catalog</h1>
          </div>
          <p className="mt-1 text-xs font-bold text-black/70">
            Manage festival apparel, multi-image product drops, inventory stock, and Google Sheets order mirrors.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={triggerGoogleSheetsSync}
            disabled={syncingSheets}
            className="flex items-center gap-2 text-xs"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {syncingSheets ? "Syncing Sheets…" : "Sync Google Sheets"}
          </Button>

          <Button variant="primary" onClick={openCreateModal} className="flex items-center gap-2 text-xs">
            <Plus className="h-4 w-4" />
            Add Merchandise
          </Button>
        </div>
      </div>

      {/* Status Notifications */}
      {message && (
        <div
          className={`flex items-center gap-2 border-4 border-black p-4 text-xs font-black uppercase ${
            message.type === "success" ? "bg-neo-accent text-black" : "bg-red-200 text-red-900"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            <AlertTriangle className="h-5 w-5" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Items Table */}
      <div className="border-4 border-black bg-white shadow-neo overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm font-black uppercase tracking-widest text-black/60">
            Loading merchandise…
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <ShoppingBag className="mx-auto h-12 w-12 text-black/40" />
            <div className="text-base font-black uppercase">No merchandise products found</div>
            <p className="text-xs font-bold text-black/60">
              Click &quot;Add Merchandise&quot; to create your first official drop product.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b-4 border-black bg-neo-cream font-black uppercase text-black">
                <tr>
                  <th className="p-3">Item / Gallery</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Price</th>
                  <th className="p-3">Stock & Sold</th>
                  <th className="p-3">Sizes</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-black font-bold">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-neo-cream/40 transition-colors">
                    {/* Item & Image preview */}
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="relative h-14 w-14 shrink-0 overflow-hidden border-2 border-black bg-neo-cream">
                          {item.images?.[0] ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={item.images[0]}
                              alt={item.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <ImageIcon className="h-6 w-6 m-auto text-black/40" />
                          )}
                          {item.images && item.images.length > 1 && (
                            <span className="absolute bottom-0 right-0 border-t border-l border-black bg-black px-1 text-[9px] font-black text-white">
                              +{item.images.length - 1}
                            </span>
                          )}
                        </div>
                        <div>
                          <div className="font-black uppercase text-sm text-black flex items-center gap-1.5">
                            {item.name}
                            {item.featured && (
                              <span className="border border-black bg-neo-accent px-1.5 py-0.2 text-[9px] font-black">
                                DROP
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[10px] text-black/60">/{item.slug}</span>
                        </div>
                      </div>
                    </td>

                    {/* Category */}
                    <td className="p-3">
                      <span className="border border-black bg-neo-secondary px-2 py-0.5 text-[10px] font-black uppercase">
                        {item.category}
                      </span>
                    </td>

                    {/* Price */}
                    <td className="p-3 font-black text-sm">
                      {formatPaise(item.pricePaise)}
                    </td>

                    {/* Stock */}
                    <td className="p-3">
                      <div className="space-y-0.5">
                        <span className="font-black text-black">{item.availableUnits} Available</span>
                        <div className="text-[10px] text-black/60 font-bold">
                          {item.confirmedUnits} Confirmed · {item.heldUnits} Held (Total: {item.stockUnits})
                        </div>
                      </div>
                    </td>

                    {/* Sizes */}
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1 max-w-[160px]">
                        {item.sizes?.map((s) => (
                          <span key={s} className="border border-black bg-white px-1 text-[9px] font-black">
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="p-3">
                      <div className="flex flex-col gap-1">
                        <Badge
                          variant={item.status === "PUBLISHED" ? "accent" : "black"}
                          className="w-fit text-[10px]"
                        >
                          {item.status}
                        </Badge>
                        <span className="text-[10px] font-black uppercase text-black/60">
                          {item.salesState}
                        </span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEditModal(item)}
                        className="border-2 border-black bg-white p-1.5 shadow-neo-xs hover:bg-neo-accent transition-colors"
                        aria-label="Edit product"
                      >
                        <Edit2 className="h-4 w-4 text-black" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6 backdrop-blur-sm animate-in fade-in overflow-y-auto">
          <div className="relative my-auto w-full max-w-3xl border-8 border-black bg-white shadow-neo-xl overflow-hidden max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b-4 border-black bg-neo-cream p-4">
              <div className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5" />
                <h2 className="text-lg font-black uppercase tracking-tight">
                  {editingId ? "Edit Merchandise Product" : "Create New Merchandise Product"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="border-2 border-black bg-white p-1 hover:bg-neo-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block text-xs font-black uppercase">
                  Product Name *
                  <input
                    required
                    type="text"
                    value={form.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    className={inputClass}
                    placeholder="e.g. TARANG ’27 Heavyweight Hoodie"
                  />
                </label>

                <label className="block text-xs font-black uppercase">
                  URL Slug *
                  <input
                    required
                    type="text"
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    className={inputClass}
                    placeholder="e.g. tarang-27-heavyweight-hoodie"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <label className="block text-xs font-black uppercase">
                  Category
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className={inputClass}
                  >
                    {CATEGORY_PRESETS.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-black uppercase">
                  Price in Rupees (₹) *
                  <input
                    required
                    type="number"
                    min="0"
                    step="1"
                    value={form.priceRupees}
                    onChange={(e) => setForm({ ...form, priceRupees: Number(e.target.value) })}
                    className={inputClass}
                  />
                </label>

                <label className="block text-xs font-black uppercase">
                  Total Stock Units *
                  <input
                    required
                    type="number"
                    min="0"
                    value={form.stockUnits}
                    onChange={(e) => setForm({ ...form, stockUnits: Number(e.target.value) })}
                    className={inputClass}
                  />
                </label>
              </div>

              {/* 4-5 Images Input with Live Square Previews */}
              <div className="border-2 border-black bg-neo-cream p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-black">
                    Product Image URLs (4-5 High-Res Images Recommended)
                  </span>
                  {form.images.length < 10 && (
                    <button
                      type="button"
                      onClick={addImageField}
                      className="flex items-center gap-1 border border-black bg-white px-2 py-1 text-[10px] font-black uppercase hover:bg-neo-accent"
                    >
                      <Plus className="h-3 w-3" /> Add Image URL
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {form.images.map((imgUrl, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs font-black text-black/60 w-5">#{idx + 1}</span>
                      <input
                        type="url"
                        value={imgUrl}
                        onChange={(e) => handleImageChange(idx, e.target.value)}
                        placeholder={`https://images.unsplash.com/... (Image ${idx + 1})`}
                        className="flex-1 border-2 border-black bg-white px-3 py-1.5 text-xs font-bold outline-none focus:bg-neo-cream"
                      />
                      <button
                        type="button"
                        onClick={() => removeImageField(idx)}
                        className="border-2 border-black bg-white p-1.5 hover:bg-red-200"
                        aria-label="Remove image"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-black" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Live Previews Grid */}
                <div className="flex flex-wrap gap-3 pt-2">
                  {form.images
                    .filter((url) => url.trim() !== "")
                    .map((url, idx) => (
                      <div
                        key={idx}
                        className="relative h-16 w-16 overflow-hidden border-2 border-black bg-white shadow-neo-xs"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url.trim()}
                          alt={`Preview ${idx + 1}`}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
                          }}
                        />
                        <span className="absolute bottom-0 right-0 bg-black px-1 text-[8px] font-black text-white">
                          #{idx + 1}
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Dynamic Size Variants Manager */}
              <div className="border-2 border-black bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-black block">
                    Product Size Variants & Options (Admin Defined)
                  </span>
                  <span className="text-[10px] font-bold text-black/60">
                    {form.sizes.length} variant{form.sizes.length === 1 ? "" : "s"} configured
                  </span>
                </div>

                {/* Active Size Pills with delete button */}
                <div className="flex flex-wrap gap-2 min-h-[32px] p-2 border-2 border-dashed border-black/30 bg-neo-cream/30 items-center">
                  {form.sizes.length > 0 ? (
                    form.sizes.map((size) => (
                      <span
                        key={size}
                        className="inline-flex items-center gap-1.5 border-2 border-black bg-white px-2.5 py-1 text-xs font-black uppercase text-black shadow-neo-xs"
                      >
                        {size}
                        <button
                          type="button"
                          onClick={() => removeSize(size)}
                          className="hover:text-red-600 transition-colors p-0.5"
                          aria-label={`Remove size ${size}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="text-xs font-bold text-black/50 italic">
                      No size variants added (will default to &quot;Standard&quot;).
                    </span>
                  )}
                </div>

                {/* Add Custom Size Input */}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    placeholder="Enter custom size or variant (e.g. S, XL, Oversized, 500ml, One Size)"
                    value={newSizeInput}
                    onChange={(e) => setNewSizeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomSize();
                      }
                    }}
                    className="flex-1 border-2 border-black bg-white px-3 py-1.5 text-xs font-bold outline-none focus:bg-neo-cream"
                  />
                  <button
                    type="button"
                    onClick={() => addCustomSize()}
                    className="flex items-center gap-1 border-2 border-black bg-neo-accent px-3 py-1.5 text-xs font-black uppercase shadow-neo-xs hover:-translate-y-0.5 transition-transform"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Variant
                  </button>
                </div>

                {/* Quick Suggestion Pills */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] font-black uppercase text-black/60 mr-1">Quick Add:</span>
                  {["XS", "S", "M", "L", "XL", "XXL", "3XL", "One Size", "Free Size", "Standard"].map((sugg) => (
                    <button
                      key={sugg}
                      type="button"
                      onClick={() => addCustomSize(sugg)}
                      disabled={form.sizes.includes(sugg)}
                      className={`border border-black px-2 py-0.5 text-[10px] font-black uppercase transition-all ${
                        form.sizes.includes(sugg)
                          ? "bg-black/10 text-black/40 cursor-not-allowed border-dashed"
                          : "bg-neo-cream text-black hover:bg-white cursor-pointer"
                      }`}
                    >
                      + {sugg}
                    </button>
                  ))}
                </div>
              </div>

              {/* Descriptions */}
              <label className="block text-xs font-black uppercase">
                Product Description (3-4 Lines) *
                <textarea
                  required
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={inputClass}
                  placeholder="Heavyweight 380 GSM fleece hoodie with custom puff-print typography and distressed vintage wash. Built for comfort through late-night pro-shows and cool campus winds."
                />
              </label>

              <label className="block text-xs font-black uppercase">
                Specifications & Details (Markdown)
                <textarea
                  rows={2}
                  value={form.detailsMarkdown}
                  onChange={(e) => setForm({ ...form, detailsMarkdown: e.target.value })}
                  className={inputClass}
                  placeholder="100% French Terry Cotton · Preshrunk · Unisex Relaxed Fit · Screenprinted Chest & Back"
                />
              </label>

              {/* Status & Options */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t-2 border-black pt-3">
                <label className="block text-xs font-black uppercase">
                  Sales State
                  <select
                    value={form.salesState}
                    onChange={(e) => setForm({ ...form, salesState: e.target.value as AdminMerchandise["salesState"] })}
                    className={inputClass}
                  >
                    <option value="OPEN">OPEN</option>
                    <option value="PAUSED">PAUSED</option>
                    <option value="CLOSED">CLOSED</option>
                    <option value="SOLD_OUT">SOLD_OUT</option>
                  </select>
                </label>

                <label className="block text-xs font-black uppercase">
                  Catalog Status
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as AdminMerchandise["status"] })}
                    className={inputClass}
                  >
                    <option value="PUBLISHED">PUBLISHED</option>
                    <option value="DRAFT">DRAFT</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                </label>

                <div className="flex items-center gap-3 pt-5">
                  <label className="flex items-center gap-2 text-xs font-black uppercase cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.featured}
                      onChange={(e) => setForm({ ...form, featured: e.target.checked })}
                      className="h-4 w-4 border-2 border-black"
                    />
                    Featured / Drop Highlight
                  </label>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="border-t-4 border-black pt-4 flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  {editingId ? "Save Changes" : "Create Product"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
