#!/usr/bin/env node
/**
 * Static cross-check of the app against a real, fully migrated database.
 *
 * The vitest suite mocks Supabase, so a query naming a column that does not
 * exist, or an RPC called with the wrong parameter names, passes every test
 * and fails only in production (PostgREST rejects the whole request).
 * plpgsql bodies are likewise only resolved when they run. This checks:
 *
 *   1. every `.rpc("fn", { … })` in src/ against the function's real
 *      parameter names (all required ones present, no unknown ones);
 *   2. every `.from("table")` chain — select lists (including embedded
 *      relations), insert/update/upsert keys, onConflict and filter columns;
 *   3. every UPDATE … SET / INSERT INTO (…) column inside public plpgsql
 *      and SQL functions.
 *
 * Usage: DATABASE_URL=postgres://… node scripts/check-db-refs.mjs
 * (falls back to the standard PG* environment variables). Exits 1 on findings.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import ts from "typescript";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");

const client = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
await client.connect();

const procs = new Map();
for (const r of (
  await client.query(`
    select p.proname as name, coalesce(p.proargnames[1:p.pronargs], '{}') as args,
           p.pronargs as n, p.pronargdefaults as d
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'`)
).rows) {
  if (!procs.has(r.name)) procs.set(r.name, []);
  procs.get(r.name).push({ args: r.args, required: r.args.slice(0, r.n - r.d) });
}

const cols = new Map();
for (const r of (
  await client.query(`
    select table_name, column_name from information_schema.columns
    where table_schema in ('public', 'auth')`)
).rows) {
  if (!cols.has(r.table_name)) cols.set(r.table_name, new Set());
  cols.get(r.table_name).add(r.column_name);
}

const fnBodies = (
  await client.query(`
    select p.proname as name, p.prosrc as src
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where ns.nspname = 'public' and l.lanname in ('plpgsql', 'sql')`)
).rows;
await client.end();

const issues = [];

// ---------------------------------------------------------------------------
// 1 + 2. supabase-js call sites
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

const strLit = (n) =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;

/** Keys of an object literal, or null when not statically known. */
function objKeys(n) {
  if (!n || !ts.isObjectLiteralExpression(n)) return null;
  const keys = [];
  for (const p of n.properties) {
    if (ts.isSpreadAssignment(p) || !p.name) return null;
    keys.push(p.name.text ?? p.name.getText());
  }
  return keys;
}

/** The table named by the `.from("…")` at the root of a method chain. */
function chainTable(node) {
  let cur = node;
  while (cur) {
    if (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
      if (cur.expression.name.text === "from") {
        const expr = cur.expression.expression.getText();
        if (expr === "Buffer" || expr === "Array" || expr.includes("storage")) return null;
        return strLit(cur.arguments[0]);
      }
      cur = cur.expression.expression;
    } else if (ts.isPropertyAccessExpression(cur)) {
      cur = cur.expression;
    } else {
      return null;
    }
  }
  return null;
}

function splitTop(s) {
  const out = [];
  let depth = 0;
  let tok = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && ch === ",") {
      out.push(tok.trim());
      tok = "";
      continue;
    }
    tok += ch;
  }
  if (tok.trim()) out.push(tok.trim());
  return out;
}

function checkSelect(table, sel, where) {
  for (let t of splitTop(sel.replace(/\s+/g, " "))) {
    const embed = t.match(/^([^()]*?)\s*\((.*)\)$/s);
    if (embed) {
      let head = embed[1].trim();
      if (head.includes(":")) head = head.split(":")[1];
      const rel = head.split("!")[0].trim();
      if (!cols.has(rel)) issues.push(`${where}  ${table} embeds unknown relation "${rel}"`);
      else checkSelect(rel, embed[2], where);
      continue;
    }
    if (t === "*" || /^count\b/.test(t)) continue;
    if (t.includes(":") && !t.includes("::")) t = t.split(":")[1];
    t = t.split("::")[0].split("->")[0].trim();
    if (t && !cols.get(table).has(t)) issues.push(`${where}  ${table}.${t} does not exist (select)`);
  }
}

const FILTERS = new Set([
  "eq", "neq", "in", "is", "gt", "gte", "lt", "lte", "order",
  "not", "ilike", "like", "contains", "overlaps",
]);

