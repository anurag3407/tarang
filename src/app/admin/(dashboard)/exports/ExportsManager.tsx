"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatDateTimeIST } from "@/lib/dates";

/**
 * Export manager (plan §12.17). Request consistent CSV exports, poll state,
 * download when COMPLETED. Rate-limited server-side to 3/hour.
 */

interface ExportJob {
  id: string;
  exportType: string;
  state: string;
  rowCount: number | null;
  createdAt: string;
  error: string | null;
}

const TYPES = [
  "EVENT_REGISTRATIONS",
  "ROSTER",
  "FINANCE_LEDGER",
  "SCAN_HISTORY",
];

export default function ExportsManager() {
  const [exports, setExports] = useState<ExportJob[]>([]);
  const [type, setType] = useState(TYPES[0]);
  const [message, setMessage] = useState("");
  const [sheetsSyncing, setSheetsSyncing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/exports");
    const body = await res.json();
    if (body.ok) setExports(body.data.exports);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [load]);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const res = await fetch("/api/admin/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exportType: type }),
    });
    const body = await res.json();
    setMessage(body.ok ? "Export requested — it will appear below." : body.message ?? "Request failed");
    void load();
  }

  async function syncSheets() {
    setSheetsSyncing(true);
    try {
      const res = await fetch("/api/admin/exports/sheets-sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync_all" }),
      });
      const body = await res.json();
      setMessage(
        body.ok
          ? `✓ Sheets synced: ${body.data?.recordsSynced?.delegatePasses ?? 0} Pronite, ${body.data?.recordsSynced?.events ?? 0} Events, ${body.data?.recordsSynced?.merchandise ?? 0} Merch`
          : body.message ?? "Sheets sync failed"
      );
    } catch {
      setMessage("Sheets sync failed — network error");
    } finally {
      setSheetsSyncing(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black uppercase tracking-tighter">Data Exports &amp; Google Sheets</h1>
        <p className="mt-1 text-sm font-bold text-black/60">
          Generate immutable CSV ledger snapshots or trigger real-time Google Sheets synchronization.
        </p>
      </div>

      {/* Google Sheets Live Sync Card */}
      <div className="border-4 border-black bg-neo-secondary p-5 shadow-neo space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-mono text-xs font-black uppercase">
              <span className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
              <span>Real-Time Google Sheets 3-Way Mirror</span>
            </div>
            <h2 className="mt-1 text-xl font-black uppercase">Google Spreadsheets Live Sync</h2>
            <p className="text-xs font-bold text-black/70">
              Passes and event registrations automatically mirror to Google Sheets in real time.
            </p>
          </div>

          <Button variant="dark" onClick={syncSheets} disabled={sheetsSyncing}>
            {sheetsSyncing ? "Syncing..." : "Sync All Records to Sheets"}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-black uppercase">CSV Snapshot Exports</h2>

        <form onSubmit={request} className="flex flex-wrap items-end gap-3 border-4 border-black bg-white p-4 shadow-neo">
          <label className="text-xs font-black uppercase">
            Export type
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 block border-4 border-black bg-white px-3 py-2 text-sm font-bold focus:outline-none"
            >
              {TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="primary">
            Request export
          </Button>
          <p className="text-xs font-bold text-black/50">
            Built from a consistent snapshot. Limited to 3/hour.
          </p>
        </form>

        {message && <p className="border-4 border-black bg-neo-secondary px-3 py-2 text-sm font-bold">{message}</p>}

        <div className="overflow-x-auto border-4 border-black bg-white shadow-neo">
          <table className="w-full text-left text-sm">
            <thead className="border-b-4 border-black bg-neo-secondary">
              <tr>
                <th className="px-3 py-2 font-black uppercase">Type</th>
                <th className="px-3 py-2 font-black uppercase">State</th>
                <th className="px-3 py-2 font-black uppercase">Rows</th>
                <th className="px-3 py-2 font-black uppercase">Requested</th>
                <th className="px-3 py-2 font-black uppercase">Download</th>
              </tr>
            </thead>
            <tbody>
              {exports.map((x) => (
                <tr key={x.id} className="border-b-2 border-black/20">
                  <td className="px-3 py-2 font-bold">{x.exportType}</td>
                  <td className="px-3 py-2">
                    <span className="border-2 border-black bg-neo-muted px-2 py-0.5 text-xs font-black uppercase">
                      {x.state}
                    </span>
                    {x.error && <p className="mt-1 text-xs text-neo-accent">{x.error}</p>}
                  </td>
                  <td className="px-3 py-2">{x.rowCount ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{formatDateTimeIST(x.createdAt)}</td>
                  <td className="px-3 py-2">
                    {x.state === "COMPLETED" ? (
                      <a
                        href={`/api/admin/exports/${x.id}/download`}
                        className="border-2 border-black bg-neo-secondary px-2 py-1 text-xs font-black uppercase text-black hover:bg-white"
                      >
                        Download CSV
                      </a>
                    ) : (
                      <span className="text-xs font-bold text-black/40">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {exports.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center font-bold text-black/50">
                    No exports yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
