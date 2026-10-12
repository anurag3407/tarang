import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { AppError } from "@/lib/errors";
import { getCurrentFestivalId } from "@/repositories/public-content";
import { getFeatureFlagCache, setFeatureFlagCache } from "@/lib/redis/content-cache";
import type { PermissionCode } from "@/domain/auth";

/**
 * Server authorization (plan §11.5, §8).
 *
 * Mutations query current DB assignment/permission state — never stale JWT
 * claims. Feature flags are read from Redis with a 5s TTL and fall back to
 * Postgres; checkout flags fail closed when undeterminable.
 */

export interface AuthContext {
  userId: string;
  email: string | null;
  festivalId: string;
}

/** Require a signed-in user with a verified email. */
export async function requireUser(): Promise<AuthContext> {
  const sb = await createServerSupabase();
  const {
    data: { user },
    error,
  } = await sb.auth.getUser();
  if (error || !user) {
    throw new AppError("UNAUTHORIZED", "Authentication required");
  }
  if (user.email && !user.email_confirmed_at) {
    throw new AppError("UNAUTHORIZED", "Please verify your email before continuing");
  }
  const festivalId = await getCurrentFestivalId();
  if (!festivalId) {
    throw new AppError("FEATURE_DISABLED", "No active festival");
  }
  return { userId: user.id, email: user.email ?? null, festivalId };
}

/**
 * Require a permission for the current user. Throws FORBIDDEN when the user
 * has no active staff assignment granting the code (event-scoped when
 * eventId is provided).
 */
export async function requirePermission(
  code: PermissionCode,
  eventId?: string
): Promise<AuthContext> {
  const ctx = await requireUser();
  // has_permission() resolves auth.uid(), so it must run on the user's own
  // session client — never the service-role client (plan §8).
  const sb = await createServerSupabase();

  const { data, error } = await sb.rpc("has_permission", {
    p_permission: code,
    p_event_id: eventId ?? null,
    p_festival_id: ctx.festivalId,
  });
  if (error) {
    throw new AppError("INTERNAL", "Authorization check failed");
  }
  if (!data) {
    throw new AppError("FORBIDDEN", `Missing permission: ${code}`);
  }
  return ctx;
}

/** Read a feature flag: Redis (5s TTL) with Postgres fallback. */
export async function getFeatureFlag(
  festivalId: string,
  key: string,
  opts: { failClosed?: boolean } = {}
): Promise<boolean> {
  const cached = await getFeatureFlagCache(festivalId, key);
  if (cached !== null) return cached;

  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from("feature_flags")
    .select("enabled")
    .eq("festival_id", festivalId)
    .eq("key", key)
    .maybeSingle();

  if (error || !data) {
    if (opts.failClosed) {
      throw new AppError("FEATURE_DISABLED", `Unable to determine flag: ${key}`);
    }
    return false;
  }
  await setFeatureFlagCache(festivalId, key, data.enabled);
  return data.enabled;
}

/** Maintenance-mode guard for public endpoints. */
export async function assertNotMaintenance(festivalId: string): Promise<void> {
  const maintenance = await getFeatureFlag(festivalId, "maintenance_mode");
  if (maintenance) {
    throw new AppError("MAINTENANCE", "The site is briefly in maintenance mode");
  }
}