for (const file of walk(join(ROOT, "src"))) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const rel = relative(ROOT, file);
  const loc = (n) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;

  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;

      if (method === "rpc") {
        const name = strLit(n.arguments[0]);
        const keys = n.arguments[1] ? objKeys(n.arguments[1]) : [];
        if (name && keys) {
          const candidates = procs.get(name);
          if (!candidates) {
            issues.push(`${loc(n)}  rpc ${name}: no such function`);
          } else if (
            !candidates.some(
              (c) => keys.every((k) => c.args.includes(k)) && c.required.every((r) => keys.includes(r))
            )
          ) {
            issues.push(
              `${loc(n)}  rpc ${name}(${keys.join(", ")}) matches no overload: ` +
                candidates.map((c) => `(${c.args.join(", ")})`).join(" | ")
            );
          }
        }
      }

      if (method === "from") {
        const expr = n.expression.expression.getText();
        if (expr !== "Buffer" && expr !== "Array" && !expr.includes("storage")) {
          const t = strLit(n.arguments[0]);
          if (t && !cols.has(t)) {
            issues.push(`${loc(n)}  from("${t}"): no such table or view`);
          }
        }
      }

      const isQuery = method === "select" || method === "insert" || method === "update" ||
        method === "upsert" || FILTERS.has(method);
      const table = isQuery ? chainTable(n.expression.expression) : null;
      if (table && cols.has(table)) {
        const known = cols.get(table);
        const check = (c, what) => {
          if (c && !known.has(c)) issues.push(`${loc(n)}  ${table}.${c} does not exist (${what})`);
        };
        if (method === "select") {
          const s = strLit(n.arguments[0]);
          if (s) checkSelect(table, s, loc(n));
        } else if (method === "insert" || method === "update" || method === "upsert") {
          let row = n.arguments[0];
          if (row && ts.isArrayLiteralExpression(row)) row = row.elements[0];
          for (const c of objKeys(row) ?? []) check(c, method);
          const opts = n.arguments[1];
          if (method === "upsert" && opts && ts.isObjectLiteralExpression(opts)) {
            const onConflict = opts.properties.find((p) => p.name?.text === "onConflict");
            const v = onConflict && strLit(onConflict.initializer);
            if (v) for (const c of v.split(",")) check(c.trim(), "onConflict");
          }
        } else {
          const c = strLit(n.arguments[0]);
          if (c && !c.includes(".") && !c.includes("->")) check(c, method);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// ---------------------------------------------------------------------------
// 3. Columns written inside database functions
// ---------------------------------------------------------------------------
const stripSql = (s) => s.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");

for (const fn of fnBodies) {
  const src = stripSql(fn.src);
  for (const m of src.matchAll(
    /\bupdate\s+(?:public\.)?(\w+)(?:\s+(?:as\s+)?\w+)?\s+set\s+(.*?)(?=\bwhere\b|\breturning\b|\bfrom\b|;)/gis
  )) {
    const t = m[1].toLowerCase();
    if (!cols.has(t)) continue;
    for (const assignment of splitTop(m[2])) {
      const col = assignment.match(/^\s*(?:\w+\.)?(\w+)\s*=/)?.[1]?.toLowerCase();
      if (col && !cols.get(t).has(col)) issues.push(`function ${fn.name}()  update ${t} set ${col}: no such column`);
    }
  }
  for (const m of src.matchAll(/\binsert\s+into\s+(?:public\.|auth\.)?(\w+)\s*\(([^)]*)\)/gis)) {
    const t = m[1].toLowerCase();
    if (!cols.has(t)) continue;
    for (const raw of m[2].split(",")) {
      const col = raw.trim().toLowerCase();
      if (col && !cols.get(t).has(col)) issues.push(`function ${fn.name}()  insert into ${t}(${col}): no such column`);
    }
  }
}

if (issues.length > 0) {
  console.error(`check-db-refs: ${issues.length} reference(s) do not match the database:\n`);
  for (const i of [...new Set(issues)]) console.error(`  ${i}`);
  process.exit(1);
}
console.log(`check-db-refs: OK (${procs.size} functions, ${cols.size} tables, ${fnBodies.length} function bodies)`);
