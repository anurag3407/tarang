"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatPaise } from "@/lib/money";
import PassPricingManager from "./PassPricingManager";

/**
 * Admin events manager (plan §11.6).
 *
 * Full event lifecycle: List with pagination/search, create new event,
 * edit event details with optimistic `version`, update price version with reason,
 * update capacity with safety checks, and publish event.
 */

interface AdminEvent {
  id: string;
  slug: string;
  name: string;
  status: string;
  salesState: string;
  featured: boolean;
  imageUrl: string | null;
  version: number;
  startsAt: string;
  registrationMode: string;
  capacityBasis: string;
  priceBasis: string;
  categoryName: string;
  amountPaise: number;
  inventory: {
    capacityUnits: number;
    heldUnits: number;
    confirmedUnits: number;
  } | null;
}

interface CategoryOption {
  id: string;
  name: string;
  slug: string;
}

interface VenueOption {
  id: string;
  name: string;
  shortName: string | null;
}

interface EventFormData {
  name: string;
  slug: string;
  categoryId: string;
  venueId: string;
  shortDescription: string;
  description: string;
  rulesMarkdown: string;
  startsAt: string;
  endsAt: string;
  registrationMode: "INDIVIDUAL" | "TEAM";
  capacityBasis: "PARTICIPANT" | "TEAM";
  priceBasis: "PARTICIPANT" | "REGISTRATION";
  minTeamSize: number;
  maxTeamSize: number;
  capacityUnits: number;
  priceRupees: number;
  prizePoolText: string;
  imageUrl: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  featured: boolean;
  includeInSchedule: boolean;
  isNightEvent: boolean;
}

