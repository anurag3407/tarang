/**
 * Chainable mock of the @supabase/supabase-js client surface used by the
 * services. Records every call so tests can assert on filters/payloads, and
 * returns queued responses per table / RPC name. Fully offline — no network.
 */

export interface SbResult {
  data?: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

export interface RecordedCall {
  kind: "rpc" | "table";
  name: string;
  action: string;
  filters: Record<string, unknown>;
  payload?: unknown;
  params?: Record<string, unknown>;
}

class QueryBuilder implements PromiseLike<SbResult> {
  private action = "select";
  private filters: Record<string, unknown> = {};
  private payload: unknown;

  constructor(
    private mock: MockSupabase,
    private table: string
  ) {}

  select(_cols?: string, _opts?: unknown): this {
    // A trailing .select() is PostgREST's RETURNING clause on writes —
    // keep the write action so callers can tell inserts from reads.
    if (this.payload === undefined) {
      this.action = "select";
    }
    return this;
  }
  insert(payload: unknown): this {
    this.action = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: unknown): this {
    this.action = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload: unknown, _opts?: unknown): this {
    this.action = "upsert";
    this.payload = payload;
    return this;
  }
  delete(): this {
    this.action = "delete";
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters[col] = val;
    return this;
  }
  in(col: string, vals: unknown): this {
    this.filters[`${col}:in`] = vals;
    return this;
  }
  lt(col: string, val: unknown): this {
    this.filters[`${col}:lt`] = val;
    return this;
  }
  lte(col: string, val: unknown): this {
    this.filters[`${col}:lte`] = val;
    return this;
  }
  gte(col: string, val: unknown): this {
    this.filters[`${col}:gte`] = val;
    return this;
  }
  not(col: string, op: string, val: unknown): this {
    this.filters[`${col}:${op}`] = val;
    return this;
  }
  or(source: string): this {
    this.filters["$or"] = source;
    return this;
  }
  neq(col: string, val: unknown): this {
    this.filters[`${col}:neq`] = val;
    return this;
  }
  gt(col: string, val: unknown): this {
    this.filters[`${col}:gt`] = val;
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters[`${col}:is`] = val;
    return this;
  }
  ilike(col: string, val: unknown): this {
    this.filters[`${col}:ilike`] = val;
    return this;
  }
  range(from: number, to: number): this {
    this.filters["range"] = [from, to];
    return this;
  }
  order(col: string, opts?: unknown): this {
    const existing = (this.filters["$order"] as unknown[]) ?? [];
    this.filters["$order"] = [...existing, { col, ...(opts as object ?? {}) }];
    return this;
  }
  limit(n: number): this {
    this.filters["$limit"] = n;
    return this;
  }

  private finish(): SbResult {
    return this.mock.recordAndRespond({
      kind: "table",
      name: this.table,
      action: this.action,
      filters: this.filters,
      payload: this.payload,
    });
  }

  maybeSingle(): SbResult {
    return this.finish();
  }
  single(): SbResult {
    return this.finish();
  }
  then<TResult1 = SbResult, TResult2 = never>(
    onfulfilled?: ((value: SbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.finish()).then(onfulfilled, onrejected);
  }
}

export class MockSupabase {
  calls: RecordedCall[] = [];
  private rpcQueues = new Map<string, SbResult[]>();
  private tableQueues = new Map<string, SbResult[]>();
  private fallback: SbResult = { data: null, error: null };
  /** RPC names that should throw (simulate transport/DB crashes). */
  private hardFailRpc = new Set<string>();

  /** Queue one or more responses for an RPC name (FIFO). */
  onRpc(name: string, ...results: SbResult[]): this {
    const q = this.rpcQueues.get(name) ?? [];
    q.push(...results);
    this.rpcQueues.set(name, q);
    return this;
  }

  /** Queue one or more responses for any query on a table (FIFO). */
  onTable(table: string, ...results: SbResult[]): this {
    const q = this.tableQueues.get(table) ?? [];
    q.push(...results);
    this.tableQueues.set(table, q);
    return this;
  }

  setFallback(result: SbResult): this {
    this.fallback = result;
    return this;
  }

  rpc(name: string, params?: Record<string, unknown>): SbResult {
    this.calls.push({ kind: "rpc", name, action: "rpc", filters: {}, params });
    if (this.hardFailRpc.has(name)) {
      throw new Error(`rpc ${name} crashed`);
    }
    const queue = this.rpcQueues.get(name);
    if (queue && queue.length > 0) {
      return queue.shift()!;
    }
    return this.fallback;
  }

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  auth: {
    getUser?: () => Promise<{
      data: { user: unknown };
      error: { message: string } | null;
    }>;
    admin: {
      getUserById: (
        _id: string
      ) => Promise<{ data: { user: { email: string } }; error: null }>;
      createUser: (
        _params: { email?: string; user_metadata?: Record<string, unknown> }
      ) => Promise<{ data: { user: { id: string; email?: string } } | null; error: { message: string } | null }>;
    };
  } = {
    admin: {
      getUserById: async (_id: string) => ({
        data: { user: { email: "user@example.com" } },
        error: null,
      }),
      createUser: async (params: { email?: string; user_metadata?: Record<string, unknown> }) => ({
        data: { user: { id: "user-created-mock-id", email: params.email } },
        error: null,
      }),
    },
  };

  recordAndRespond(call: RecordedCall): SbResult {
    this.calls.push(call);
    const queue =
      call.kind === "rpc"
        ? this.rpcQueues.get(call.name)
        : this.tableQueues.get(call.name);
    if (queue && queue.length > 0) {
      return queue.shift()!;
    }
    return this.fallback;
  }

  /** All recorded calls matching a kind + name. */
  callsFor(name: string): RecordedCall[] {
    return this.calls.filter((c) => c.name === name);
  }

  /** First recorded RPC call for a name (params inspection). */
  rpcParams(name: string): Record<string, unknown> | undefined {
    return this.callsFor(name).find((c) => c.kind === "rpc")?.params;
  }

  /** Make an RPC throw when called (simulates a DB crash, not just an error row). */
  failHardOnRpc(name: string): this {
    this.hardFailRpc.add(name);
    return this;
  }

  /** Total queued (not yet consumed) responses across all tables + RPCs. */
  pendingCount(): number {
    let n = 0;
    for (const q of this.rpcQueues.values()) n += q.length;
    for (const q of this.tableQueues.values()) n += q.length;
    return n;
  }

  /** Clear calls, queues and special-cases back to a pristine mock. */
  reset(): void {
    this.calls = [];
    this.rpcQueues.clear();
    this.tableQueues.clear();
    this.hardFailRpc.clear();
    this.fallback = { data: null, error: null };
  }
}

export function ok(data: unknown): SbResult {
  return { data, error: null };
}

export function fail(message: string, code?: string): SbResult {
  return { data: null, error: { message, code } };
}
