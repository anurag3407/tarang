import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_ID,
  EVENT_ID,
  FESTIVAL_ID,
  resetWorld,
  sb,
  userSb,
} from "./helpers/mocks";
import {
  ctx,
  get,
  json,
  post,
  expectOkEnvelope,
  expectErrEnvelope,
} from "./helpers/requests";

vi.mock("@/lib/supabase/service-role", async () => {
  const m = await import("./helpers/mocks");
  return { createServiceRoleClient: () => m.sb };
});
vi.mock("@/lib/supabase/server", async () => {
  const m = await import("./helpers/mocks");
  return { createServerSupabase: async () => m.userSb };
});
vi.mock("@/lib/redis/rate-limits", async () => {
  const m = await import("./helpers/mocks");
  return {
    checkRateLimit: m.rateLimiter.checkRateLimit.bind(m.rateLimiter),
    enforceRateLimit: m.rateLimiter.enforceRateLimit.bind(m.rateLimiter),
  };
});

import { GET as exportsListRoute, POST as exportsRequestRoute } from "@/app/api/admin/exports/route";
import { GET as exportDownloadRoute } from "@/app/api/admin/exports/[id]/download/route";

const EXPORT_JOB_ID = "3e9d3c30-4b4a-4cf0-a8f0-3e9d30b3c30f";
let EXPORT_DIR: string;

beforeAll(() => {
  EXPORT_DIR = mkdtempSync(join(tmpdir(), "pulse-e2e-exports-"));
  // The worker resolves EXPORT_DIR at module load -> set before dynamic import.
  process.env.EXPORT_DIR = EXPORT_DIR;
});
afterAll(() => {
  rmSync(EXPORT_DIR, { recursive: true, force: true });
  delete process.env.EXPORT_DIR;
});

beforeEach(() => {
  resetWorld({ actor: { id: ADMIN_ID, email: "admin@example.com", confirmed: true } });
});

function grantExport(permission = true): void {
  userSb.onRpc("has_permission", { data: permission, error: null });
}

describe("POST /api/admin/exports (plan §12.17)", () => {
  it("creates a REQUESTED job scoped to the caller + festival", async () => {
    grantExport();
    sb.onTable("export_jobs", { data: { id: EXPORT_JOB_ID }, error: null });

    const res = await exportsRequestRoute(
      post("/api/admin/exports", { body: { exportType: "ROSTER" } })
    );
    expect(res.status).toBe(202);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data).toMatchObject({ exportId: EXPORT_JOB_ID, state: "REQUESTED" });

    const insert = sb.callsFor("export_jobs").find((c) => c.action === "insert")!;
    expect(insert.payload as Record<string, unknown>).toMatchObject({
      requested_by: ADMIN_ID,
      festival_id: FESTIVAL_ID,
      export_type: "ROSTER",
      state: "REQUESTED",
      filter_snapshot: {},
    });
  });

  it("stores the eventId filter when provided", async () => {
    grantExport();
    sb.onTable("events", { data: { id: EVENT_ID }, error: null });
    sb.onTable("export_jobs", { data: { id: EXPORT_JOB_ID }, error: null });

    await exportsRequestRoute(
      post("/api/admin/exports", { body: { exportType: "EVENT_REGISTRATIONS", eventId: EVENT_ID } })
    );
    const insert = sb.callsFor("export_jobs").find((c) => c.action === "insert")!;
    expect((insert.payload as Record<string, unknown>).filter_snapshot).toEqual({
      eventId: EVENT_ID,
    });
  });

  it("rejects an eventId that does not belong to the caller's festival", async () => {
    grantExport();
    sb.onTable("events", { data: null, error: null });
    sb.onTable("export_jobs", { data: { id: EXPORT_JOB_ID }, error: null });

    const res = await exportsRequestRoute(
      post("/api/admin/exports", { body: { exportType: "EVENT_REGISTRATIONS", eventId: EVENT_ID } })
    );
    expect(res.status).toBe(404);
    const body = await json(res);
    expectErrEnvelope(body, "NOT_FOUND");
    // No export job may be created for an out-of-festival event.
    expect(sb.callsFor("export_jobs").find((c) => c.action === "insert")).toBeUndefined();
  });

  it("demands finance.read for the ledger export even when export permission passes", async () => {
    grantExport(); // registration.export
    userSb.onRpc("has_permission", { data: false, error: null }); // finance.read

    const res = await exportsRequestRoute(
      post("/api/admin/exports", { body: { exportType: "FINANCE_LEDGER" } })
    );
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
    expect(sb.callsFor("export_jobs")).toHaveLength(0); // nothing created
  });

  it("422s unknown export types", async () => {
    grantExport();

    const res = await exportsRequestRoute(
      post("/api/admin/exports", { body: { exportType: "EVERYTHING_PLEASE" } })
    );
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
  });

  it("403s callers without registration.export", async () => {
    grantExport(false);

    const res = await exportsRequestRoute(
      post("/api/admin/exports", { body: { exportType: "ROSTER" } })
    );
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
  });
});

