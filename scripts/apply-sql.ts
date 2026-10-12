/**
 * Apply raw SQL files to a Supabase project over a direct Postgres connection.
 *
 * Two uses:
 *   1. seed.sql — `supabase db push` only applies migrations, never the seed,
 *      so a remote project needs the seed applied explicitly.
 *   2. Migrations, when the Supabase CLI is unavailable — the files are applied
 *      in the order given and recorded in supabase_migrations.schema_migrations
 *      so a later `supabase db push` does not try to re-run them.
 *
 * Each file runs as a single multi-statement query inside one transaction, so
 * a failure rolls that file back rather than leaving a half-applied schema.
 *
 * Usage:
 *   pnpm db:apply supabase/seed.sql
 *   pnpm db:apply --migrations          # every file in supabase/migrations, in order
 *
 * Connection comes from SUPABASE_DB_SESSION_URL (preferred) or
 * SUPABASE_DB_DIRECT_URL. Use the session pooler (port 5432) — the transaction
 * pooler on 6543 cannot run DDL.
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

/** Map a Postgres error `position` back to a line number in the source file. */
function lineForPosition(sql: string, position?: string): string {
  if (!position) return "";
  const offset = Number(position);
  if (!Number.isFinite(offset)) return "";
  const line = sql.slice(0, offset).split("\n").length;
  const text = sql.split("\n")[line - 1]?.trim() ?? "";
  return ` (line ${line}: ${text.slice(0, 100)})`;
}

function resolveFiles(argv: string[]): string[] {
  if (argv.includes("--migrations")) {
    return readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => join(MIGRATIONS_DIR, f));
  }
  const files = argv.filter((a) => !a.startsWith("--"));
  if (files.length === 0) {
    fail(
      "Usage: pnpm db:apply <file.sql> [more.sql...]\n" +
        "       pnpm db:apply --migrations"
    );
  }
  return files;
}

/**
 * Record a migration in Supabase's history table so the CLI treats it as
 * already applied. Version is the leading digits of the filename.
 */
async function recordMigration(client: Client, file: string): Promise<void> {
  const name = file.replace(/\\/g, "/").split("/").pop() ?? file;
  const version = name.match(/^(\d+)/)?.[1];
  if (!version) return;
  await client.query(
    `create schema if not exists supabase_migrations;
     create table if not exists supabase_migrations.schema_migrations (
       version text primary key,
       statements text[],
       name text
     );`
  );
  await client.query(
    `insert into supabase_migrations.schema_migrations (version, name)
     values ($1, $2) on conflict (version) do nothing`,
    [version, name.replace(/^\d+_/, "").replace(/\.sql$/, "")]
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const files = resolveFiles(argv);
  const isMigrationRun = argv.includes("--migrations");

  const conn =
    process.env.SUPABASE_DB_SESSION_URL || process.env.SUPABASE_DB_DIRECT_URL;
  if (!conn || conn.startsWith("PASTE")) {
    fail(
      "No database connection string.\n" +
        "  Set SUPABASE_DB_SESSION_URL in .env.local — Supabase dashboard ->\n" +
        "  Project Settings -> Database -> Connection string -> URI (Session pooler, port 5432)."
    );
  }

  const ref = conn.match(/postgres\.([a-z0-9]{20})/)?.[1];
  const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(
    /https:\/\/([a-z0-9]+)\./
  )?.[1];
  if (ref && projectRef && ref !== projectRef) {
    fail(
      `Connection string points at project "${ref}" but NEXT_PUBLIC_SUPABASE_URL is "${projectRef}".\n` +
        "  Refusing to run — this would apply SQL to the wrong project."
    );
  }
  if (conn.includes(":6543")) {
    console.warn(
      "! Port 6543 is the transaction pooler and cannot run DDL. Use the session pooler (5432)."
    );
  }

  console.log(`Target project : ${projectRef ?? "(unknown)"}`);
  console.log(`Files          : ${files.length}\n`);

  const client = new Client({
    connectionString: conn,
    ssl: { rejectUnauthorized: false },
    // Long DDL scripts can exceed the default statement timeout on pooled
    // connections; migrations create ~49 tables plus policies and indexes.
    statement_timeout: 300_000,
  });

  try {
    await client.connect();
  } catch (err) {
    fail(
      `could not connect: ${err instanceof Error ? err.message : String(err)}\n` +
        "  Check the password in the connection string (URL-encode any special characters)."
    );
  }

  // Ensure schema_migrations table exists
  const appliedVersions = new Set<string>();
  if (isMigrationRun) {
    await client.query(`
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key,
        statements text[],
        name text
      );
    `);

    const { rows } = await client.query("select version from supabase_migrations.schema_migrations");
    for (const r of rows) {
      appliedVersions.add(String(r.version));
    }

    // If schema_migrations is empty but tables already exist, backfill
    if (appliedVersions.size === 0) {
      const { rows: tableCheck } = await client.query(
        "select 1 from information_schema.tables where table_schema = 'public' and table_name = 'festivals'"
      );
      if (tableCheck.length > 0) {
        console.log("Existing schema detected without migration tracking. Backfilling migration log...");
        for (const file of files) {
          await recordMigration(client, file);
          const name = file.replace(/\\/g, "/").split("/").pop() ?? file;
          const version = name.match(/^(\d+)/)?.[1];
          if (version) appliedVersions.add(version);
        }
      }
    }
  }

  let applied = 0;
  for (const file of files) {
    const name = file.replace(/\\/g, "/").split("/").pop() ?? file;
    const version = name.match(/^(\d+)/)?.[1];

    if (isMigrationRun && version && appliedVersions.has(version)) {
      console.log(`  ${name.padEnd(42)} \x1b[90mskipped (already applied)\x1b[0m`);
      continue;
    }

    let sql: string;
    try {
      sql = readFileSync(file, "utf8");
    } catch {
      fail(`cannot read ${file}`);
    }

    process.stdout.write(`  ${name.padEnd(42)}`);
    try {
      await client.query("begin");
      await client.query(sql);
      if (isMigrationRun) await recordMigration(client, file);
      await client.query("commit");
      applied += 1;
      console.log("\x1b[32mok\x1b[0m");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      console.log("\x1b[31mFAILED\x1b[0m");
      const e = err as {
        message?: string;
        detail?: string;
        hint?: string;
        position?: string;
      };
      console.error(`\n  ${e.message ?? String(err)}${lineForPosition(sql, e.position)}`);
      if (e.detail) console.error(`  detail: ${e.detail}`);
      if (e.hint) console.error(`  hint:   ${e.hint}`);
      console.error(
        `\n  Rolled back ${name}. ${applied} earlier file(s) remain applied.`
      );
      await client.end().catch(() => {});
      process.exit(1);
    }
  }

  await client.end();
  console.log(`\n✓ Applied ${applied} file(s) to ${projectRef ?? "the project"}`);
  if (isMigrationRun) {
    console.log("  Next: pnpm db:apply supabase/seed.sql");
  }
}

void main();
