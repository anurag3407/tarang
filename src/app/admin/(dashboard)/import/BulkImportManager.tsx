"use client";

import { useState, useId, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/Button";

interface EventOption {
  id: string;
  name: string;
  slug: string;
}

interface ParsedUserRow {
  name: string;
  email: string;
  phone: string;
  college: string;
  isValid: boolean;
  error?: string;
}

interface ImportRowResult {
  email: string;
  name: string;
  success: boolean;
  userCreated: boolean;
  userId?: string;
  passCode?: string;
  registrationCode?: string;
  orderCode?: string;
  qrIssued?: boolean;
  emailQueued?: boolean;
  error?: string;
}

/** Rows per request: small enough to finish well inside the 60s proxy timeout. */
const IMPORT_BATCH_SIZE = 25;

interface ImportSummary {
  message: string;
  processed: number;
  successful: number;
  failed: number;
  results: ImportRowResult[];
}

export default function BulkImportManager() {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  const [issuanceType, setIssuanceType] = useState<"PASS" | "EVENT">("PASS");
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [sendEmail, setSendEmail] = useState<boolean>(true);

  const [csvText, setCsvText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [googleSheetUrl, setGoogleSheetUrl] = useState<string>("");
  const [inputMode, setInputMode] = useState<"sheets" | "upload" | "paste">("sheets");

  const [isFetchingSheet, setIsFetchingSheet] = useState<boolean>(false);
  const [sheetFetchError, setSheetFetchError] = useState<string | null>(null);
  const [sheetSuccessMessage, setSheetSuccessMessage] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const fileInputId = useId();

  // Load events for dropdown selector when issuing competition entries
  useEffect(() => {
    async function loadOptions() {
      try {
        setLoadingOptions(true);
        const eventRes = await fetch("/api/public/events");
        const eventData = await eventRes.json();
        const evs = (eventData.ok && (eventData.data?.events || eventData.data?.items)) || [];
        if (evs.length > 0) {
          setEvents(evs);
          setSelectedEventId(evs[0].id);
        }
      } catch (err) {
        console.error("Failed to load events:", err);
      } finally {
        setLoadingOptions(false);
      }
    }
    void loadOptions();
  }, []);

  // Robust CSV / TSV parser supporting headers in various cases and quotes
  const parsedRows: ParsedUserRow[] = useMemo(() => {
    if (!csvText.trim()) return [];

    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return [];

    // Helper to split CSV line handling quoted cells
    function splitCsvLine(line: string): string[] {
      const result: string[] = [];
      let cur = "";
      let inQuote = false;
      const delimiter = line.includes("\t") ? "\t" : ",";

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' || char === "'") {
          inQuote = !inQuote;
        } else if (char === delimiter && !inQuote) {
          result.push(cur.trim().replace(/^["']|["']$/g, ""));
          cur = "";
        } else {
          cur += char;
        }
      }
      result.push(cur.trim().replace(/^["']|["']$/g, ""));
      return result;
    }

    const firstLineCells = splitCsvLine(lines[0]).map((c) => c.toLowerCase().trim());
    const isHeader =
      firstLineCells.some((c) => c.includes("name") || c.includes("email") || c.includes("mail")) ||
      firstLineCells.includes("college") ||
      firstLineCells.includes("phone");

    let headerIndex = { name: 0, email: 1, phone: 2, college: 3 };

    if (isHeader) {
      headerIndex = {
        name: firstLineCells.findIndex((c) => c.includes("name")),
        email: firstLineCells.findIndex((c) => c.includes("email") || c.includes("mail")),
        phone: firstLineCells.findIndex((c) => c.includes("phone") || c.includes("mobile") || c.includes("contact")),
        college: firstLineCells.findIndex((c) => c.includes("college") || c.includes("univ") || c.includes("institute") || c.includes("school")),
      };
      if (headerIndex.name === -1) headerIndex.name = 0;
      if (headerIndex.email === -1) headerIndex.email = 1;
    }

    const dataLines = isHeader ? lines.slice(1) : lines;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    return dataLines.map((line) => {
      const cells = splitCsvLine(line);
      const name = (headerIndex.name >= 0 ? cells[headerIndex.name] : cells[0]) || "";
      const email = (headerIndex.email >= 0 ? cells[headerIndex.email] : cells[1]) || "";
      const phone = (headerIndex.phone >= 0 ? cells[headerIndex.phone] : cells[2]) || "";
      const college = (headerIndex.college >= 0 ? cells[headerIndex.college] : cells[3]) || "";

      let isValid = true;
      let error = "";

      if (!name) {
        isValid = false;
        error = "Missing name";
      } else if (!email || !emailRegex.test(email.toLowerCase().trim())) {
        isValid = false;
        error = "Invalid email format";
      }

      return {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        phone: phone.trim(),
        college: college.trim(),
        isValid,
        error,
      };
    });
  }, [csvText]);

  const validRowCount = parsedRows.filter((r) => r.isValid).length;
  const invalidRowCount = parsedRows.length - validRowCount;

  async function handleFetchGoogleSheet(e: React.FormEvent) {
    e.preventDefault();
    if (!googleSheetUrl.trim()) return;

    setIsFetchingSheet(true);
    setSheetFetchError(null);
    setSheetSuccessMessage(null);

    try {
      const res = await fetch("/api/admin/fetch-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: googleSheetUrl.trim() }),
      });

      const json = await res.json();
      if (!json.ok) {
        setSheetFetchError(json.error?.message || json.message || "Failed to fetch Google Sheet");
      } else {
        setCsvText(json.data.csvText);
        setSheetSuccessMessage("✓ Successfully loaded data from Google Sheet!");
      }
    } catch (err) {
      setSheetFetchError(err instanceof Error ? err.message : "Failed to connect to server");
    } finally {
      setIsFetchingSheet(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    if (file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls")) {
      try {
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const csv = XLSX.utils.sheet_to_csv(worksheet);
        setCsvText(csv);
      } catch (err) {
        console.error("Failed to parse Excel file:", err);
      }
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (text) setCsvText(text);
      };
      reader.readAsText(file);
    }
  }

  function downloadSampleCsv() {
    const sample = `Name,Email,Phone,College\nRamesh Kumar,ramesh.kumar@example.com,9876543210,NIT Patna\nAarav Sharma,aarav.sharma@gmail.com,9811223344,IIT Patna\nPriya Patel,priya.patel@outlook.com,9822334455,Lady Hardinge Medical College\nRohan Gupta,rohan.gupta@vmmc.edu,9833445566,VMMC & Safdarjung Hospital\nAnanya Verma,ananya.verma@ucms.edu,9844556677,UCMS Delhi`;
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tarang_bulk_users_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleExecuteImport() {
    if (validRowCount === 0) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setSummary(null);

    try {
      const usersToImport = parsedRows
        .filter((r) => r.isValid)
        .map((r) => ({
          name: r.name,
          email: r.email,
          phone: r.phone || undefined,
          college: r.college || undefined,
        }));

      // Small batches keep every request well inside the proxy timeout; a
      // single 500-row request outlives it while the server keeps importing.
      const merged: ImportSummary = { message: "", processed: 0, successful: 0, failed: 0, results: [] };
      for (let i = 0; i < usersToImport.length; i += IMPORT_BATCH_SIZE) {
        const batch = usersToImport.slice(i, i + IMPORT_BATCH_SIZE);
        const res = await fetch("/api/admin/bulk-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issuanceType,
            eventId: issuanceType === "EVENT" ? selectedEventId : undefined,
            sendEmail,
            users: batch,
          }),
        });

        const json = await res.json();
        if (!json.ok) {
          const done = merged.processed;
          setSubmitError(
            `${json.message || "Bulk import failed"}${done > 0 ? ` (stopped after ${done} of ${usersToImport.length} rows — rows already processed are listed below)` : ""}`
          );
          break;
        }
        const data = json.data as ImportSummary;
        merged.processed += data.processed;
        merged.successful += data.successful;
        merged.failed += data.failed;
        merged.results.push(...data.results);
        merged.message = `Bulk import ${merged.processed < usersToImport.length ? "in progress" : "completed"}: ${merged.successful} succeeded, ${merged.failed} failed.`;
        setSummary({ ...merged, results: [...merged.results] });
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error during bulk import");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 space-y-8">
      {/* Header */}
      <div className="border-4 border-black bg-neo-secondary p-6 shadow-neo">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-black text-neo-secondary px-2.5 py-0.5 text-xs font-black uppercase tracking-widest">
                Admin Automation
              </span>
              <span className="text-xs font-bold text-black/70">
                TARANG 2026 · NIT PATNA
              </span>
            </div>
            <h1 className="mt-1 text-2xl sm:text-3xl font-black uppercase tracking-tight text-black">
              ⚡ Bulk User Seed &amp; Pronite Pass Issuance
            </h1>
            <p className="mt-1 text-sm font-bold text-black/80 max-w-2xl">
              Connect a Google Sheet, upload a CSV, or paste spreadsheet rows. The platform will automatically create accounts in the database, seed user profiles, issue Pronite Passes with Gate QR credentials or Event Registrations, and send confirmation emails with QR codes.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={downloadSampleCsv}
            className="border-2 border-black bg-white text-xs font-black uppercase hover:bg-black hover:text-white"
          >
            📥 Download Sample CSV
          </Button>
        </div>
      </div>

      {/* Step 1: Configuration & Input */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Configuration Settings */}
        <div className="border-4 border-black bg-white p-6 shadow-neo space-y-6 lg:col-span-1">
          <h2 className="text-lg font-black uppercase tracking-tight border-b-2 border-black pb-2">
            1. Issuance Options
          </h2>

          {/* Type Selector */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider mb-1.5">
              Select What to Issue:
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIssuanceType("PASS")}
                className={`border-2 border-black px-3 py-2 text-xs font-black uppercase transition-all ${
                  issuanceType === "PASS"
                    ? "bg-black text-neo-secondary shadow-neo-sm"
                    : "bg-neo-cream text-black hover:bg-white"
                }`}
              >
                🪪 Pronite Pass
              </button>
              <button
                type="button"
                onClick={() => setIssuanceType("EVENT")}
                className={`border-2 border-black px-3 py-2 text-xs font-black uppercase transition-all ${
                  issuanceType === "EVENT"
                    ? "bg-black text-neo-secondary shadow-neo-sm"
                    : "bg-neo-cream text-black hover:bg-white"
                }`}
              >
                🏆 Event Entry
              </button>
            </div>
          </div>

          {/* Pronite Pass Notice */}
          {issuanceType === "PASS" && (
            <div className="border-2 border-black bg-neo-secondary/20 p-3 space-y-1">
              <div className="flex items-center gap-1.5 font-black text-xs uppercase text-black">
                <span>🪪</span>
                <span>Pronite Pass</span>
              </div>
              <p className="text-[11px] font-bold text-black/70">
                Bulk issuance grants the Pronite Pass with a Gate Entry QR.
              </p>
            </div>
          )}

          {/* Event Dropdown */}
          {issuanceType === "EVENT" && (
            <div>
              <label className="block text-xs font-black uppercase tracking-wider mb-1.5 text-black">
                Select Competition / Event:
              </label>
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                disabled={loadingOptions && events.length === 0}
                className="w-full border-2 border-black bg-white dark:bg-zinc-900 text-black dark:text-white p-2.5 text-xs font-bold focus:outline-none shadow-neo-sm cursor-pointer"
              >
                {events.length > 0 ? (
                  events.map((ev) => (
                    <option key={ev.id} value={ev.id} className="bg-white text-black dark:bg-zinc-900 dark:text-white py-1">
                      🏆 {ev.name}
                    </option>
                  ))
                ) : (
                  <option value="" disabled className="bg-white text-black dark:bg-zinc-900 dark:text-white">
                    No published events found
                  </option>
                )}
              </select>
            </div>
          )}

          {/* Email Notification Checkbox */}
          <div className="border-2 border-black bg-neo-cream p-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-2 border-black accent-black"
              />
              <div className="text-xs font-bold">
                <span className="block font-black uppercase">Send Confirmation Emails</span>
                <span className="text-black/70">
                  Instantly delivers the Pronite Pass gate QR / Event registration confirmation to each recipient by email.
                </span>
              </div>
            </label>
          </div>

          <div className="border-l-4 border-black bg-neo-cream/50 pl-3 py-1 text-[11px] font-bold text-black/70">
            💡 <b>Account Creation:</b> If an email does not exist in Supabase Auth, an account is auto-created with confirmed email and populated profile. Existing accounts will receive their new Pronite Pass directly.
          </div>
        </div>

        {/* Right Column: Sheet Input (Google Sheets, File Upload, or Direct Paste) */}
        <div className="border-4 border-black bg-white p-6 shadow-neo space-y-4 lg:col-span-2 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between border-b-2 border-black pb-2 mb-4 gap-2">
              <h2 className="text-lg font-black uppercase tracking-tight">
                2. Input User Spreadsheet
              </h2>
              <div className="flex flex-wrap gap-1 text-xs font-black uppercase">
                <button
                  type="button"
                  onClick={() => setInputMode("sheets")}
                  className={`px-3 py-1 border-2 border-black transition-colors ${
                    inputMode === "sheets" ? "bg-black text-white" : "bg-neo-cream text-black hover:bg-white"
                  }`}
                >
                  🔗 Google Sheets
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("upload")}
                  className={`px-3 py-1 border-2 border-black transition-colors ${
                    inputMode === "upload" ? "bg-black text-white" : "bg-neo-cream text-black hover:bg-white"
                  }`}
                >
                  📁 File Upload
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("paste")}
                  className={`px-3 py-1 border-2 border-black transition-colors ${
                    inputMode === "paste" ? "bg-black text-white" : "bg-neo-cream text-black hover:bg-white"
                  }`}
                >
                  📋 Paste Text
                </button>
              </div>
            </div>

            {/* Google Sheets Link Mode */}
            {inputMode === "sheets" && (
              <div className="space-y-3">
                <form onSubmit={handleFetchGoogleSheet} className="space-y-3">
                  <div>
                    <label className="block text-xs font-black uppercase tracking-wider mb-1">
                      Paste Google Sheets URL or Share Link:
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="url"
                        value={googleSheetUrl}
                        onChange={(e) => setGoogleSheetUrl(e.target.value)}
                        placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0.../edit"
                        className="flex-1 border-2 border-black bg-neo-cream p-2.5 text-xs font-mono font-bold focus:bg-white focus:outline-none"
                      />
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={isFetchingSheet || !googleSheetUrl.trim()}
                        className="border-2 border-black bg-black text-neo-secondary px-4 py-2 text-xs font-black uppercase hover:bg-neo-secondary hover:text-black whitespace-nowrap"
                      >
                        {isFetchingSheet ? "Fetching..." : "📥 Fetch Sheet"}
                      </Button>
                    </div>
                  </div>
                </form>

                {sheetFetchError && (
                  <div className="border-2 border-red-700 bg-red-50 p-2.5 text-red-900 text-xs font-bold">
                    ❌ {sheetFetchError}
                  </div>
                )}

                {sheetSuccessMessage && (
                  <div className="border-2 border-green-700 bg-green-50 p-2.5 text-green-900 text-xs font-bold">
                    {sheetSuccessMessage} ({parsedRows.length} rows loaded)
                  </div>
                )}

                <div className="border border-black/30 bg-neo-cream/40 p-3 text-[11px] font-bold space-y-1">
                  <p className="font-black uppercase text-black">📋 Google Sheet Instructions:</p>
                  <p className="text-black/80">
                    1. Ensure columns are named: <b>Name</b>, <b>Email</b>, <b>Phone</b>, <b>College</b>.
                  </p>
                  <p className="text-black/80">
                    2. In Google Sheets, click <b>Share</b> → General access → set to <b>&ldquo;Anyone with the link can view&rdquo;</b>.
                  </p>
                  <p className="text-black/80">
                    3. Copy the URL and paste it above, then click <b>Fetch Sheet</b>.
                  </p>
                </div>
              </div>
            )}

            {/* File Upload Mode */}
            {inputMode === "upload" && (
              <div>
                <label
                  htmlFor={fileInputId}
                  className="flex flex-col items-center justify-center border-2 border-dashed border-black bg-neo-cream p-8 text-center cursor-pointer hover:bg-neo-secondary/30 transition-colors"
                >
                  <span className="text-3xl mb-2">📄</span>
                  <span className="text-sm font-black uppercase">
                    {fileName ? `Selected: ${fileName}` : "Click or drag & drop a .xlsx, .xls, or .csv file"}
                  </span>
                  <span className="text-xs font-bold text-black/60 mt-1">
                    Accepts Excel (.xlsx, .xls) and CSV (.csv) — Columns: Name, Email, Phone, College
                  </span>
                  <input
                    id={fileInputId}
                    type="file"
                    accept=".xlsx,.xls,.csv,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
                {fileName && (
                  <p className="mt-2 text-xs font-bold text-green-700">
                    ✓ File loaded successfully ({parsedRows.length} rows detected)
                  </p>
                )}
              </div>
            )}

            {/* Paste CSV Mode */}
            {inputMode === "paste" && (
              <div>
                <textarea
                  rows={7}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={`Name,Email,Phone,College\nAarav Sharma,aarav@example.com,9876543210,NIT Patna\nPriya Patel,priya@example.com,9811223344,MAMC`}
                  className="w-full border-2 border-black p-3 font-mono text-xs focus:outline-none bg-neo-cream focus:bg-white"
                />
                <p className="text-[11px] font-bold text-black/60 mt-1">
                  Format: Header line followed by rows. Comma or Tab separated.
                </p>
              </div>
            )}
          </div>

          {/* Quick Stats & Action Button */}
          <div className="border-t-2 border-black pt-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-4 text-xs font-bold">
              <span className="bg-neo-cream border border-black px-2.5 py-1">
                Total Rows: <b>{parsedRows.length}</b>
              </span>
              <span className="bg-green-100 border border-green-800 text-green-900 px-2.5 py-1">
                Valid: <b>{validRowCount}</b>
              </span>
              {invalidRowCount > 0 && (
                <span className="bg-red-100 border border-red-800 text-red-900 px-2.5 py-1">
                  Invalid: <b>{invalidRowCount}</b>
                </span>
              )}
            </div>

            <Button
              type="button"
              variant="primary"
              disabled={validRowCount === 0 || isSubmitting}
              onClick={handleExecuteImport}
              className="border-2 border-black bg-black text-neo-secondary px-6 py-2.5 text-xs font-black uppercase hover:bg-neo-secondary hover:text-black shadow-neo-sm disabled:opacity-50"
            >
              {isSubmitting
                ? "Processing Seed & Emails..."
                : `⚡ Execute Import (${validRowCount} Users)`}
            </Button>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {submitError && (
        <div className="border-4 border-black bg-red-100 p-4 text-red-900 font-bold shadow-neo">
          <p className="font-black uppercase text-sm">❌ Import Failed</p>
          <p className="text-xs mt-0.5">{submitError}</p>
        </div>
      )}

      {/* Step 2: Summary of Execution Results */}
      {summary && (
        <div className="border-4 border-black bg-white p-6 shadow-neo space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-black pb-4">
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight">
                🎉 Import &amp; Issuance Completed
              </h2>
              <p className="text-xs font-bold text-black/70 mt-0.5">
                {summary.message}
              </p>
            </div>
            <div className="flex gap-3">
              <span className="border-2 border-black bg-green-200 px-3 py-1 text-xs font-black uppercase">
                ✓ Succeeded: {summary.successful}
              </span>
              {summary.failed > 0 && (
                <span className="border-2 border-black bg-red-200 px-3 py-1 text-xs font-black uppercase">
                  ⚠ Failed: {summary.failed}
                </span>
              )}
            </div>
          </div>

          {/* Results Table */}
          <div className="overflow-x-auto border-2 border-black">
            <table className="w-full text-left text-xs font-bold border-collapse">
              <thead className="bg-black text-white text-[11px] font-black uppercase tracking-wider">
                <tr>
                  <th className="p-2.5 border-r border-white/20">#</th>
                  <th className="p-2.5 border-r border-white/20">Name</th>
                  <th className="p-2.5 border-r border-white/20">Email</th>
                  <th className="p-2.5 border-r border-white/20">Account</th>
                  <th className="p-2.5 border-r border-white/20">Issued Card / Code</th>
                  <th className="p-2.5 border-r border-white/20">QR Credential</th>
                  <th className="p-2.5 border-r border-white/20">Email Sent</th>
                  <th className="p-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/20 bg-white">
                {summary.results.map((r, i) => (
                  <tr key={r.email + i} className={r.success ? "hover:bg-neo-cream" : "bg-red-50"}>
                    <td className="p-2.5 border-r border-black/20">{i + 1}</td>
                    <td className="p-2.5 border-r border-black/20 font-black">{r.name}</td>
                    <td className="p-2.5 border-r border-black/20 font-mono text-[11px]">{r.email}</td>
                    <td className="p-2.5 border-r border-black/20">
                      {r.userCreated ? (
                        <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 text-[10px] font-black rounded border border-blue-400">
                          NEW USER
                        </span>
                      ) : (
                        <span className="bg-gray-100 text-gray-800 px-1.5 py-0.5 text-[10px] font-bold rounded border border-gray-400">
                          EXISTING
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 border-r border-black/20 font-mono font-black text-black">
                      {r.passCode || r.registrationCode || "—"}
                    </td>
                    <td className="p-2.5 border-r border-black/20">
                      {r.qrIssued ? (
                        <span className="text-green-700 font-black">✓ Active</span>
                      ) : (
                        <span className="text-black/50">—</span>
                      )}
                    </td>
                    <td className="p-2.5 border-r border-black/20">
                      {r.emailQueued ? (
                        <span className="text-green-700 font-black">✓ Sent</span>
                      ) : (
                        <span className="text-black/50">Skipped</span>
                      )}
                    </td>
                    <td className="p-2.5">
                      {r.success ? (
                        <span className="bg-green-100 text-green-900 border border-green-700 px-2 py-0.5 text-[10px] font-black uppercase">
                          SUCCESS
                        </span>
                      ) : (
                        <span className="bg-red-100 text-red-900 border border-red-700 px-2 py-0.5 text-[10px] font-black uppercase" title={r.error}>
                          ERROR: {r.error}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step 3: Live Preview Table (Before Submitting) */}
      {!summary && parsedRows.length > 0 && (
        <div className="border-4 border-black bg-white p-6 shadow-neo space-y-4">
          <div className="flex items-center justify-between border-b-2 border-black pb-2">
            <h2 className="text-lg font-black uppercase tracking-tight">
              3. Data Preview ({parsedRows.length} Rows Detected)
            </h2>
            <span className="text-xs font-bold text-black/60">
              Verify the parsed records before triggering the import
            </span>
          </div>

          <div className="overflow-x-auto border-2 border-black max-h-96">
            <table className="w-full text-left text-xs font-bold border-collapse">
              <thead className="bg-neo-cream border-b-2 border-black text-[11px] font-black uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="p-2.5 border-r border-black/20">#</th>
                  <th className="p-2.5 border-r border-black/20">Full Name</th>
                  <th className="p-2.5 border-r border-black/20">Email Address</th>
                  <th className="p-2.5 border-r border-black/20">Phone</th>
                  <th className="p-2.5 border-r border-black/20">College / Institute</th>
                  <th className="p-2.5">Validation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/20 bg-white">
                {parsedRows.map((r, i) => (
                  <tr key={r.email + i} className={r.isValid ? "hover:bg-neo-cream/40" : "bg-red-50"}>
                    <td className="p-2.5 border-r border-black/20">{i + 1}</td>
                    <td className="p-2.5 border-r border-black/20 font-black">{r.name || "—"}</td>
                    <td className="p-2.5 border-r border-black/20 font-mono text-[11px]">{r.email || "—"}</td>
                    <td className="p-2.5 border-r border-black/20">{r.phone || "—"}</td>
                    <td className="p-2.5 border-r border-black/20">{r.college || "—"}</td>
                    <td className="p-2.5">
                      {r.isValid ? (
                        <span className="text-green-700 font-black text-[11px]">✓ Valid</span>
                      ) : (
                        <span className="text-red-600 font-black text-[11px]">⚠ {r.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