const DEFAULT_FORM: EventFormData = {
  name: "",
  slug: "",
  categoryId: "",
  venueId: "",
  shortDescription: "",
  description: "",
  rulesMarkdown: "",
  startsAt: "",
  endsAt: "",
  registrationMode: "INDIVIDUAL",
  capacityBasis: "PARTICIPANT",
  priceBasis: "PARTICIPANT",
  minTeamSize: 1,
  maxTeamSize: 1,
  capacityUnits: 100,
  priceRupees: 0,
  prizePoolText: "",
  imageUrl: "",
  registrationOpensAt: "",
  registrationClosesAt: "",
  featured: false,
  includeInSchedule: true,
  isNightEvent: false,
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function EventsManager() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (search) params.set("q", search);
      const res = await fetch(`/api/admin/events?${params}`);
      const body = await res.json();
      if (!body.ok) throw new Error(body.message ?? "Could not load events");
      setEvents(body.data.events);
      setTotal(body.data.total);
      if (body.data.categories) setCategories(body.data.categories);
      if (body.data.venues) setVenues(body.data.venues);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load events");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const [activeTab, setActiveTab] = useState<"events" | "passes">("events");

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex border-b-4 border-black">
        <button
          type="button"
          onClick={() => setActiveTab("events")}
          className={`border-t-4 border-l-4 border-r-4 border-black px-6 py-3 text-sm font-black uppercase tracking-wider transition-colors ${
            activeTab === "events"
              ? "bg-neo-secondary text-black shadow-neo-sm"
              : "bg-white text-black/60 hover:bg-neo-cream"
          }`}
        >
          Events Catalog ({total})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("passes")}
          className={`border-t-4 border-l-4 border-r-4 border-black px-6 py-3 text-sm font-black uppercase tracking-wider transition-colors ${
            activeTab === "passes"
              ? "bg-neo-secondary text-black shadow-neo-sm"
              : "bg-white text-black/60 hover:bg-neo-cream"
          }`}
        >
          Festival Passes &amp; Dynamic Pricing
        </button>
      </div>

      {activeTab === "passes" ? (
        <PassPricingManager />
      ) : (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <h1 className="text-3xl font-black uppercase tracking-tighter">Events</h1>
              <Button
                variant="primary"
                onClick={() => setShowCreateModal(true)}
                className="text-xs"
              >
                + Add Event
              </Button>
            </div>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search events…"
              className="border-4 border-black bg-white px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>

      {error && (
        <p className="mt-4 border-4 border-black bg-neo-accent p-3 font-bold">{error}</p>
      )}

      {loading ? (
        <p className="mt-8 text-center font-bold text-black/60">Loading…</p>
      ) : (
        <div className="mt-6 overflow-x-auto border-4 border-black bg-white shadow-neo">
          <table className="w-full text-left text-sm">
            <thead className="border-b-4 border-black bg-neo-secondary">
              <tr>
                <th className="px-3 py-2 font-black uppercase">Event</th>
                <th className="px-3 py-2 font-black uppercase">Category</th>
                <th className="px-3 py-2 font-black uppercase">Status</th>
                <th className="px-3 py-2 font-black uppercase">Price</th>
                <th className="px-3 py-2 font-black uppercase">Capacity</th>
                <th className="px-3 py-2 font-black uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b-2 border-black/20">
                  <td className="px-3 py-2 font-bold">
                    <div className="flex items-center gap-2.5">
                      {e.imageUrl ? (
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden border-2 border-black bg-neo-cream">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={e.imageUrl}
                            alt={e.name}
                            className="h-full w-full object-cover"
                            onError={(ev) => {
                              (ev.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        </div>
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-black bg-neo-cream text-[10px] font-black text-black/40">
                          NO IMG
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span>{e.name}</span>
                          {e.featured && <span className="text-xs text-neo-accent" title="Featured">★</span>}
                        </div>
                        <span className="text-xs text-black/50">{e.slug}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">{e.categoryName}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`border-2 border-black px-2 py-0.5 text-xs font-black uppercase ${
                        e.status === "PUBLISHED" ? "bg-neo-secondary text-black" : "bg-neo-muted text-black/70"
                      }`}
                    >
                      {e.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-bold">{formatPaise(e.amountPaise)}</td>
                  <td className="px-3 py-2">
                    {e.inventory
                      ? `${e.inventory.confirmedUnits + e.inventory.heldUnits}/${e.inventory.capacityUnits}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setEditingId(e.id)}
                      className="border-2 border-black bg-white px-2 py-1 text-xs font-black uppercase hover:bg-neo-secondary"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center font-bold text-black/50">
                    No events found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm font-bold text-black/60">{total} total</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Prev
          </Button>
          <Button variant="outline" onClick={() => setPage((p) => p + 1)} disabled={events.length < 20}>
            Next
          </Button>
        </div>
      </div>

      {showCreateModal && (
        <CreateEventModal
          categories={categories}
          venues={venues}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            void load();
          }}
        />
      )}

      {editingId && (
        <EventEditor
          eventId={editingId}
          categories={categories}
          venues={venues}
          onClose={() => {
            setEditingId(null);
            void load();
          }}
        />
      )}
    </div>
  )}
</div>
  );
}

function CreateEventModal({
  categories,
  venues,
  onClose,
  onSuccess,
}: {
  categories: CategoryOption[];
  venues: VenueOption[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<EventFormData>(() => ({
    ...DEFAULT_FORM,
    categoryId: categories[0]?.id ?? "",
  }));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!form.categoryId && categories.length > 0) {
      setForm((prev) => ({ ...prev, categoryId: categories[0].id }));
    }
  }, [categories, form.categoryId]);

  function handleNameChange(name: string) {
    setForm((prev) => ({
      ...prev,
      name,
      slug: slugify(name),
    }));
  }

  function handleRegistrationMode(mode: "INDIVIDUAL" | "TEAM") {
    setForm((prev) => ({
      ...prev,
      registrationMode: mode,
      minTeamSize: mode === "INDIVIDUAL" ? 1 : Math.max(2, prev.minTeamSize),
      maxTeamSize: mode === "INDIVIDUAL" ? 1 : Math.max(2, prev.maxTeamSize),
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");

    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim().toLowerCase(),
      categoryId: form.categoryId,
      venueId: form.venueId || null,
      shortDescription: form.shortDescription.trim(),
      description: form.description.trim(),
      rulesMarkdown: form.rulesMarkdown.trim() || null,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      registrationMode: form.registrationMode,
      capacityBasis: form.capacityBasis,
      priceBasis: form.priceBasis,
      minTeamSize: form.registrationMode === "INDIVIDUAL" ? 1 : Number(form.minTeamSize),
      maxTeamSize: form.registrationMode === "INDIVIDUAL" ? 1 : Number(form.maxTeamSize),
      capacityUnits: Number(form.capacityUnits),
      priceRupees: Number(form.priceRupees),
      prizePoolText: form.prizePoolText.trim(),
      imageUrl: form.imageUrl.trim() || null,
      registrationOpensAt: form.registrationOpensAt ? new Date(form.registrationOpensAt).toISOString() : null,
      registrationClosesAt: form.registrationClosesAt ? new Date(form.registrationClosesAt).toISOString() : null,
      featured: form.featured,
      includeInSchedule: form.includeInSchedule,
      isNightEvent: form.isNightEvent,
      version: 0,
    };

    try {
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (body.ok) {
        onSuccess();
      } else {
        setMessage(body.message ?? "Failed to create event");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 w-full border-4 border-black bg-white px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-black";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
      <div className="my-8 max-h-[90vh] w-full max-w-3xl overflow-y-auto border-8 border-black bg-neo-cream p-6 shadow-neo-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black uppercase tracking-tight">Add New Event</h2>
          <button onClick={onClose} className="text-sm font-black uppercase underline">
            Close
          </button>
        </div>

        {message && (
          <p className="mt-4 border-4 border-black bg-neo-accent p-3 font-bold text-black">{message}</p>
        )}

        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-black uppercase">
              Event Name *
              <input
                required
                value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
                className={inputClass}
                placeholder="Robotics Clash"
              />
            </label>

            <label className="text-xs font-black uppercase">
              Slug *
              <input
                required
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                className={inputClass}
                placeholder="robotics-clash"
              />
            </label>

            <label className="text-xs font-black uppercase">
              Category *
              <select
                required
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                className={inputClass}
              >
                {categories.length === 0 ? (
                  <option value="">No categories found</option>
                ) : (
                  <>
                    {!form.categoryId && <option value="">Select a Category</option>}
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </label>

            <label className="text-xs font-black uppercase">
              Venue (optional)
              <select
                value={form.venueId}
                onChange={(e) => setForm({ ...form, venueId: e.target.value })}
                className={inputClass}
              >
                <option value="">No Venue Selected</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-black uppercase">
              Starts At *
              <input
                required
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                className={inputClass}
              />
            </label>

            <label className="text-xs font-black uppercase">
              Ends At *
              <input
                required
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                className={inputClass}
              />
            </label>

            <label className="text-xs font-black uppercase">
              Price (₹) *
              <input
                required
                type="number"
                min="0"
                step="any"
                value={form.priceRupees}
                onChange={(e) => setForm({ ...form, priceRupees: Number(e.target.value) })}
                className={inputClass}
              />
            </label>

            <label className="text-xs font-black uppercase">
              Capacity Units *
              <input
                required
                type="number"
                min="1"
                value={form.capacityUnits}
                onChange={(e) => setForm({ ...form, capacityUnits: Number(e.target.value) })}
                className={inputClass}
              />
            </label>

            <label className="text-xs font-black uppercase">
              Registration Mode *
              <select
                value={form.registrationMode}
                onChange={(e) => handleRegistrationMode(e.target.value as "INDIVIDUAL" | "TEAM")}
                className={inputClass}
              >
                <option value="INDIVIDUAL">Individual</option>
                <option value="TEAM">Team</option>
              </select>
            </label>

            <label className="text-xs font-black uppercase">
              Prize Pool Text
              <input
                value={form.prizePoolText}
                onChange={(e) => setForm({ ...form, prizePoolText: e.target.value })}
                className={inputClass}
                placeholder="₹50,000 in Prizes"
              />
            </label>

            {form.registrationMode === "TEAM" && (
              <>
                <label className="text-xs font-black uppercase">
                  Min Team Size *
                  <input
                    required
                    type="number"
                    min="1"
                    max="100"
                    value={form.minTeamSize}
                    onChange={(e) => setForm({ ...form, minTeamSize: Number(e.target.value) })}
                    className={inputClass}
                  />
                </label>
                <label className="text-xs font-black uppercase">
                  Max Team Size *
                  <input
                    required
                    type="number"
                    min="1"
                    max="100"
                    value={form.maxTeamSize}
                    onChange={(e) => setForm({ ...form, maxTeamSize: Number(e.target.value) })}
                    className={inputClass}
                  />
                </label>
              </>
            )}

            <label className="text-xs font-black uppercase">
              Registration Opens At
              <input
                type="datetime-local"
                value={form.registrationOpensAt}
                onChange={(e) => setForm({ ...form, registrationOpensAt: e.target.value })}
                className={inputClass}
              />
            </label>

            <label className="text-xs font-black uppercase">
              Registration Closes At
              <input
                type="datetime-local"
                value={form.registrationClosesAt}
                onChange={(e) => setForm({ ...form, registrationClosesAt: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>

          <div>
            <label className="block text-xs font-black uppercase">
              Event Poster Image URL (Instagram Post 1:1 Ratio)
              <input
                type="url"
                value={form.imageUrl}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                className={inputClass}
                placeholder="https://images.unsplash.com/... or poster image URL"
              />
            </label>
            {form.imageUrl.trim() && (
              <div className="mt-2 flex items-center gap-4 border-2 border-black bg-white p-3">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden border-2 border-black bg-neo-cream">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.imageUrl.trim()}
                    alt="Instagram Post Preview"
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
                <div>
                  <span className="text-xs font-black uppercase tracking-wider text-black">Instagram Post Preview (1:1 Square)</span>
                  <p className="text-xs font-bold text-black/60">This poster image will be displayed on event cards in Instagram post aspect ratio.</p>
                </div>
              </div>
            )}
          </div>

          <label className="block text-xs font-black uppercase">
            Short Description (10-300 chars) *
            <input
              required
              minLength={10}
              maxLength={300}
              value={form.shortDescription}
              onChange={(e) => setForm({ ...form, shortDescription: e.target.value })}
              className={inputClass}
              placeholder="High-intensity combat robotics championship."
            />
          </label>

          <label className="block text-xs font-black uppercase">
            Full Description (markdown) *
            <textarea
              required
              minLength={10}
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className={inputClass}
              placeholder="Detailed rules, eligibility, criteria, format..."
            />
          </label>

          <label className="block text-xs font-black uppercase">
            Rules Markdown (optional)
            <textarea
              rows={3}
              value={form.rulesMarkdown}
              onChange={(e) => setForm({ ...form, rulesMarkdown: e.target.value })}
              className={inputClass}
              placeholder="Safety guidelines, weight constraints..."
            />
          </label>

          <div className="flex flex-wrap gap-4 pt-2">
            <label className="flex items-center gap-2 text-xs font-black uppercase">
              <input
                type="checkbox"
                checked={form.featured}
                onChange={(e) => setForm({ ...form, featured: e.target.checked })}
                className="h-5 w-5 border-2 border-black"
              />
              Featured Event
            </label>

            <label className="flex items-center gap-2 text-xs font-black uppercase">
              <input
                type="checkbox"
                checked={form.includeInSchedule}
                onChange={(e) => setForm({ ...form, includeInSchedule: e.target.checked })}
                className="h-5 w-5 border-2 border-black"
              />
              Include in Schedule
            </label>

            <label className="flex items-center gap-2 text-xs font-black uppercase">
              <input
                type="checkbox"
                checked={form.isNightEvent}
                onChange={(e) => setForm({ ...form, isNightEvent: e.target.checked })}
                className="h-5 w-5 border-2 border-black"
              />
              Night Event (🌙)
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t-4 border-black">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creating…" : "Create Event"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EventEditor({
  eventId,
  categories,
  venues,
  onClose,
}: {
  eventId: string;
  categories: CategoryOption[];
  venues: VenueOption[];
  onClose: () => void;
}) {
  const [event, setEvent] = useState<Record<string, unknown> | null>(null);
  const [price, setPrice] = useState("");
  const [priceReason, setPriceReason] = useState("");
  const [capacity, setCapacity] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [detailsForm, setDetailsForm] = useState<EventFormData>(DEFAULT_FORM);

  const fetchEvent = useCallback(async () => {
    const res = await fetch(`/api/admin/events/${eventId}`);
    const body = await res.json();
    if (body.ok) {
      const e = body.data.event;
      setEvent(e);
      setPrice(String(e.amountPaise / 100));
      setCapacity(String(e.inventory?.capacityUnits ?? ""));
      setDetailsForm({
        name: e.name ?? "",
        slug: e.slug ?? "",
        categoryId: e.categoryId ?? "",
        venueId: e.venueId ?? "",
        shortDescription: e.shortDescription ?? "",
        description: e.description ?? "",
        rulesMarkdown: e.rulesMarkdown ?? "",
        startsAt: e.startsAt ? e.startsAt.slice(0, 16) : "",
        endsAt: e.endsAt ? e.endsAt.slice(0, 16) : "",
        registrationMode: e.registrationMode ?? "INDIVIDUAL",
        capacityBasis: e.capacityBasis ?? "PARTICIPANT",
        priceBasis: e.priceBasis ?? "PARTICIPANT",
        minTeamSize: e.minTeamSize ?? 1,
        maxTeamSize: e.maxTeamSize ?? 1,
        capacityUnits: e.inventory?.capacityUnits ?? 100,
        priceRupees: e.amountPaise / 100,
        prizePoolText: e.prizePoolText ?? "",
        imageUrl: e.imageUrl ?? "",
        registrationOpensAt: e.registrationOpensAt ? e.registrationOpensAt.slice(0, 16) : "",
        registrationClosesAt: e.registrationClosesAt ? e.registrationClosesAt.slice(0, 16) : "",
        featured: Boolean(e.featured),
        includeInSchedule: Boolean(e.includeInSchedule ?? true),
        isNightEvent: Boolean(e.isNightEvent),
      });
    } else {
      setMessage(body.message ?? "Could not load event");
    }
  }, [eventId]);

  useEffect(() => {
    void fetchEvent();
  }, [fetchEvent]);

  async function publish() {
    setBusy(true);
    setMessage("");
    const res = await fetch(`/api/admin/events/${eventId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const body = await res.json();
    setMessage(body.ok ? "Published successfully!" : body.message ?? "Publish failed");
    if (body.ok) await fetchEvent();
    setBusy(false);
  }

  async function unpublish() {
    setBusy(true);
    setMessage("");
    const res = await fetch(`/api/admin/events/${eventId}/unpublish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const body = await res.json();
    setMessage(body.ok ? "Unpublished successfully (reverted to Draft)." : body.message ?? "Unpublish failed");
    if (body.ok) await fetchEvent();
    setBusy(false);
  }

  async function updateEventDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!event) return;
    setBusy(true);
    setMessage("");

    const payload = {
      name: detailsForm.name.trim(),
      slug: detailsForm.slug.trim().toLowerCase(),
      categoryId: detailsForm.categoryId,
      venueId: detailsForm.venueId || null,
      shortDescription: detailsForm.shortDescription.trim(),
      description: detailsForm.description.trim(),
      rulesMarkdown: detailsForm.rulesMarkdown.trim() || null,
      startsAt: new Date(detailsForm.startsAt).toISOString(),
      endsAt: new Date(detailsForm.endsAt).toISOString(),
      registrationMode: detailsForm.registrationMode,
      capacityBasis: detailsForm.capacityBasis,
      priceBasis: detailsForm.priceBasis,
      minTeamSize: detailsForm.registrationMode === "INDIVIDUAL" ? 1 : Number(detailsForm.minTeamSize),
      maxTeamSize: detailsForm.registrationMode === "INDIVIDUAL" ? 1 : Number(detailsForm.maxTeamSize),
      capacityUnits: Number(capacity || detailsForm.capacityUnits),
      priceRupees: Number(price || detailsForm.priceRupees),
      prizePoolText: detailsForm.prizePoolText.trim(),
      imageUrl: detailsForm.imageUrl.trim() || null,
      registrationOpensAt: detailsForm.registrationOpensAt ? new Date(detailsForm.registrationOpensAt).toISOString() : null,
      registrationClosesAt: detailsForm.registrationClosesAt ? new Date(detailsForm.registrationClosesAt).toISOString() : null,
      featured: detailsForm.featured,
      includeInSchedule: detailsForm.includeInSchedule,
      isNightEvent: detailsForm.isNightEvent,
      version: event.version,
    };

    const res = await fetch(`/api/admin/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (body.ok) {
      setMessage("Event details updated.");
      await fetchEvent();
    } else {
      setMessage(body.code === "VERSION_CONFLICT" ? "Event changed elsewhere — reload." : body.message ?? "Update failed");
    }
    setBusy(false);
  }

  async function changePrice() {
    if (!event) return;
    setBusy(true);
    setMessage("");
    const res = await fetch(`/api/admin/events/${eventId}/price`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        priceRupees: Number(price),
        reason: priceReason,
        version: event.version,
      }),
    });
    const body = await res.json();
    if (body.ok) {
      setMessage("Price updated (new version created).");
      setEvent({ ...event, version: (event.version as number) + 1 });
      setPriceReason("");
    } else {
      setMessage(body.code === "VERSION_CONFLICT" ? "Event changed elsewhere — reload." : body.message);
    }
    setBusy(false);
  }

  async function changeCapacity() {
    if (!event) return;
    setBusy(true);
    setMessage("");
    const res = await fetch(`/api/admin/events/${eventId}/capacity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capacityUnits: Number(capacity),
        version: event.version,
      }),
    });
    const body = await res.json();
    if (body.ok) {
      setMessage("Capacity updated.");
      setEvent({ ...event, version: (event.version as number) + 1 });
    } else {
      setMessage(body.message ?? "Capacity change failed");
    }
    setBusy(false);
  }

  if (!event) {
    return (
      <div className="mt-6 border-4 border-black bg-white p-6 shadow-neo">
        <p className="font-bold text-black/60">{message || "Loading…"}</p>
      </div>
    );
  }

  const inputClass =
    "mt-1 w-full border-4 border-black bg-white px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-black";

  return (
    <div className="mt-6 border-8 border-black bg-white p-6 shadow-neo-lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight">
            {String(event.name)} <span className="text-sm text-black/50">v{String(event.version)}</span>
          </h2>
          <span
            className={`border-2 border-black px-2 py-0.5 text-xs font-black uppercase ${
              event.status === "PUBLISHED" ? "bg-neo-secondary text-black" : "bg-neo-muted text-black/70"
            }`}
          >
            Status: {String(event.status)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {event.status === "PUBLISHED" ? (
            <Button
              variant="outline"
              onClick={unpublish}
              disabled={busy}
              className="border-2 border-black bg-neo-accent text-black font-black uppercase text-xs hover:bg-neo-accent/80"
            >
              Unpublish Event (Draft)
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={publish}
              disabled={busy}
              className="text-xs"
            >
              Publish Event
            </Button>
          )}
          <button onClick={onClose} className="text-sm font-black uppercase underline">
            Close
          </button>
        </div>
      </div>

      {message && (
        <p className="mt-4 border-4 border-black bg-neo-secondary p-3 font-bold text-black">{message}</p>
      )}

      {/* Price & Capacity Versioning Controls */}
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="border-4 border-black bg-neo-cream p-4">
          <h3 className="font-black uppercase">Price Versioning</h3>
          <label className="mt-2 block text-xs font-black uppercase">
            Price (₹)
            <input value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} type="number" min="0" />
          </label>
          <label className="mt-2 block text-xs font-black uppercase">
            Reason (required for price update)
            <input value={priceReason} onChange={(e) => setPriceReason(e.target.value)} className={inputClass} placeholder="e.g. Early-bird concluded" />
          </label>
          <Button variant="secondary" className="mt-3" onClick={changePrice} disabled={busy || !priceReason}>
            Update Price Version
          </Button>
        </div>

        <div className="border-4 border-black bg-neo-cream p-4">
          <h3 className="font-black uppercase">Capacity Units</h3>
          <label className="mt-2 block text-xs font-black uppercase">
            Capacity units
            <input value={capacity} onChange={(e) => setCapacity(e.target.value)} className={inputClass} type="number" min="0" />
          </label>
          <p className="mt-1 text-xs font-bold text-black/50">
            Cannot go below held + confirmed registrations.
          </p>
          <Button variant="secondary" className="mt-3" onClick={changeCapacity} disabled={busy || !capacity}>
            Update Capacity
          </Button>
        </div>
      </div>

      {/* Edit Full Event Details */}
      <form onSubmit={updateEventDetails} className="mt-6 border-4 border-black bg-white p-4">
        <h3 className="font-black uppercase">Edit Event Details</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-xs font-black uppercase">
            Name
            <input
              required
              value={detailsForm.name}
              onChange={(e) => setDetailsForm({ ...detailsForm, name: e.target.value })}
              className={inputClass}
            />
          </label>

          <label className="text-xs font-black uppercase">
            Slug
            <input
              required
              value={detailsForm.slug}
              onChange={(e) => setDetailsForm({ ...detailsForm, slug: e.target.value })}
              className={inputClass}
            />
          </label>

          <label className="text-xs font-black uppercase">
            Category
            <select
              required
              value={detailsForm.categoryId}
              onChange={(e) => setDetailsForm({ ...detailsForm, categoryId: e.target.value })}
              className={inputClass}
            >
              {categories.length === 0 ? (
                <option value="">No categories found</option>
              ) : (
                <>
                  {!detailsForm.categoryId && <option value="">Select a Category</option>}
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </>
              )}
            </select>
          </label>

          <label className="text-xs font-black uppercase">
            Venue
            <select
              value={detailsForm.venueId}
              onChange={(e) => setDetailsForm({ ...detailsForm, venueId: e.target.value })}
              className={inputClass}
            >
              <option value="">No Venue</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-black uppercase">
            Starts At
            <input
              required
              type="datetime-local"
              value={detailsForm.startsAt}
              onChange={(e) => setDetailsForm({ ...detailsForm, startsAt: e.target.value })}
              className={inputClass}
            />
          </label>

          <label className="text-xs font-black uppercase">
            Ends At
            <input
              required
              type="datetime-local"
              value={detailsForm.endsAt}
              onChange={(e) => setDetailsForm({ ...detailsForm, endsAt: e.target.value })}
              className={inputClass}
            />
          </label>

          <label className="text-xs font-black uppercase">
            Prize Pool Text
            <input
              value={detailsForm.prizePoolText}
              onChange={(e) => setDetailsForm({ ...detailsForm, prizePoolText: e.target.value })}
              className={inputClass}
            />
          </label>

          <label className="text-xs font-black uppercase">
            Registration Mode
            <select
              value={detailsForm.registrationMode}
              onChange={(e) =>
                setDetailsForm({
                  ...detailsForm,
                  registrationMode: e.target.value as "INDIVIDUAL" | "TEAM",
                })
              }
              className={inputClass}
            >
              <option value="INDIVIDUAL">Individual</option>
              <option value="TEAM">Team</option>
            </select>
          </label>
        </div>

        <div className="mt-3">
          <label className="block text-xs font-black uppercase">
            Event Poster Image URL (Instagram Post 1:1 Ratio)
            <input
              type="url"
              value={detailsForm.imageUrl}
              onChange={(e) => setDetailsForm({ ...detailsForm, imageUrl: e.target.value })}
              className={inputClass}
              placeholder="https://images.unsplash.com/... or poster image URL"
            />
          </label>
          {detailsForm.imageUrl.trim() && (
            <div className="mt-2 flex items-center gap-4 border-2 border-black bg-neo-cream p-3">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden border-2 border-black bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={detailsForm.imageUrl.trim()}
                  alt="Instagram Post Preview"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
              <div>
                <span className="text-xs font-black uppercase tracking-wider text-black">Instagram Post Preview (1:1 Square)</span>
                <p className="text-xs font-bold text-black/60">This poster image will be displayed on event cards in Instagram post aspect ratio.</p>
              </div>
            </div>
          )}
        </div>

        <label className="mt-3 block text-xs font-black uppercase">
          Short Description
          <input
            required
            value={detailsForm.shortDescription}
            onChange={(e) => setDetailsForm({ ...detailsForm, shortDescription: e.target.value })}
            className={inputClass}
          />
        </label>

        <label className="mt-3 block text-xs font-black uppercase">
          Description (markdown)
          <textarea
            required
            rows={4}
            value={detailsForm.description}
            onChange={(e) => setDetailsForm({ ...detailsForm, description: e.target.value })}
            className={inputClass}
          />
        </label>

        <label className="mt-3 block text-xs font-black uppercase">
          Rules Markdown
          <textarea
            rows={3}
            value={detailsForm.rulesMarkdown}
            onChange={(e) => setDetailsForm({ ...detailsForm, rulesMarkdown: e.target.value })}
            className={inputClass}
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-xs font-black uppercase">
            <input
              type="checkbox"
              checked={detailsForm.featured}
              onChange={(e) => setDetailsForm({ ...detailsForm, featured: e.target.checked })}
              className="h-5 w-5 border-2 border-black"
            />
            Featured
          </label>

          <label className="flex items-center gap-2 text-xs font-black uppercase">
            <input
              type="checkbox"
              checked={detailsForm.includeInSchedule}
              onChange={(e) => setDetailsForm({ ...detailsForm, includeInSchedule: e.target.checked })}
              className="h-5 w-5 border-2 border-black"
            />
            Include in Schedule
          </label>

          <label className="flex items-center gap-2 text-xs font-black uppercase">
            <input
              type="checkbox"
              checked={detailsForm.isNightEvent}
              onChange={(e) => setDetailsForm({ ...detailsForm, isNightEvent: e.target.checked })}
              className="h-5 w-5 border-2 border-black"
            />
            Night Event (🌙)
          </label>
        </div>

        <Button type="submit" variant="primary" className="mt-4" disabled={busy}>
          Save All Event Details
        </Button>
      </form>
    </div>
  );
}
