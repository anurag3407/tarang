"use client";

import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import Link from "next/link";
import {
  DollarSign,
  Ticket,
  Users,
  Trophy,
  QrCode,
  RefreshCw,
  Search,
  FileSpreadsheet,
  Mail,
  ShieldCheck,
  Calendar,
  Sparkles,
  Layers,
  HelpCircle,
  Bell,
  ArrowUpRight,
  Database,
  AlertTriangle,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatPaise } from "@/lib/money";
import { formatDateTimeIST, formatDateIST } from "@/lib/dates";

interface OrderItem {
  id: string;
  publicOrderCode: string;
  paymentId?: string | null;
  amountPaise: number;
  currency: string;
  kind: string;
  tierLabel: string;
  isDelegate: boolean;
  isBasic: boolean;
  checkoutState: string;
  createdAt: string;
  fulfilledAt: string | null;
  purchaser: {
    name: string;
    phone: string;
    college: string;
    email: string;
  };
  sheetsSyncState: string;
  emailStatus: string;
}

interface PassItem {
  id: string;
  publicPassCode: string;
  productName: string;
  productSlug: string;
  isDelegate: boolean;
  state: string;
  activatedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  hasQr: boolean;
  holder: {
    name: string;
    phone: string;
    college: string;
    email: string;
  };
}

interface RegistrationMember {
  role: string;
  userId: string;
  name: string;
  phone: string;
  college: string;
  memberCode: string;
  email: string;
}

interface RegistrationItem {
  id: string;
  publicRegistrationCode: string;
  registrationMode: "INDIVIDUAL" | "TEAM";
  teamName: string | null;
  capacityUnits: number;
  state: string;
  confirmedAt: string | null;
  createdAt: string;
  event: {
    id?: string;
    name: string;
    slug: string;
    categoryName: string;
    venueName: string;
  };
  order: {
    id: string;
    publicOrderCode: string;
    checkoutState: string;
    amountPaise: number;
  } | null;
  registrant: {
    name: string;
    phone: string;
    college: string;
    email: string;
  };
  members: RegistrationMember[];
}

interface GroupEntryItem {
  id: string;
  entryCode: string;
  leadName: string;
  email: string;
  phone: string;
  college: string;
  groupSize: number;
  notes: string;
  createdAt: string;
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface OverviewData {
  metrics: {
    grossRevenuePaise: number;
    basicPassRevenuePaise: number;
    delegatePassRevenuePaise: number;
    eventsRevenuePaise: number;
    totalOrdersCount: number;
    fulfilledOrdersCount: number;
    pendingOrdersCount: number;
    refundedOrdersCount: number;
    basicPassesCount: number;
    delegatePassesCount: number;
    registrationsCount: number;
    usersCount: number;
    scansCount: number;
    openQuestionsCount: number;
    noticesCount: number;
    eventsCount: number;
    groupEntriesCount: number;
  };
  orders: OrderItem[];
  ordersPagination?: PaginationMeta;
  passes: PassItem[];
  passesPagination?: PaginationMeta;
  registrations?: RegistrationItem[];
  registrationsPagination?: PaginationMeta;
  groupEntries: GroupEntryItem[];
  groupEntriesPagination?: PaginationMeta;
  telemetry: {
    database: { status: string; provider: string };
    googleSheets: {
      enabled: boolean;
      configured: boolean;
      basicSpreadsheetId: string | null;
      delegateSpreadsheetId: string | null;
      eventsSpreadsheetId: string | null;
      merchandiseSpreadsheetId: string | null;
      groupEntrySpreadsheetId: string | null;
    };
    resendEmail: {
      enabled: boolean;
      provider: string;
      fromEmail: string;
    };
    festival: {
      slug: string;
      name: string;
      dates: string;
      venue: string;
    };
  };
}

function PaginationControls({
  pagination,
  onPageChange,
  onPageSizeChange,
  loading,
}: {
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  loading?: boolean;
}) {
  const { page, pageSize, total, totalPages } = pagination;
  if (total === 0) return null;

  const startEntry = Math.min((page - 1) * pageSize + 1, total);
  const endEntry = Math.min(page * pageSize, total);

  const pages: number[] = [];
  const maxButtons = 5;
  let startPage = Math.max(1, page - 2);
  const endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }
  for (let p = startPage; p <= endPage; p++) {
    pages.push(p);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-black bg-neo-cream p-3 text-xs font-mono font-bold text-black">
      {/* Entry counts summary */}
      <div className="flex flex-wrap items-center gap-3">
        <span>
          Showing <span className="font-black text-black">{startEntry}</span>–
          <span className="font-black text-black">{endEntry}</span> of{" "}
          <span className="font-black text-black">{total}</span> records
        </span>

        {/* Page size selector */}
        <div className="flex items-center gap-1.5 ml-2">
          <span className="text-[11px] uppercase text-black/70">Per page:</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            disabled={loading}
            className="border-2 border-black bg-white px-2 py-0.5 text-xs font-black uppercase focus:outline-none"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {/* Page navigation buttons */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(1)}
          disabled={page <= 1 || loading}
          className="border-2 border-black bg-white px-2.5 py-1 text-xs font-black uppercase hover:bg-neo-secondary disabled:opacity-40 transition-colors"
          title="First Page"
        >
          «
        </button>
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1 || loading}
          className="border-2 border-black bg-white px-2.5 py-1 text-xs font-black uppercase hover:bg-neo-secondary disabled:opacity-40 transition-colors"
          title="Previous Page"
        >
          ‹ Prev
        </button>

        {pages.map((p) => (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            disabled={loading}
            className={`min-w-[32px] border-2 border-black px-2 py-1 text-xs font-black transition-colors ${
              p === page
                ? "bg-black text-white"
                : "bg-white text-black hover:bg-neo-secondary"
            }`}
          >
            {p}
          </button>
        ))}

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages || loading}
          className="border-2 border-black bg-white px-2.5 py-1 text-xs font-black uppercase hover:bg-neo-secondary disabled:opacity-40 transition-colors"
          title="Next Page"
        >
          Next ›
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages || loading}
          className="border-2 border-black bg-white px-2.5 py-1 text-xs font-black uppercase hover:bg-neo-secondary disabled:opacity-40 transition-colors"
          title="Last Page"
        >
          »
        </button>
      </div>
    </div>
  );
}

