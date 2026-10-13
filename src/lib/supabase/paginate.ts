import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PostgREST caps every response at `max_rows` (1000 on Supabase), silently —
 * a `.limit(20000)` still returns at most 1000 rows. Bulk readers (exports,
 * Sheets backfill) must page with `.range()` instead.
 */
export const PAGE_SIZE = 1000;

/** Large `.in()` filters go in the URL; keep each request well under limits. */
const IN_CHUNK_SIZE = 200;

type PageResult<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

/**
 * Read every row of a query, one page at a time. `build` must apply a stable
 * `.order()` so pages neither overlap nor skip rows. Throws on a query error
 * rather than returning a silently partial result.
 */
export async function fetchAllPages<T>(
  build: (from: number, to: number) => PageResult<T>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** Run a query once per chunk of `ids` and concatenate the results. */
export async function fetchInChunks<T>(
  ids: string[],
  build: (chunk: string[]) => PageResult<T>
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const { data, error } = await build(ids.slice(i, i + IN_CHUNK_SIZE));
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}

export type ProfileSummary = {
  user_id: string;
  display_name: string | null;
  college_name: string | null;
  phone_e164: string | null;
  public_member_code: string | null;
};

/**
 * Profiles keyed by user id. `profiles` has no foreign key to
 * delegate_passes / registration_members (both reference auth.users), so it
 * cannot be embedded in those selects — PostgREST rejects the whole query.
 * Look profiles up separately instead.
 */
export async function fetchProfilesByUserId(
  sb: SupabaseClient,
  userIds: Iterable<string>
): Promise<Map<string, ProfileSummary>> {
  const ids = Array.from(new Set(userIds));
  const rows = await fetchInChunks<ProfileSummary>(ids, (chunk) =>
    sb
      .from("profiles")
      .select("user_id, display_name, college_name, phone_e164, public_member_code")
      .in("user_id", chunk)
  );
  return new Map(rows.map((p) => [p.user_id, p]));
}
