import "server-only";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { stringify } from "csv-stringify/sync";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { logger } from "@/lib/logger";
import { fetchAllPages, fetchProfilesByUserId } from "@/lib/supabase/paginate";

/**
 * Export worker (plan §12.17, §12.18).
 *
 * Builds requested CSV exports from a single consistent snapshot. Files are
 * written to a local export directory referenced by storage_object_path and
 * expire after 24h (admin UI) / 7d (row purge). Column policy keeps PII to
 * the minimum needed for operations.
 *
 * Jobs are claimed atomically (claim_export_jobs: FOR UPDATE SKIP LOCKED with
 * a lease), so overlapping workers — the scheduled loop and QStash wakes —
 * never double-process. A worker crash mid-build recovers once the lease
 * expires; transient failures retry with backoff via fail_export_job.
 */

const EXPORT_PURGE_DAYS = 7;
const LOCAL_PURGE_MS = EXPORT_PURGE_DAYS * 24 * 3600_000;

const EXPORT_DIR = process.env.EXPORT_DIR ?? path.join(process.cwd(), ".exports");

// CSV formula injection guard (V-10): cells beginning with these characters
// are interpreted as formulas by Excel/Sheets. Prefixing with a single quote
// forces text interpretation. Applied to string cells only so numeric columns
// (e.g. amount_paise) are not corrupted.
const CSV_FORMULA_RE = /^[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/;

type ExportJob = {
  id: string;
  export_type: string;
  festival_id: string;
  filter_snapshot: Record<string, unknown>;
};

let lastExportPurgeAt = 0;
const EXPORT_PURGE_INTERVAL_MS = 3600_000; // 1 hour

export async function runExportWorker(opts: { batchSize?: number } = {}): Promise<{
  completed: number;
  failed: number;
}> {
  const log = logger();
  const sb = createServiceRoleClient();

  // Best-effort housekeeping: expire COMPLETED rows older than 7 days
  // Runs at most once per hour so idle workers do not churn database RPCs
  const now = Date.now();
  if (now - lastExportPurgeAt > EXPORT_PURGE_INTERVAL_MS) {
    lastExportPurgeAt = now;
    await purgeExpiredExports(sb, log);
  }

  // Atomic lease-based claim: REQUESTED / RETRY_WAIT jobs, plus RUNNING jobs
  // whose lease expired (crashed worker recovery).
  const { data: jobs, error } = await sb.rpc("claim_export_jobs", {
    p_owner: "export-worker",
    p_batch_size: opts.batchSize ?? 3,
    p_lease_seconds: 300,
  });
  if (error) {
    log.error({ err: error.message }, "export claim failed");
    return { completed: 0, failed: 0 };
  }

  let completed = 0;
  let failed = 0;

  for (const job of (jobs ?? []) as ExportJob[]) {
    try {
      const rows = await buildRows(job);
      const csv = stringify(rows, {
        header: true,
        cast: {
          string: (value: string) => (CSV_FORMULA_RE.test(value) ? `'${value}` : value),
        },
      });
      const checksum = createHash("sha256").update(csv).digest("hex");

      await mkdir(EXPORT_DIR, { recursive: true });
      const filePath = path.join(EXPORT_DIR, `${job.id}.csv`);
      await writeFile(filePath, csv, "utf8");

      await sb
        .from("export_jobs")
        .update({
          state: "COMPLETED",
          storage_object_path: filePath,
          checksum,
          row_count: rows.length,
          as_of: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          lease_owner: null,
          lease_expires_at: null,
        })
        .eq("id", job.id);
      completed++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err: message, jobId: job.id }, "export failed");
      // Transient failures retry with exponential backoff; permanent ones
      // land in FAILED (visible to the requester) after max attempts.
      const { error: failError } = await sb.rpc("fail_export_job", {
        p_job_id: job.id,
        p_error: message,
      });
      if (failError) {
        log.error({ err: failError.message, jobId: job.id }, "export fail-record failed");
      }
    }
  }

  return { completed, failed };
}

/**
 * Expire COMPLETED export rows older than 7 days (DB) and unlink their local
 * CSV files (disk). Both steps are best-effort: housekeeping must never take
 * a tick down or mask a real job error.
 */
async function purgeExpiredExports(
  sb: ReturnType<typeof createServiceRoleClient>,
  log: ReturnType<typeof logger>
): Promise<void> {
  const { error: purgeError } = await sb.rpc("purge_expired_exports", {
    p_older_than_days: EXPORT_PURGE_DAYS,
  });
  if (purgeError) {
    log.warn({ err: purgeError.message }, "export purge (db) failed");
  }

  try {
    const entries = await readdir(EXPORT_DIR, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".csv")) continue;
      const filePath = path.join(EXPORT_DIR, entry.name);
      try {
        const st = await stat(filePath);
        if (now - st.mtimeMs > LOCAL_PURGE_MS) {
          await unlink(filePath);
          log.info({ file: filePath }, "export purge (disk) removed file");
        }
      } catch {
        // File vanished between listing and stat/unlink — nothing to do.
      }
    }
  } catch {
    // Export dir does not exist yet — nothing to purge.
  }
}