describe("GET /api/admin/exports", () => {
  it("lists jobs with lifecycle fields", async () => {
    grantExport();
    sb.onTable("export_jobs", {
      data: [
        {
          id: EXPORT_JOB_ID,
          export_type: "ROSTER",
          state: "COMPLETED",
          row_count: 2,
          as_of: "2026-08-22T10:00:00Z",
          expires_at: "2026-08-23T10:00:00Z",
          error: null,
          created_at: "2026-08-22T09:59:00Z",
          completed_at: "2026-08-22T10:00:00Z",
        },
      ],
      error: null,
    });

    const res = await exportsListRoute(get("/api/admin/exports"));
    const body = await json(res);
    expectOkEnvelope(body);
    const job = (body.data.exports as Array<Record<string, unknown>>)[0];
    expect(job).toMatchObject({
      id: EXPORT_JOB_ID,
      state: "COMPLETED",
      rowCount: 2,
      error: null,
    });
  });
});

describe("export worker (plan §12.17) — real CSV build", () => {
  it("builds the ROSTER CSV, checksums and completes the job", async () => {
    grantExport();
    sb.onRpc("purge_expired_exports", { data: null, error: null });
    // Atomic lease claim returns the REQUESTED payload the worker should build.
    sb.onRpc("claim_export_jobs", {
      data: [{ id: EXPORT_JOB_ID, export_type: "ROSTER", filter_snapshot: {} }],
      error: null,
    });
    sb.onTable("delegate_passes", {
      data: [
        {
          public_pass_code: "PS-E2E-0001",
          user_id: "u-roster-1",
          state: "ACTIVE",
          activated_at: "2026-08-20T10:00:00Z",
          pass_products: { name: "Pronite Pass" },
        },
        {
          public_pass_code: "PS-E2E-0002",
          user_id: "u-roster-2",
          state: "ACTIVE",
          activated_at: "2026-08-20T11:00:00Z",
          pass_products: { name: "Pronite Pass" },
        },
      ],
      error: null,
    });
    // profiles has no FK to delegate_passes: the worker looks them up separately.
    sb.onTable("profiles", {
      data: [
        {
          user_id: "u-roster-1",
          display_name: "Aarav Sharma",
          college_name: "Some College",
          public_member_code: "PM-000001",
        },
      ],
      error: null,
    });
    sb.onTable("export_jobs", { data: null, error: null }); // COMPLETED update

    const { runExportWorker } = await import("@/workers/export-worker");
    const result = await runExportWorker({ batchSize: 3 });

    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);

    const updates = sb.callsFor("export_jobs").filter((c) => c.action === "update");
    expect(sb.rpcParams("claim_export_jobs")).toMatchObject({
      p_owner: "export-worker",
      p_batch_size: 3,
      p_lease_seconds: 300,
    });
    expect(sb.rpcParams("purge_expired_exports")).toMatchObject({
      p_older_than_days: 7,
    });
    const completed = updates.find(
      (u) => (u.payload as Record<string, unknown>).state === "COMPLETED"
    )!;
    const filePath = (completed.payload as Record<string, unknown>).storage_object_path as string;
    const checksum = (completed.payload as Record<string, unknown>).checksum as string;
    // The lease is released on completion so other workers can pick the job up only via claim.
    expect(completed.payload).toMatchObject({ lease_owner: null, lease_expires_at: null });

    // The CSV really exists on disk with a matching SHA-256.
    const csv = readFileSync(filePath, "utf8");
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(csv).digest("hex")).toBe(checksum);
    expect(csv).toContain("pass_code,pass_type,name,college");
    expect(csv).toContain("PS-E2E-0001,Pronite Pass,Aarav Sharma,Some College");
    expect(csv).toContain("PS-E2E-0002,Pronite Pass,,");
    // The roster is paged past PostgREST's 1000-row cap, not .limit()ed.
    const rosterQuery = sb.callsFor("delegate_passes")[0];
    expect(rosterQuery.filters.range).toEqual([0, 999]);

    // Keep the file for the download-endpoint test below.
    completedFilePaths.push(filePath);
  });

  it("records FAILED with the message for unknown export types", async () => {
    sb.onRpc("purge_expired_exports", { data: null, error: null });
    sb.onRpc("claim_export_jobs", {
      data: [{ id: EXPORT_JOB_ID, export_type: "NOT_A_THING", filter_snapshot: {} }],
      error: null,
    });
    sb.onRpc("fail_export_job", { data: null, error: null });

    const { runExportWorker } = await import("@/workers/export-worker");
    const result = await runExportWorker({ batchSize: 3 });

    expect(result.failed).toBe(1);
    const failParams = sb.rpcParams("fail_export_job");
    expect(failParams).toMatchObject({ p_job_id: EXPORT_JOB_ID });
    expect(String((failParams as Record<string, unknown>).p_error)).toContain("Unknown export type");
  });
});