export default function AdminMissionControl() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"orders" | "passes" | "registrations" | "groups" | "sheets" | "tools">("orders");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [refundModalOrder, setRefundModalOrder] = useState<OrderItem | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Tab 1: Orders State
  const [ordersList, setOrdersList] = useState<OrderItem[]>([]);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersPageSize, setOrdersPageSize] = useState(25);
  const [ordersSearch, setOrdersSearch] = useState("");
  const [ordersTier, setOrdersTier] = useState<"ALL" | "DELEGATE" | "BASIC" | "EVENT" | "REFUNDED" | "PENDING">("ALL");
  const [ordersPagination, setOrdersPagination] = useState<PaginationMeta>({ page: 1, pageSize: 25, total: 0, totalPages: 1 });

  // Tab 2: Passes State
  const [passesList, setPassesList] = useState<PassItem[]>([]);
  const [passesPage, setPassesPage] = useState(1);
  const [passesPageSize, setPassesPageSize] = useState(25);
  const [passesSearch, setPassesSearch] = useState("");
  const [passesState, setPassesState] = useState<string>("ALL");
  const [passesPagination, setPassesPagination] = useState<PaginationMeta>({ page: 1, pageSize: 25, total: 0, totalPages: 1 });

  // Tab 3: Registrations State
  const [regsList, setRegsList] = useState<RegistrationItem[]>([]);
  const [regsPage, setRegsPage] = useState(1);
  const [regsPageSize, setRegsPageSize] = useState(25);
  const [regsSearch, setRegsSearch] = useState("");
  const [regsStatus, setRegsStatus] = useState<string>("ALL");
  const [regsPagination, setRegsPagination] = useState<PaginationMeta>({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [expandedRegs, setExpandedRegs] = useState<Record<string, boolean>>({});

  // Tab 4: Campus Ambassadors (Group Entries) State
  const [groupsList, setGroupsList] = useState<GroupEntryItem[]>([]);
  const [groupsPage, setGroupsPage] = useState(1);
  const [groupsPageSize, setGroupsPageSize] = useState(25);
  const [groupsSearch, setGroupsSearch] = useState("");
  const [groupsPagination, setGroupsPagination] = useState<PaginationMeta>({ page: 1, pageSize: 25, total: 0, totalPages: 1 });

  const initialLoadDone = useRef(false);
  const requestSeq = useRef({ orders: 0, passes: 0, registrations: 0, groups: 0 });
  const isFirstEffect = useRef({ orders: true, passes: true, registrations: true, groups: true });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 2000);
    showToast(`Copied ${text}`);
  };

  // Dedicated Tab Data Fetcher with latest-request sequencing
  const fetchTabData = useCallback(
    async (
      tab: "orders" | "passes" | "registrations" | "groups",
      page: number,
      pageSize: number,
      q: string,
      filter?: string
    ) => {
      const seq = ++requestSeq.current[tab];
      setTabLoading(true);
      try {
        const params = new URLSearchParams({
          tab,
          page: String(page),
          pageSize: String(pageSize),
        });
        if (q) params.set("q", q);
        if (filter && filter !== "ALL") params.set("filter", filter);

        const res = await fetch(`/api/admin/overview?${params.toString()}`);
        const body = await res.json();
        // Discard result if a newer request for this tab was dispatched
        if (seq !== requestSeq.current[tab]) return;

        if (body.ok) {
          if (tab === "orders") {
            setOrdersList(body.data.items);
            setOrdersPagination({
              page: body.data.page,
              pageSize: body.data.pageSize,
              total: body.data.total,
              totalPages: body.data.totalPages,
            });
          } else if (tab === "passes") {
            setPassesList(body.data.items);
            setPassesPagination({
              page: body.data.page,
              pageSize: body.data.pageSize,
              total: body.data.total,
              totalPages: body.data.totalPages,
            });
          } else if (tab === "registrations") {
            setRegsList(body.data.items);
            setRegsPagination({
              page: body.data.page,
              pageSize: body.data.pageSize,
              total: body.data.total,
              totalPages: body.data.totalPages,
            });
          } else if (tab === "groups") {
            setGroupsList(body.data.items);
            setGroupsPagination({
              page: body.data.page,
              pageSize: body.data.pageSize,
              total: body.data.total,
              totalPages: body.data.totalPages,
            });
          }
        }
      } catch (err) {
        if (seq === requestSeq.current[tab]) {
          console.error("Failed to load tab data", err);
        }
      } finally {
        if (seq === requestSeq.current[tab]) {
          setTabLoading(false);
        }
      }
    },
    []
  );

  // Initial Data Load & Background Refresh
  const loadData = useCallback(async () => {
    try {
      setFetchError(null);
      const res = await fetch("/api/admin/overview");
      const body = await res.json();
      if (body.ok) {
        const d = body.data as OverviewData;
        setData(d);

        // On first load, populate all tab lists and pagination
        if (!initialLoadDone.current) {
          setOrdersList(d.orders);
          if (d.ordersPagination) setOrdersPagination(d.ordersPagination);

          setPassesList(d.passes);
          if (d.passesPagination) setPassesPagination(d.passesPagination);

          if (d.registrations) setRegsList(d.registrations);
          if (d.registrationsPagination) setRegsPagination(d.registrationsPagination);

          setGroupsList(d.groupEntries);
          if (d.groupEntriesPagination) setGroupsPagination(d.groupEntriesPagination);

          initialLoadDone.current = true;
        } else {
          // On background polling (every 30s), only update a tab's list if the user is
          // viewing page 1 with no active search/filters on that tab. This keeps idle views
          // fresh while NEVER disturbing an active search or paginated view!
          if (ordersSearch === "" && ordersTier === "ALL" && ordersPage === 1) {
            setOrdersList(d.orders);
            if (d.ordersPagination) setOrdersPagination(d.ordersPagination);
          }
          if (passesSearch === "" && passesState === "ALL" && passesPage === 1) {
            setPassesList(d.passes);
            if (d.passesPagination) setPassesPagination(d.passesPagination);
          }
          if (regsSearch === "" && regsStatus === "ALL" && regsPage === 1) {
            if (d.registrations) setRegsList(d.registrations);
            if (d.registrationsPagination) setRegsPagination(d.registrationsPagination);
          }
          if (groupsSearch === "" && groupsPage === 1) {
            setGroupsList(d.groupEntries);
            if (d.groupEntriesPagination) setGroupsPagination(d.groupEntriesPagination);
          }
        }
      } else {
        setFetchError(body.message || `Failed to fetch overview data (${res.status})`);
      }
    } catch (err) {
      console.error("Failed to load overview data", err);
      setFetchError(err instanceof Error ? err.message : "Network error fetching data");
    } finally {
      setLoading(false);
    }
  }, [ordersSearch, ordersTier, ordersPage, passesSearch, passesState, passesPage, regsSearch, regsStatus, regsPage, groupsSearch, groupsPage]);

  useEffect(() => {
    void loadData();
    const interval = setInterval(() => void loadData(), 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Debounced search / filter triggers for Orders (skips initial mount storm)
  useEffect(() => {
    if (isFirstEffect.current.orders) {
      isFirstEffect.current.orders = false;
      return;
    }
    const timer = setTimeout(() => {
      if (!loading) {
        void fetchTabData("orders", ordersPage, ordersPageSize, ordersSearch, ordersTier);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [ordersSearch, ordersTier, ordersPage, ordersPageSize, fetchTabData, loading]);

  // Debounced search / filter triggers for Passes (skips initial mount storm)
  useEffect(() => {
    if (isFirstEffect.current.passes) {
      isFirstEffect.current.passes = false;
      return;
    }
    const timer = setTimeout(() => {
      if (!loading) {
        void fetchTabData("passes", passesPage, passesPageSize, passesSearch, passesState);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [passesSearch, passesState, passesPage, passesPageSize, fetchTabData, loading]);

  // Debounced search / filter triggers for Registrations (skips initial mount storm)
  useEffect(() => {
    if (isFirstEffect.current.registrations) {
      isFirstEffect.current.registrations = false;
      return;
    }
    const timer = setTimeout(() => {
      if (!loading) {
        void fetchTabData("registrations", regsPage, regsPageSize, regsSearch, regsStatus);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [regsSearch, regsStatus, regsPage, regsPageSize, fetchTabData, loading]);

  // Debounced search for Campus Ambassadors (skips initial mount storm)
  useEffect(() => {
    if (isFirstEffect.current.groups) {
      isFirstEffect.current.groups = false;
      return;
    }
    const timer = setTimeout(() => {
      if (!loading) {
        void fetchTabData("groups", groupsPage, groupsPageSize, groupsSearch);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [groupsSearch, groupsPage, groupsPageSize, fetchTabData, loading]);

  const handleProcessRefund = async (orderId: string) => {
    setActionLoading(`refund-${orderId}`);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = await res.json();
      if (body.ok) {
        showToast("✓ Order marked as REFUNDED");
        setRefundModalOrder(null);
        void loadData();
        void fetchTabData("orders", ordersPage, ordersPageSize, ordersSearch, ordersTier);
      } else {
        showToast(`✕ Refund failed: ${body.message ?? "Error"}`);
      }
    } catch {
      showToast("✕ Network error while processing refund");
    } finally {
      setActionLoading(null);
    }
  };

  const handleResyncSheets = async (orderId: string) => {
    setActionLoading(`sheets-${orderId}`);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/resync-sheets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = await res.json();
      if (body.ok) {
        showToast("✓ Order resynced to Google Sheets");
        void fetchTabData("orders", ordersPage, ordersPageSize, ordersSearch, ordersTier);
      } else {
        showToast(`✕ Sync failed: ${body.message ?? "Error"}`);
      }
    } catch {
      showToast("✕ Network error while syncing");
    } finally {
      setActionLoading(null);
    }
  };

  const handleResendEmail = async (orderId: string) => {
    setActionLoading(`email-${orderId}`);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/resend-email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = await res.json();
      if (body.ok) {
        showToast(body.data?.message ? `✓ ${body.data.message}` : `✓ Confirmation email dispatched via ${data?.telemetry.resendEmail.provider ?? "email"}`);
        void fetchTabData("orders", ordersPage, ordersPageSize, ordersSearch, ordersTier);
      } else {
        const errorText = body.error?.message || body.message || "Unknown error";
        showToast(`✕ Email failed: ${errorText}`);
      }
    } catch {
      showToast("✕ Network error while sending email");
    } finally {
      setActionLoading(null);
    }
  };

  const handleFullHistoricalSheetsSync = async () => {
    setActionLoading("full-sheets-sync");
    try {
      const res = await fetch("/api/admin/exports/sheets-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_all" }),
      });
      const body = await res.json();
      if (body.ok) {
        const counts = body.data?.recordsSynced;
        showToast(`✓ Synced: ${counts?.basicPasses ?? 0} Basic, ${counts?.delegatePasses ?? 0} VIP, ${counts?.events ?? 0} Events`);
        void loadData();
      } else {
        showToast(`✕ Sync failed: ${body.message ?? "Error"}`);
      }
    } catch {
      showToast("✕ Network error during backfill");
    } finally {
      setActionLoading(null);
    }
  };

  const toggleRegExpand = (id: string) => {
    setExpandedRegs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const m = data?.metrics;

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-4">
          <div className="border-4 border-black bg-neo-secondary px-4 py-3 font-mono text-xs font-black uppercase text-black shadow-neo-lg">
            {toastMessage}
          </div>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-4 border-black bg-white p-6 shadow-neo">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 animate-pulse bg-green-500 rounded-full border border-black" />
            <span className="font-mono text-xs font-black uppercase tracking-wider text-black/60">
              Tarang 2026 · NIT Patna
            </span>
          </div>
          <h1 className="mt-1 text-3xl font-black uppercase tracking-tight text-black sm:text-4xl">
            Mission Control · Command HQ
          </h1>
          <p className="mt-1 text-xs font-bold text-black/60">
            Real-time ledger, pass issuance, gate telemetry &amp; support operations
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              void loadData();
              showToast("Refreshing all mission data…");
            }}
            disabled={loading}
            className="flex items-center gap-2 border-2 border-black bg-neo-cream px-3 py-2 font-mono text-xs font-black uppercase hover:bg-neo-secondary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh Data
          </button>
        </div>
      </div>

      {/* Fetch Error Display */}
      {fetchError && (
        <div className="border-4 border-black bg-red-100 p-4 font-mono text-xs font-black text-red-900 shadow-neo">
          ⚠️ {fetchError}
        </div>
      )}

      {/* Telemetry Status Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono text-xs">
        <div className="border-2 border-black bg-white p-3 shadow-neo-sm flex items-center justify-between">
          <span className="text-black/60 uppercase">Database</span>
          <span className="inline-flex items-center gap-1 font-black text-green-700">
            <Database className="h-3.5 w-3.5" /> ONLINE
          </span>
        </div>
        <div className="border-2 border-black bg-white p-3 shadow-neo-sm flex items-center justify-between">
          <span className="text-black/60 uppercase">Sheets Sync</span>
          <span className={`inline-flex items-center gap-1 font-black ${data?.telemetry.googleSheets.configured ? "text-green-700" : "text-amber-700"}`}>
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {data?.telemetry.googleSheets.configured ? "CONNECTED" : "OFFLINE"}
          </span>
        </div>
        <div className="border-2 border-black bg-white p-3 shadow-neo-sm flex items-center justify-between">
          <span className="text-black/60 uppercase">{data?.telemetry.resendEmail.provider ?? "Email"} Mail</span>
          <span className={`inline-flex items-center gap-1 font-black ${data?.telemetry.resendEmail.enabled ? "text-green-700" : "text-amber-700"}`}>
            <Mail className="h-3.5 w-3.5" />
            {data?.telemetry.resendEmail.enabled ? "READY" : "DISABLED"}
          </span>
        </div>
        <div className="border-2 border-black bg-white p-3 shadow-neo-sm flex items-center justify-between">
          <span className="text-black/60 uppercase">Total Orders</span>
          <span className="font-black text-black">
            {m?.totalOrdersCount ?? 0}
          </span>
        </div>
      </div>

      {/* 4 Primary Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Gross Revenue */}
        <div className="border-4 border-black bg-neo-secondary p-5 shadow-neo">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-black uppercase tracking-wider text-black/70">
              Total Gross Revenue
            </span>
            <DollarSign className="h-5 w-5 text-black" />
          </div>
          <p className="mt-2 text-3xl font-black tracking-tight text-black">
            {formatPaise(m?.grossRevenuePaise ?? 0)}
          </p>
          <div className="mt-3 flex flex-wrap gap-1 text-[10px] font-black uppercase">
            <span className="border border-black bg-black px-1.5 py-0.5 text-white">
              VIP: {formatPaise(m?.delegatePassRevenuePaise ?? 0)}
            </span>
            <span className="border border-black bg-white px-1.5 py-0.5 text-black">
              Basic: {formatPaise(m?.basicPassRevenuePaise ?? 0)}
            </span>
            <span className="border border-black bg-neo-accent px-1.5 py-0.5 text-black">
              Events: {formatPaise(m?.eventsRevenuePaise ?? 0)}
            </span>
          </div>
        </div>

        {/* VIP Delegate Passes */}
        <div className="border-4 border-black bg-black p-5 text-white shadow-neo">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-black uppercase tracking-wider text-neo-secondary">
              VIP Delegate Passes
            </span>
            <Sparkles className="h-5 w-5 text-neo-secondary" />
          </div>
          <p className="mt-2 text-3xl font-black tracking-tight text-neo-secondary">
            {m?.delegatePassesCount ?? 0}
          </p>
          <p className="mt-1 text-xs font-bold text-white/70">
            5 Star Night Concerts &amp; VIP Arena QR
          </p>
        </div>

        {/* Basic Passes */}
        <div className="border-4 border-black bg-white p-5 shadow-neo">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-black uppercase tracking-wider text-black/60">
              Basic Cards / Passes
            </span>
            <Ticket className="h-5 w-5 text-black" />
          </div>
          <p className="mt-2 text-3xl font-black tracking-tight text-black">
            {m?.basicPassesCount ?? 0}
          </p>
          <p className="mt-1 text-xs font-bold text-black/60">
            5-Day General Campus Entry Access
          </p>
        </div>

        {/* Total Users, Events & Registrations */}
        <div className="border-4 border-black bg-neo-accent p-5 shadow-neo">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-black uppercase tracking-wider text-black/70">
              Registered Participants
            </span>
            <Users className="h-5 w-5 text-black" />
          </div>
          <p className="mt-2 text-3xl font-black tracking-tight text-black">
            {m?.usersCount ?? 0}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-black/80">
            <span>Registrations: {m?.registrationsCount ?? 0}</span>
            <span>·</span>
            <span>Scans: {m?.scansCount ?? 0}</span>
            <span>·</span>
            <span>Events: {m?.eventsCount ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-4 border-black bg-white p-2 shadow-neo flex flex-wrap gap-2">
        <button
          onClick={() => setActiveTab("orders")}
          className={`flex items-center gap-2 px-4 py-2.5 font-mono text-xs font-black uppercase tracking-wider transition-colors ${
            activeTab === "orders" ? "border-2 border-black bg-black text-white" : "hover:bg-neo-secondary hover:text-black text-black"
          }`}
        >
          <DollarSign className="h-4 w-4" />
          Transactions &amp; Orders ({ordersPagination.total ?? data?.orders.length ?? 0})
        </button>

        <button
          onClick={() => setActiveTab("passes")}
          className={`flex items-center gap-2 px-4 py-2.5 font-mono text-xs font-black uppercase tracking-wider transition-colors ${
            activeTab === "passes" ? "border-2 border-black bg-black text-white" : "hover:bg-neo-secondary hover:text-black text-black"
          }`}
        >
          <QrCode className="h-4 w-4" />
          Issued Passes &amp; Cards ({passesPagination.total ?? data?.passes.length ?? 0})
        </button>

        <button
          onClick={() => setActiveTab("registrations")}
          className={`flex items-center gap-2 px-4 py-2.5 font-mono text-xs font-black uppercase tracking-wider transition-colors ${
            activeTab === "registrations" ? "border-2 border-black bg-black text-white" : "hover:bg-neo-secondary hover:text-black text-black"
          }`}
        >
          <Trophy className="h-4 w-4" />
          Event Registrations ({regsPagination.total ?? m?.registrationsCount ?? 0})
        </button>

        <button
          onClick={() => setActiveTab("groups")}
          className={`flex items-center gap-2 px-4 py-2.5 font-mono text-xs font-black uppercase tracking-wider transition-colors ${
            activeTab === "groups" ? "border-2 border-black bg-black text-white" : "hover:bg-neo-secondary hover:text-black text-black"
          }`}
        >
          <Users className="h-4 w-4" />
          Campus Ambassadors ({groupsPagination.total ?? data?.groupEntries.length ?? 0})
        </button>

        <button
          onClick={() => setActiveTab("sheets")}
          className={`flex items-center gap-2 px-4 py-2.5 font-mono text-xs font-black uppercase tracking-wider transition-colors ${
            activeTab === "sheets" ? "border-2 border-black bg-black text-white" : "hover:bg-neo-secondary hover:text-black text-black"
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Google Sheets Hub
        </button>

        <button
          onClick={() => setActiveTab("tools")}
          className={`flex items-center gap-2 px-4 py-2.5 font-mono text-xs font-black uppercase tracking-wider transition-colors ${
            activeTab === "tools" ? "border-2 border-black bg-black text-white" : "hover:bg-neo-secondary hover:text-black text-black"
          }`}
        >
          <Layers className="h-4 w-4" />
          Admin Tooling &amp; Modules
        </button>
      </div>

      {/* TAB 1: ORDERS & TRANSACTIONS */}
      {activeTab === "orders" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-4 border-black bg-white p-4 shadow-neo">
            {/* Search Input */}
            <div className="relative min-w-[280px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/50" />
              <input
                type="text"
                placeholder="Search by order code (PO-...), name, email, payment ID, college..."
                value={ordersSearch}
                onChange={(e) => {
                  setOrdersSearch(e.target.value);
                  setOrdersPage(1);
                }}
                className="w-full border-2 border-black bg-neo-cream text-black py-2 pl-9 pr-4 font-mono text-xs font-bold focus:outline-none"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-black uppercase">
              {(["ALL", "DELEGATE", "BASIC", "EVENT", "REFUNDED", "PENDING"] as const).map((tier) => (
                <button
                  key={tier}
                  onClick={() => {
                    setOrdersTier(tier);
                    setOrdersPage(1);
                  }}
                  className={`border-2 border-black px-3 py-1.5 ${
                    ordersTier === tier ? "bg-black text-white" : "bg-white text-black hover:bg-neo-secondary"
                  }`}
                >
                  {tier === "ALL" && "All Orders"}
                  {tier === "DELEGATE" && "VIP Delegate"}
                  {tier === "BASIC" && "Basic Card"}
                  {tier === "EVENT" && "Events"}
                  {tier === "REFUNDED" && "Refunded"}
                  {tier === "PENDING" && "Pending"}
                </button>
              ))}
            </div>
          </div>

          {/* Orders Table */}
          <div className="overflow-x-auto border-4 border-black bg-white shadow-neo">
            <table className="w-full text-left text-xs">
              <thead className="border-b-4 border-black bg-black text-white font-mono uppercase">
                <tr>
                  <th className="px-4 py-3">Order Code</th>
                  <th className="px-4 py-3">Purchaser Details</th>
                  <th className="px-4 py-3">Pass / Item Tier</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Sheets Sync</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-black/20">
                {ordersList.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center font-bold text-black/50">
                      {tabLoading ? "Loading orders…" : "No matching orders found."}
                    </td>
                  </tr>
                ) : (
                  ordersList.map((o) => (
                    <tr key={o.id} className="hover:bg-neo-secondary/20 transition-colors">
                      {/* Order Code & Date */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-black">{o.publicOrderCode}</span>
                          <button
                            onClick={() => copyToClipboard(o.publicOrderCode)}
                            className="text-black/40 hover:text-black"
                            title="Copy Order Code"
                          >
                            {copiedCode === o.publicOrderCode ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                        {o.paymentId && (
                          <p className="font-mono text-[10px] text-zinc-500 select-all" title="Razorpay Payment ID">
                            {o.paymentId}
                          </p>
                        )}
                        <p className="text-[10px] text-black/50">
                          {formatDateTimeIST(o.createdAt)}
                        </p>
                      </td>

                      {/* Purchaser Details */}
                      <td className="px-4 py-3">
                        <p className="font-black text-black">{o.purchaser.name}</p>
                        <p className="font-mono text-[11px] text-black/70">{o.purchaser.email}</p>
                        <p className="font-mono text-[10px] text-black/60">{o.purchaser.phone}</p>
                        {o.purchaser.college !== "—" && (
                          <p className="text-[10px] text-black/50">{o.purchaser.college}</p>
                        )}
                      </td>

                      {/* Product Tier Badge */}
                      <td className="px-4 py-3">
                        {o.isDelegate ? (
                          <span className="inline-flex items-center gap-1 border-2 border-black bg-black px-2 py-0.5 font-mono text-[10px] font-black uppercase text-neo-secondary">
                            <Sparkles className="h-3 w-3" /> VIP Delegate
                          </span>
                        ) : o.isBasic ? (
                          <span className="inline-flex items-center gap-1 border-2 border-black bg-neo-secondary px-2 py-0.5 font-mono text-[10px] font-black uppercase text-black">
                            <Ticket className="h-3 w-3" /> Basic Pass
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 border-2 border-black bg-neo-accent px-2 py-0.5 font-mono text-[10px] font-black uppercase text-black">
                            <Trophy className="h-3 w-3" /> Event Entry
                          </span>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-3 font-mono font-black text-sm">
                        {formatPaise(o.amountPaise)}
                      </td>

                      {/* Checkout Status */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block border px-2 py-0.5 text-[10px] font-black uppercase ${
                            o.checkoutState === "FULFILLED"
                              ? "border-green-600 bg-green-100 text-green-800"
                              : o.checkoutState === "REFUNDED"
                                ? "border-red-600 bg-red-100 text-red-800 font-bold"
                                : "border-amber-600 bg-amber-100 text-amber-800"
                          }`}
                        >
                          {o.checkoutState}
                        </span>
                      </td>

                      {/* Sheets Sync State */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[10px] font-black uppercase ${
                            o.sheetsSyncState === "SYNCED"
                              ? "border-green-600 bg-green-50 text-green-700"
                              : "border-zinc-400 bg-zinc-100 text-zinc-600"
                          }`}
                        >
                          {o.sheetsSyncState === "SYNCED" ? "✓ Synced" : o.sheetsSyncState}
                        </span>
                      </td>

                      {/* Action buttons */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {o.checkoutState === "REFUNDED" ? (
                            <span
                              title="Order and passes have been refunded"
                              className="inline-flex items-center border border-red-600 bg-red-100 px-2 py-1 text-[10px] font-black uppercase text-red-700 font-mono"
                            >
                              ✓ Refunded
                            </span>
                          ) : (
                            <button
                              onClick={() => setRefundModalOrder(o)}
                              disabled={actionLoading === `refund-${o.id}`}
                              title="Process cancellation and mark order as refunded"
                              className="border border-black bg-neo-accent px-2 py-1 text-[10px] font-black uppercase text-black hover:bg-red-500 hover:text-white transition-colors disabled:opacity-50"
                            >
                              {actionLoading === `refund-${o.id}` ? "..." : "Refund"}
                            </button>
                          )}

                          <button
                            onClick={() => handleResyncSheets(o.id)}
                            disabled={actionLoading === `sheets-${o.id}`}
                            title="Resync to Google Sheets"
                            className="border border-black bg-white px-2 py-1 text-[10px] font-black uppercase hover:bg-neo-secondary disabled:opacity-50"
                          >
                            {actionLoading === `sheets-${o.id}` ? "..." : "Sync Sheet"}
                          </button>

                          <button
                            onClick={() => handleResendEmail(o.id)}
                            disabled={actionLoading === `email-${o.id}` || o.checkoutState === "REFUNDED"}
                            title="Resend confirmation email with QR"
                            className="border border-black bg-black px-2 py-1 text-[10px] font-black uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
                          >
                            {actionLoading === `email-${o.id}` ? "..." : "Resend Mail"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Pagination Controls */}
            <PaginationControls
              pagination={ordersPagination}
              onPageChange={(p) => setOrdersPage(p)}
              onPageSizeChange={(sz) => {
                setOrdersPageSize(sz);
                setOrdersPage(1);
              }}
              loading={tabLoading}
            />
          </div>
        </div>
      )}

      {/* TAB 2: ISSUED PASSES & CARDS */}
      {activeTab === "passes" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-4 border-black bg-white p-4 shadow-neo">
            <div className="relative min-w-[280px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/50" />
              <input
                type="text"
                placeholder="Search passes by Pass Code (PP-...), holder name, email, college..."
                value={passesSearch}
                onChange={(e) => {
                  setPassesSearch(e.target.value);
                  setPassesPage(1);
                }}
                className="w-full border-2 border-black bg-neo-cream py-2 pl-9 pr-4 font-mono text-xs font-bold focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-xs font-black uppercase">
              {(["ALL", "ACTIVE", "REFUNDED"] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => {
                    setPassesState(st);
                    setPassesPage(1);
                  }}
                  className={`border-2 border-black px-3 py-1.5 ${
                    passesState === st ? "bg-black text-white" : "bg-white text-black hover:bg-neo-secondary"
                  }`}
                >
                  {st === "ALL" ? "All Passes" : st}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto border-4 border-black bg-white shadow-neo">
            <table className="w-full text-left text-xs">
              <thead className="border-b-4 border-black bg-black text-white font-mono uppercase">
                <tr>
                  <th className="px-4 py-3">Pass Code</th>
                  <th className="px-4 py-3">Product Tier</th>
                  <th className="px-4 py-3">QR Gate Status</th>
                  <th className="px-4 py-3">Holder Details</th>
                  <th className="px-4 py-3">Pass State</th>
                  <th className="px-4 py-3">Activated At</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-black/20">
                {passesList.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center font-bold text-black/50">
                      {tabLoading ? "Loading passes…" : "No matching passes found."}
                    </td>
                  </tr>
                ) : (
                  passesList.map((p) => (
                    <tr key={p.id} className="hover:bg-neo-secondary/20 transition-colors">
                      <td className="px-4 py-3 font-mono font-black text-sm">
                        <div className="flex items-center gap-1.5">
                          <span>{p.publicPassCode}</span>
                          <button
                            onClick={() => copyToClipboard(p.publicPassCode)}
                            className="text-black/40 hover:text-black"
                            title="Copy Pass Code"
                          >
                            {copiedCode === p.publicPassCode ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                        <p className="text-[10px] text-black/50">
                          {formatDateIST(p.createdAt)}
                        </p>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-block border-2 border-black px-2 py-0.5 font-mono text-[10px] font-black uppercase ${
                            p.isDelegate ? "bg-black text-neo-secondary" : "bg-neo-secondary text-black"
                          }`}
                        >
                          {p.productName}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        {p.state === "REFUNDED" ? (
                          <span className="inline-flex items-center gap-1 border border-red-600 bg-red-50 px-2 py-0.5 text-[10px] font-black uppercase text-red-700">
                            QR Revoked (Refunded)
                          </span>
                        ) : p.hasQr ? (
                          <span className="inline-flex items-center gap-1 border border-green-600 bg-green-100 px-2 py-0.5 text-[10px] font-black uppercase text-green-800">
                            <QrCode className="h-3 w-3" /> Gate QR Active
                          </span>
                        ) : (
                          <span className="inline-block border border-zinc-400 bg-zinc-100 px-2 py-0.5 text-[10px] font-black uppercase text-zinc-600">
                            No QR (General)
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <p className="font-black text-black">{p.holder.name}</p>
                        <p className="font-mono text-[11px] text-black/70">{p.holder.email}</p>
                        <p className="font-mono text-[10px] text-black/60">{p.holder.phone}</p>
                        {p.holder.college !== "—" && (
                          <p className="text-[10px] text-black/50">{p.holder.college}</p>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`border px-2 py-0.5 text-[10px] font-black uppercase ${
                            p.state === "ACTIVE"
                              ? "border-green-600 bg-green-100 text-green-800"
                              : p.state === "REFUNDED"
                                ? "border-red-600 bg-red-100 text-red-800 font-bold"
                                : "border-black bg-neo-muted text-black"
                          }`}
                        >
                          {p.state}
                        </span>
                      </td>

                      <td className="px-4 py-3 font-mono text-[11px] text-black/60">
                        {p.activatedAt ? formatDateIST(p.activatedAt) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Pagination Controls */}
            <PaginationControls
              pagination={passesPagination}
              onPageChange={(p) => setPassesPage(p)}
              onPageSizeChange={(sz) => {
                setPassesPageSize(sz);
                setPassesPage(1);
              }}
              loading={tabLoading}
            />
          </div>
        </div>
      )}

      {/* TAB 3: EVENT REGISTRATIONS (ALL PREVIOUS REGISTRATIONS OF ALL EVENTS) */}
      {activeTab === "registrations" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-4 border-black bg-white p-4 shadow-neo">
            {/* Search Input */}
            <div className="relative min-w-[280px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/50" />
              <input
                type="text"
                placeholder="Search registrations by code (PR-...), team name, participant, college..."
                value={regsSearch}
                onChange={(e) => {
                  setRegsSearch(e.target.value);
                  setRegsPage(1);
                }}
                className="w-full border-2 border-black bg-neo-cream py-2 pl-9 pr-4 font-mono text-xs font-bold focus:outline-none"
              />
            </div>

            {/* Filter Status */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-black uppercase">
              {(["ALL", "CONFIRMED", "CANCELLED", "REFUNDED"] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => {
                    setRegsStatus(st);
                    setRegsPage(1);
                  }}
                  className={`border-2 border-black px-3 py-1.5 ${
                    regsStatus === st ? "bg-black text-white" : "bg-white text-black hover:bg-neo-secondary"
                  }`}
                >
                  {st === "ALL" ? "All Registrations" : st}
                </button>
              ))}
            </div>
          </div>

          {/* Registrations Table */}
          <div className="overflow-x-auto border-4 border-black bg-white shadow-neo">
            <table className="w-full text-left text-xs">
              <thead className="border-b-4 border-black bg-black text-white font-mono uppercase">
                <tr>
                  <th className="px-4 py-3">Registration Code</th>
                  <th className="px-4 py-3">Event Details</th>
                  <th className="px-4 py-3">Mode &amp; Team</th>
                  <th className="px-4 py-3">Registrant / Lead</th>
                  <th className="px-4 py-3">Linked Order</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Team Details</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-black/20">
                {regsList.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center font-bold text-black/50">
                      {tabLoading ? "Loading event registrations…" : "No event registrations found."}
                    </td>
                  </tr>
                ) : (
                  regsList.map((r) => {
                    const isExpanded = Boolean(expandedRegs[r.id]);
                    return (
                      <Fragment key={r.id}>
                        <tr className="border-b border-black/10 hover:bg-neo-secondary/10 transition-colors">
                          {/* Registration Code */}
                          <td className="px-4 py-3 font-mono">
                            <div className="flex items-center gap-1.5">
                              <span className="font-black text-sm">{r.publicRegistrationCode}</span>
                              <button
                                onClick={() => copyToClipboard(r.publicRegistrationCode)}
                                className="text-black/40 hover:text-black"
                                title="Copy Registration Code"
                              >
                                {copiedCode === r.publicRegistrationCode ? (
                                  <Check className="h-3 w-3 text-green-600" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                            <p className="text-[10px] text-black/50">
                              {r.confirmedAt ? formatDateTimeIST(r.confirmedAt) : formatDateTimeIST(r.createdAt)}
                            </p>
                          </td>

                          {/* Event Name & Category */}
                          <td className="px-4 py-3">
                            <p className="font-black text-black uppercase tracking-tight">{r.event.name}</p>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className="inline-block border border-black bg-neo-accent px-1.5 py-0.2 text-[9px] font-black uppercase">
                                {r.event.categoryName}
                              </span>
                              {r.event.venueName !== "TBD" && (
                                <span className="text-[10px] text-black/60 font-mono">
                                  · {r.event.venueName}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Mode & Team */}
                          <td className="px-4 py-3">
                            <span
                              className={`inline-block border px-2 py-0.5 font-mono text-[10px] font-black uppercase ${
                                r.registrationMode === "TEAM"
                                  ? "border-purple-600 bg-purple-100 text-purple-900"
                                  : "border-blue-600 bg-blue-100 text-blue-900"
                              }`}
                            >
                              {r.registrationMode === "TEAM" ? "Team Entry" : "Individual"}
                            </span>
                            {r.teamName && (
                              <p className="mt-0.5 font-black text-xs text-black">
                                {r.teamName}{" "}
                                <span className="font-normal text-black/60 text-[10px]">
                                  ({r.members.length || r.capacityUnits} members)
                                </span>
                              </p>
                            )}
                          </td>

                          {/* Lead / Registrant details */}
                          <td className="px-4 py-3">
                            <p className="font-black text-black">{r.registrant.name}</p>
                            <p className="font-mono text-[11px] text-black/70">{r.registrant.email}</p>
                            <p className="font-mono text-[10px] text-black/60">{r.registrant.phone}</p>
                            {r.registrant.college !== "—" && (
                              <p className="text-[10px] text-black/50">{r.registrant.college}</p>
                            )}
                          </td>

                          {/* Order Details */}
                          <td className="px-4 py-3 font-mono">
                            {r.order ? (
                              <div>
                                <span className="font-black">{r.order.publicOrderCode}</span>
                                <p className="text-[11px] font-black text-black/80">
                                  {formatPaise(r.order.amountPaise)}
                                </p>
                                <span
                                  className={`inline-block border px-1.5 py-0.2 text-[9px] font-black uppercase ${
                                    r.order.checkoutState === "FULFILLED"
                                      ? "border-green-600 bg-green-100 text-green-800"
                                      : r.order.checkoutState === "REFUNDED"
                                        ? "border-red-600 bg-red-100 text-red-800"
                                        : "border-amber-600 bg-amber-100 text-amber-800"
                                  }`}
                                >
                                  {r.order.checkoutState}
                                </span>
                              </div>
                            ) : (
                              <span className="text-black/40">—</span>
                            )}
                          </td>

                          {/* Registration Status */}
                          <td className="px-4 py-3">
                            <span
                              className={`border px-2 py-0.5 text-[10px] font-black uppercase ${
                                r.state === "CONFIRMED"
                                  ? "border-green-600 bg-green-100 text-green-800"
                                  : r.state === "CANCELLED"
                                    ? "border-red-600 bg-red-100 text-red-800 font-bold"
                                    : r.state === "REFUNDED"
                                      ? "border-red-600 bg-red-100 text-red-800 font-bold"
                                      : "border-zinc-400 bg-zinc-100 text-zinc-700"
                              }`}
                            >
                              {r.state}
                            </span>
                          </td>

                          {/* Expand Team button */}
                          <td className="px-4 py-3 text-right">
                            {r.members.length > 0 ? (
                              <button
                                onClick={() => toggleRegExpand(r.id)}
                                className="inline-flex items-center gap-1 border border-black bg-neo-cream px-2 py-1 text-[10px] font-black uppercase hover:bg-neo-secondary transition-colors"
                              >
                                {isExpanded ? (
                                  <>
                                    Hide <ChevronUp className="h-3 w-3" />
                                  </>
                                ) : (
                                  <>
                                    Roster ({r.members.length}) <ChevronDown className="h-3 w-3" />
                                  </>
                                )}
                              </button>
                            ) : (
                              <span className="text-black/40 text-[10px] font-mono">—</span>
                            )}
                          </td>
                        </tr>

                        {/* Collapsible Member Roster Row */}
                        {isExpanded && r.members.length > 0 && (
                          <tr className="bg-neo-cream/60">
                            <td colSpan={7} className="p-4">
                              <div className="border-2 border-black bg-white p-3 shadow-neo-sm">
                                <p className="font-mono text-xs font-black uppercase text-black mb-2 flex items-center gap-1.5">
                                  <Users className="h-3.5 w-3.5" />
                                  Team Member Roster · {r.teamName || r.event.name}
                                </p>
                                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                  {r.members.map((m, idx) => (
                                    <div key={idx} className="border border-black bg-neo-cream p-2 text-xs">
                                      <div className="flex items-center justify-between">
                                        <span className="font-black text-black">{m.name}</span>
                                        <span className="border border-black bg-white px-1 py-0.2 text-[9px] font-black uppercase">
                                          {m.role}
                                        </span>
                                      </div>
                                      <p className="font-mono text-[10px] text-black/70">{m.email}</p>
                                      <p className="font-mono text-[10px] text-black/70">{m.phone}</p>
                                      <p className="text-[10px] text-black/60 font-bold">{m.college}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Pagination Controls */}
            <PaginationControls
              pagination={regsPagination}
              onPageChange={(p) => setRegsPage(p)}
              onPageSizeChange={(sz) => {
                setRegsPageSize(sz);
                setRegsPage(1);
              }}
              loading={tabLoading}
            />
          </div>
        </div>
      )}

      {/* TAB 4: CAMPUS AMBASSADOR REQUESTS */}
      {activeTab === "groups" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-4 border-black bg-white p-4 shadow-neo">
            <div className="relative min-w-[280px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/50" />
              <input
                type="text"
                placeholder="Search campus ambassadors by code, name, email, college..."
                value={groupsSearch}
                onChange={(e) => {
                  setGroupsSearch(e.target.value);
                  setGroupsPage(1);
                }}
                className="w-full border-2 border-black bg-neo-cream py-2 pl-9 pr-4 font-mono text-xs font-bold focus:outline-none"
              />
            </div>
            {data?.telemetry.googleSheets.groupEntrySpreadsheetId && (
              <a
                href={`https://docs.google.com/spreadsheets/d/${data.telemetry.googleSheets.groupEntrySpreadsheetId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 border-2 border-black bg-black px-3 py-2 text-xs font-black uppercase text-white hover:bg-zinc-800"
              >
                Open Ambassador Sheet <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            )}
          </div>

          <div className="overflow-x-auto border-4 border-black bg-white shadow-neo">
            <table className="w-full text-left text-xs">
              <thead className="border-b-4 border-black bg-black text-white font-mono uppercase">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Ambassador Contact</th>
                  <th className="px-4 py-3">College</th>
                  <th className="px-4 py-3">Contingent Size</th>
                  <th className="px-4 py-3">Pitch / Notes</th>
                  <th className="px-4 py-3">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-black/20">
                {groupsList.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center font-bold text-black/50">
                      {tabLoading ? "Loading ambassadors…" : "No campus ambassador applications yet."}
                    </td>
                  </tr>
                ) : (
                  groupsList.map((g) => (
                    <tr key={g.id} className="hover:bg-neo-secondary/20 transition-colors">
                      <td className="px-4 py-3 font-mono font-black text-sm">
                        <div className="flex items-center gap-1.5">
                          <span>{g.entryCode}</span>
                          <button
                            onClick={() => copyToClipboard(g.entryCode)}
                            className="text-black/40 hover:text-black"
                            title="Copy Ambassador Code"
                          >
                            {copiedCode === g.entryCode ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <p className="font-black text-black">{g.leadName}</p>
                        <p className="font-mono text-[11px] text-black/70">{g.email}</p>
                        <p className="font-mono text-[11px] text-black/70">{g.phone}</p>
                      </td>

                      <td className="px-4 py-3 font-bold text-black/80">{g.college}</td>

                      <td className="px-4 py-3">
                        <span className="inline-block border border-black bg-neo-muted px-2 py-0.5 text-[10px] font-black uppercase">
                          {g.groupSize} people
                        </span>
                      </td>

                      <td className="max-w-[280px] px-4 py-3">
                        <p className="truncate text-[11px] text-black/70" title={g.notes}>
                          {g.notes || "—"}
                        </p>
                      </td>

                      <td className="px-4 py-3 font-mono text-[11px] text-black/60">
                        {formatDateTimeIST(g.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Pagination Controls */}
            <PaginationControls
              pagination={groupsPagination}
              onPageChange={(p) => setGroupsPage(p)}
              onPageSizeChange={(sz) => {
                setGroupsPageSize(sz);
                setGroupsPage(1);
              }}
              loading={tabLoading}
            />
          </div>
        </div>
      )}

      {/* TAB 5: GOOGLE SHEETS CONTROL */}
      {activeTab === "sheets" && (
        <div className="space-y-6">
          <div className="border-4 border-black bg-white p-6 shadow-neo space-y-6">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-neo-accent">
                <FileSpreadsheet className="h-4 w-4" />
                <span>3-Way Google Spreadsheets Architecture</span>
              </div>
              <h2 className="mt-1 text-2xl font-black uppercase">
                Real-Time Spreadsheets Integration
              </h2>
              <p className="mt-1 text-sm font-bold text-black/70">
                Purchases and registrations are mirrored in real time to dedicated Google Spreadsheets using Google Service Account OAuth.
              </p>
            </div>

            {/* Direct Spreadsheet Links Grid */}
            <div className="grid gap-4 sm:grid-cols-3">
              {/* Basic Pass Sheet */}
              <div className="border-4 border-black bg-neo-cream p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-xs font-black uppercase text-black">1. Basic Pass Sheet</p>
                  <span className="border border-black bg-neo-secondary px-1.5 py-0.5 text-[10px] font-black">₹200</span>
                </div>
                <p className="text-xs font-bold text-black/60">
                  10 columns: Timestamp, Pass Code, Holder, Email, Phone, College, Order, Amount, State, Activated.
                </p>
                {data?.telemetry.googleSheets.basicSpreadsheetId && (
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${data.telemetry.googleSheets.basicSpreadsheetId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 border-2 border-black bg-black px-3 py-1.5 text-xs font-black uppercase text-white hover:bg-zinc-800"
                  >
                    Open Google Sheet <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>

              {/* VIP Delegate Pass Sheet */}
              <div className="border-4 border-black bg-black p-4 text-white space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-xs font-black uppercase text-neo-secondary">2. VIP Delegate Sheet</p>
                  <span className="border border-neo-secondary bg-neo-secondary px-1.5 py-0.5 text-[10px] font-black text-black">VIP</span>
                </div>
                <p className="text-xs font-bold text-white/70">
                  12 columns: Includes Star Night Concerts entitlement, VIP Front-Row status, and pass activation.
                </p>
                {data?.telemetry.googleSheets.delegateSpreadsheetId && (
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${data.telemetry.googleSheets.delegateSpreadsheetId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 border-2 border-neo-secondary bg-neo-secondary px-3 py-1.5 text-xs font-black uppercase text-black hover:bg-white"
                  >
                    Open Google Sheet <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>

              {/* Events Sheet */}
              <div className="border-4 border-black bg-neo-accent p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-xs font-black uppercase text-black">3. Events &amp; Teams Sheet</p>
                  <span className="border border-black bg-white px-1.5 py-0.5 text-[10px] font-black">Registrations</span>
                </div>
                <p className="text-xs font-bold text-black/70">
                  16 columns: Registration Code, Event Name, Category, Starts At, Venue, Team Members, Payment Status.
                </p>
                {data?.telemetry.googleSheets.eventsSpreadsheetId && (
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${data.telemetry.googleSheets.eventsSpreadsheetId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 border-2 border-black bg-black px-3 py-1.5 text-xs font-black uppercase text-white hover:bg-zinc-800"
                  >
                    Open Google Sheet <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>

            {/* Backfill & Sync Trigger Actions */}
            <div className="border-t-4 border-black pt-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-black uppercase">Run Historical Backfill</h3>
                <p className="text-xs font-bold text-black/60">
                  Synchronizes all confirmed orders, passes, and event registrations from the DB to Google Sheets.
                </p>
              </div>

              <Button
                variant="primary"
                onClick={handleFullHistoricalSheetsSync}
                disabled={actionLoading === "full-sheets-sync"}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${actionLoading === "full-sheets-sync" ? "animate-spin" : ""}`} />
                {actionLoading === "full-sheets-sync" ? "Backfilling Spreadsheets…" : "Sync All Historical Records"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: QUICK MODULES & TOOLING */}
      {activeTab === "tools" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              href: "/admin/events",
              title: "Events & Pass Pricing",
              desc: "Create, edit, publish events, configure pass pricing, and manage inventory capacities.",
              icon: Trophy,
              color: "bg-white",
            },
            {
              href: "/admin/schedule",
              title: "Festival Schedule & Shows",
              desc: "5-day interactive timeline, star nights, ceremonies, and venue slots.",
              icon: Calendar,
              color: "bg-white",
            },
            {
              href: "/admin/staff",
              title: "Staff & Permissions (RBAC)",
              desc: "Invite coordinators, gate supervisors, and configure event scopes.",
              icon: ShieldCheck,
              color: "bg-white",
            },
            {
              href: "/admin/support",
              title: "Support Helpdesk & FAQs",
              desc: "Review and publish answers to participant questions submitted on /ask.",
              icon: HelpCircle,
              color: "bg-white",
            },
            {
              href: "/admin/notices",
              title: "Official Notice Board",
              desc: "Publish urgent notices, announcements, and push updates to participants.",
              icon: Bell,
              color: "bg-white",
            },
            {
              href: "/admin/exports",
              title: "CSV Snapshot Exports",
              desc: "Download immutable CSV ledger exports for financial auditing and gate roster.",
              icon: Layers,
              color: "bg-white",
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`border-4 border-black ${item.color} p-6 shadow-neo transition-all hover:-translate-y-1 hover:shadow-neo-lg group`}
              >
                <div className="flex items-center justify-between">
                  <Icon className="h-6 w-6 text-black" />
                  <ArrowUpRight className="h-5 w-5 text-black/40 group-hover:text-black transition-colors" />
                </div>
                <h3 className="mt-4 text-xl font-black uppercase tracking-tight">{item.title}</h3>
                <p className="mt-1 text-xs font-bold text-black/60">{item.desc}</p>
              </Link>
            );
          })}
        </div>
      )}

      {/* Manual Refund Confirmation Modal */}
      {refundModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="border-4 border-black bg-white p-6 shadow-neo-xl max-w-md w-full text-black space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 border-b-2 border-black pb-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-black bg-neo-accent">
                <AlertTriangle className="h-5 w-5 text-black" />
              </div>
              <div>
                <h3 className="text-base font-black uppercase tracking-tight">Confirm Pass Refund</h3>
                <p className="font-mono text-xs text-black/60">Order {refundModalOrder.publicOrderCode}</p>
              </div>
            </div>

            <div className="space-y-2 text-xs font-bold">
              <p>
                Are you sure you want to mark Order{" "}
                <strong className="font-mono">{refundModalOrder.publicOrderCode}</strong> for{" "}
                <strong className="text-black">{refundModalOrder.purchaser.name}</strong> (
                <span className="font-mono">{formatPaise(refundModalOrder.amountPaise)}</span>) as{" "}
                <span className="bg-red-100 text-red-800 px-1 py-0.5 font-black border border-red-600 uppercase">
                  REFUNDED
                </span>
                ?
              </p>

              <div className="border-2 border-black bg-neo-cream p-3 text-[11px] space-y-1">
                <p className="font-black uppercase text-black">What happens next:</p>
                <ul className="list-disc list-inside text-black/80 space-y-0.5">
                  <li>The order &amp; pass records are kept in the database as <strong>REFUNDED</strong> (not removed from DB).</li>
                  <li>All QR credentials for this pass will be revoked.</li>
                  <li>When scanned at the gate, the scanner will show <span className="font-black text-red-600 uppercase">RED</span> and <span className="font-black text-red-600 uppercase">REFUNDED</span>.</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t-2 border-black/10">
              <button
                type="button"
                onClick={() => setRefundModalOrder(null)}
                disabled={actionLoading === `refund-${refundModalOrder.id}`}
                className="border-2 border-black bg-white px-4 py-2 text-xs font-black uppercase hover:bg-zinc-100 disabled:opacity-50"
              >
                No, Cancel
              </button>
              <button
                type="button"
                onClick={() => handleProcessRefund(refundModalOrder.id)}
                disabled={actionLoading === `refund-${refundModalOrder.id}`}
                className="border-2 border-black bg-red-600 text-white px-4 py-2 text-xs font-black uppercase hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5 shadow-neo-sm"
              >
                {actionLoading === `refund-${refundModalOrder.id}` ? "Processing…" : "Yes, Mark Refunded"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