async function buildRows(job: ExportJob): Promise<Record<string, unknown>[]> {
  const sb = createServiceRoleClient();
  const festivalId = job.festival_id;
  const eventId = job.filter_snapshot.eventId as string | undefined;

  // Every query below pages past PostgREST's max_rows cap and throws on a
  // query error, so a failed read fails the job (and retries) instead of
  // completing with an empty or truncated CSV.
  switch (job.export_type) {
    case "EVENT_REGISTRATIONS": {
      // registrations has no festival_id column — scope through the owning
      // event. `!inner` embed + filter on the embedded column drops rows
      // whose event belongs to another festival (V: export isolation).
      type RegRow = {
        public_registration_code: string;
        registration_mode: string;
        team_name: string | null;
        confirmed_at: string | null;
        events: { name?: string } | { name?: string }[] | null;
        registration_members: { role: string; user_id: string }[] | null;
      };
      const data = await fetchAllPages<RegRow>((from, to) => {
        let query = sb
          .from("registrations")
          .select(
            `public_registration_code, registration_mode, team_name, state, confirmed_at,
             events!inner ( name, slug ),
             registration_members ( role, user_id )`
          )
          .eq("events.festival_id", festivalId)
          .eq("state", "CONFIRMED");
        if (eventId) query = query.eq("event_id", eventId);
        return query.order("created_at", { ascending: true }).order("id").range(from, to);
      });

      const profiles = await fetchProfilesByUserId(
        sb,
        data.flatMap((reg) => (reg.registration_members ?? []).map((m) => m.user_id))
      );

      const rows: Record<string, unknown>[] = [];
      for (const reg of data) {
        const event = Array.isArray(reg.events) ? reg.events[0] : reg.events;
        for (const m of reg.registration_members ?? []) {
          const profile = profiles.get(m.user_id);
          rows.push({
            registration_code: reg.public_registration_code,
            event: event?.name ?? "",
            mode: reg.registration_mode,
            team: reg.team_name ?? "",
            member_role: m.role,
            member_name: profile?.display_name ?? "",
            member_college: profile?.college_name ?? "",
            member_code: profile?.public_member_code ?? "",
            confirmed_at: reg.confirmed_at ?? "",
          });
        }
      }
      return rows;
    }

    case "ROSTER": {
      type PassRow = {
        public_pass_code: string;
        user_id: string;
        activated_at: string | null;
        pass_products: { name?: string } | { name?: string }[] | null;
      };
      const data = await fetchAllPages<PassRow>((from, to) =>
        sb
          .from("delegate_passes")
          .select(`public_pass_code, user_id, state, activated_at, pass_products ( name )`)
          .eq("festival_id", festivalId)
          .eq("state", "ACTIVE")
          .order("created_at", { ascending: true })
          .order("id")
          .range(from, to)
      );

      const profiles = await fetchProfilesByUserId(sb, data.map((p) => p.user_id));

      return data.map((p) => {
        const profile = profiles.get(p.user_id);
        const product = Array.isArray(p.pass_products) ? p.pass_products[0] : p.pass_products;
        return {
          pass_code: p.public_pass_code,
          pass_type: product?.name ?? "",
          name: profile?.display_name ?? "",
          college: profile?.college_name ?? "",
          member_code: profile?.public_member_code ?? "",
          activated_at: p.activated_at ?? "",
        };
      });
    }

    case "FINANCE_LEDGER": {
      // payments has no festival_id column — scope through the linked order.
      // `!inner` on orders excludes provider-observed payments that were never
      // captured locally (local_order_id NULL, no money moved); every captured
      // payment is linked by apply_captured_payment, so no real money row is
      // dropped by the join.
      type PaymentRow = {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        amount_paise: number | string;
        currency: string;
        provider_status: string;
        disposition: string | null;
        refunded_paise: number | string | null;
        provider_created_at: string | null;
        local_order_id: string | null;
      };
      const data = await fetchAllPages<PaymentRow>((from, to) =>
        sb
          .from("payments")
          .select(
            `razorpay_payment_id, razorpay_order_id, amount_paise, currency,
             provider_status, disposition, refunded_paise, provider_created_at,
             local_order_id,
             orders!inner ( festival_id )`
          )
          .eq("orders.festival_id", festivalId)
          .order("provider_created_at", { ascending: true })
          .order("id")
          .range(from, to)
      );

      return data.map((p) => ({
        payment_id: p.razorpay_payment_id,
        order_id: p.razorpay_order_id,
        local_order_id: p.local_order_id,
        amount_paise: Number(p.amount_paise),
        currency: p.currency,
        status: p.provider_status,
        disposition: p.disposition,
        refunded_paise: Number(p.refunded_paise ?? 0),
        provider_created_at: p.provider_created_at ?? "",
      }));
    }

    case "SCAN_HISTORY": {
      // scan_attempts has no festival_id column — scope through the gate.
      type ScanRow = {
        scan_id: string;
        outcome: string;
        reason_code: string | null;
        offline_provisional: boolean;
        received_at_server: string;
        gates: { name?: string } | { name?: string }[] | null;
      };
      const data = await fetchAllPages<ScanRow>((from, to) =>
        sb
          .from("scan_attempts")
          .select(
            `scan_id, outcome, reason_code, offline_provisional, received_at_server,
             gates!inner ( name )`
          )
          .eq("gates.festival_id", festivalId)
          .order("received_at_server", { ascending: false })
          .order("scan_id")
          .range(from, to)
      );

      return data.map((s) => {
        const gate = Array.isArray(s.gates) ? s.gates[0] : s.gates;
        return {
          scan_id: s.scan_id,
          gate: gate?.name ?? "",
          outcome: s.outcome,
          reason: s.reason_code ?? "",
          offline: s.offline_provisional,
          at: s.received_at_server,
        };
      });
    }

    default:
      throw new Error(`Unknown export type: ${job.export_type}`);
  }
}