describe("GET /api/admin/exports/:id/download", () => {
  const completedFilePathsLocal = completedFilePaths;

  it("streams the completed CSV as an attachment", async () => {
    grantExport();
    const filePath = completedFilePathsLocal[0];
    expect(filePath).toBeTruthy();

    sb.onTable("export_jobs", {
      data: {
        id: EXPORT_JOB_ID,
        export_type: "ROSTER",
        state: "COMPLETED",
        storage_object_path: filePath,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
      error: null,
    });

    const res = await exportDownloadRoute(get(`/api/admin/exports/${EXPORT_JOB_ID}/download`), ctx({ id: EXPORT_JOB_ID }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(`roster-${EXPORT_JOB_ID}.csv`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).toContain("PS-E2E-0001,Pronite Pass,Aarav Sharma");
  });

  it("409s a job that is not COMPLETED yet", async () => {
    grantExport();
    sb.onTable("export_jobs", {
      data: { id: EXPORT_JOB_ID, state: "RUNNING", storage_object_path: null },
      error: null,
    });

    const res = await exportDownloadRoute(get(`/api/admin/exports/${EXPORT_JOB_ID}/download`), ctx({ id: EXPORT_JOB_ID }));
    expect(res.status).toBe(409);
    expectErrEnvelope(await json(res), "CONFLICT");
  });

  it("409s an expired export", async () => {
    grantExport();
    sb.onTable("export_jobs", {
      data: {
        id: EXPORT_JOB_ID,
        state: "COMPLETED",
        storage_object_path: "/tmp/gone.csv",
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
      error: null,
    });

    const res = await exportDownloadRoute(get(`/api/admin/exports/${EXPORT_JOB_ID}/download`), ctx({ id: EXPORT_JOB_ID }));
    expect(res.status).toBe(409);
    const body = await json(res);
    expectErrEnvelope(body, "CONFLICT");
    expect(body.message).toMatch(/expired/i);
  });

  it("404s an unknown export id", async () => {
    grantExport();
    sb.onTable("export_jobs", { data: null, error: null });

    const res = await exportDownloadRoute(get(`/api/admin/exports/${EXPORT_JOB_ID}/download`), ctx({ id: EXPORT_JOB_ID }));
    expect(res.status).toBe(404);
    expectErrEnvelope(await json(res), "NOT_FOUND");
  });
});

/** Files produced by the worker test, consumed by download tests. */
const completedFilePaths: string[] = [];
