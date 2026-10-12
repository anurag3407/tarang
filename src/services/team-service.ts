import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { AppError } from "@/lib/errors";
import type { TeamDraftRead } from "@/domain/checkout";

/**
 * Team draft service (plan §12.4).
 *
 * Invite codes carry >=128 bits of entropy and are stored hashed only.
 * Joining requires authentication and an active base pass. Teams are
 * immutable while LOCKED_FOR_CHECKOUT.
 */

function hashInviteCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function newInviteCode(): string {
  // 32 random bytes = 256 bits entropy, base64url-encoded.
  return randomBytes(32).toString("base64url");
}

async function assertEventTeamMode(
  eventId: string,
  festivalId: string
): Promise<{
  minTeamSize: number;
  maxTeamSize: number;
  eventName: string;
}> {
  const sb = createServiceRoleClient();
  const { data } = await sb
    .from("events")
    .select("name, registration_mode, min_team_size, max_team_size, status")
    .eq("id", eventId)
    .eq("festival_id", festivalId)
    .maybeSingle();
  if (!data) throw new AppError("NOT_FOUND", "Event not found");
  if (data.status !== "PUBLISHED") {
    throw new AppError("NOT_FOUND", "Event is not open for registration");
  }
  if (data.registration_mode !== "TEAM") {
    throw new AppError("VALIDATION_FAILED", "This event does not use team registration");
  }
  return {
    minTeamSize: data.min_team_size,
    maxTeamSize: data.max_team_size,
    eventName: data.name,
  };
}

export async function createTeamDraft(
  userId: string,
  festivalId: string,
  eventId: string,
  teamName: string
): Promise<TeamDraftRead> {
  await assertEventTeamMode(eventId, festivalId);

  const sb = createServiceRoleClient();

  // One open draft per captain per event.
  const { data: existing } = await sb
    .from("team_drafts")
    .select("id")
    .eq("event_id", eventId)
    .eq("captain_user_id", userId)
    .in("status", ["DRAFT", "READY"])
    .maybeSingle();
  if (existing) {
    throw new AppError("CONFLICT", "You already have an open team for this event");
  }

  const inviteCode = newInviteCode();
  const { data: draft, error } = await sb
    .from("team_drafts")
    .insert({
      festival_id: festivalId,
      event_id: eventId,
      captain_user_id: userId,
      team_name: teamName,
      join_code_hash: hashInviteCode(inviteCode),
      status: "DRAFT",
    })
    .select("id")
    .single();
  if (error) throw new AppError("INTERNAL", "Could not create team");

  await sb.from("team_draft_members").insert({
    team_draft_id: draft.id,
    user_id: userId,
    role: "CAPTAIN",
    status: "ACCEPTED",
    accepted_at: new Date().toISOString(),
  });

  return readTeamDraft(draft.id, inviteCode);
}

/** Generate or rotate the invite code. Returns the plaintext once. */
export async function rotateInviteCode(
  userId: string,
  teamDraftId: string
): Promise<{ inviteCode: string }> {
  const sb = createServiceRoleClient();
  const { data: draft } = await sb
    .from("team_drafts")
    .select("id, captain_user_id, status")
    .eq("id", teamDraftId)
    .maybeSingle();
  if (!draft) throw new AppError("NOT_FOUND", "Team not found");
  if (draft.captain_user_id !== userId) {
    throw new AppError("FORBIDDEN", "Only the captain can manage invites");
  }
  if (draft.status === "LOCKED_FOR_CHECKOUT" || draft.status === "CONFIRMED") {
    throw new AppError("TEAM_LOCKED", "Team is locked for checkout");
  }

  const inviteCode = newInviteCode();
  const { error } = await sb
    .from("team_drafts")
    .update({ join_code_hash: hashInviteCode(inviteCode) })
    .eq("id", teamDraftId);
  if (error) throw new AppError("INTERNAL", "Could not rotate invite code");

  return { inviteCode };
}

export async function joinTeamByCode(
  userId: string,
  inviteCode: string
): Promise<TeamDraftRead> {
  const sb = createServiceRoleClient();
  const codeHash = hashInviteCode(inviteCode);
  const { data: draft } = await sb
    .from("team_drafts")
    .select("id, event_id, festival_id, status, captain_user_id")
    .eq("join_code_hash", codeHash)
    .maybeSingle();
  if (!draft) throw new AppError("NOT_FOUND", "Invalid invite code");
  if (draft.status !== "DRAFT" && draft.status !== "READY") {
    throw new AppError("TEAM_LOCKED", "This team is no longer accepting members");
  }

  const { data: event } = await sb
    .from("events")
    .select("max_team_size")
    .eq("id", draft.event_id)
    .single();

  const { count } = await sb
    .from("team_draft_members")
    .select("user_id", { count: "exact", head: true })
    .eq("team_draft_id", draft.id)
    .in("status", ["INVITED", "ACCEPTED"]);
  if ((count ?? 0) >= (event?.max_team_size ?? 100)) {
    throw new AppError("INSUFFICIENT_CAPACITY", "This team is already full");
  }

  const { error } = await sb.from("team_draft_members").insert({
    team_draft_id: draft.id,
    user_id: userId,
    role: "MEMBER",
    status: "ACCEPTED",
    accepted_at: new Date().toISOString(),
  });
  if (error) {
    if (error.code === "23505") {
      throw new AppError("CONFLICT", "You are already in this team");
    }
    throw new AppError("INTERNAL", "Could not join team");
  }

  return readTeamDraft(draft.id, null);
}

export async function removeTeamMember(
  captainUserId: string,
  teamDraftId: string,
  memberUserId: string
): Promise<void> {
  const sb = createServiceRoleClient();
  const { data: draft } = await sb
    .from("team_drafts")
    .select("id, captain_user_id, status")
    .eq("id", teamDraftId)
    .maybeSingle();
  if (!draft) throw new AppError("NOT_FOUND", "Team not found");
  if (draft.captain_user_id !== captainUserId) {
    throw new AppError("FORBIDDEN", "Only the captain can remove members");
  }
  if (memberUserId === captainUserId) {
    throw new AppError("VALIDATION_FAILED", "The captain cannot remove themselves");
  }
  if (draft.status === "LOCKED_FOR_CHECKOUT" || draft.status === "CONFIRMED") {
    throw new AppError("TEAM_LOCKED", "Team is locked for checkout");
  }

  const { error } = await sb
    .from("team_draft_members")
    .update({ status: "REMOVED" })
    .eq("team_draft_id", teamDraftId)
    .eq("user_id", memberUserId);
  if (error) throw new AppError("INTERNAL", "Could not remove member");
}

/** Validate size + base-pass readiness and mark READY (plan §12.4). */
export async function markTeamReady(
  userId: string,
  teamDraftId: string
): Promise<TeamDraftRead> {
  const sb = createServiceRoleClient();
  const { data: draft } = await sb
    .from("team_drafts")
    .select("id, captain_user_id, event_id, festival_id, status")
    .eq("id", teamDraftId)
    .maybeSingle();
  if (!draft) throw new AppError("NOT_FOUND", "Team not found");
  if (draft.captain_user_id !== userId) {
    throw new AppError("FORBIDDEN", "Only the captain can ready the team");
  }
  if (draft.status === "LOCKED_FOR_CHECKOUT" || draft.status === "CONFIRMED") {
    throw new AppError("TEAM_LOCKED", "Team is locked for checkout");
  }

  const { data: event } = await sb
    .from("events")
    .select("min_team_size, max_team_size")
    .eq("id", draft.event_id)
    .single();

  const { data: members } = await sb
    .from("team_draft_members")
    .select("user_id, status")
    .eq("team_draft_id", teamDraftId)
    .eq("status", "ACCEPTED");
  const accepted = members ?? [];

  if (accepted.length < (event?.min_team_size ?? 1)) {
    throw new AppError(
      "TEAM_NOT_READY",
      `Team needs at least ${event?.min_team_size ?? 1} accepted members`
    );
  }
  if (accepted.length > (event?.max_team_size ?? 100)) {
    throw new AppError("TEAM_NOT_READY", "Team exceeds the maximum size");
  }

  const { error } = await sb
    .from("team_drafts")
    .update({ status: "READY" })
    .eq("id", teamDraftId);
  if (error) throw new AppError("INTERNAL", "Could not ready team");

  return readTeamDraft(teamDraftId, null);
}

/** Read model for the dashboard. inviteCode is only returned on rotation. */
export async function readTeamDraft(
  teamDraftId: string,
  inviteCode: string | null
): Promise<TeamDraftRead> {
  const sb = createServiceRoleClient();
  const { data: draft, error } = await sb
    .from("team_drafts")
    .select("id, team_name, status, event_id, events ( name, min_team_size, max_team_size )")
    .eq("id", teamDraftId)
    .single();
  if (error) throw new AppError("NOT_FOUND", "Team not found");

  const event = Array.isArray(draft.events) ? draft.events[0] : draft.events;

  const { data: members } = await sb
    .from("team_draft_members")
    .select("user_id, role, status")
    .eq("team_draft_id", teamDraftId)
    .order("created_at", { ascending: true });

  const memberIds = (members ?? []).map((m) => m.user_id);
  let passHolders = new Set<string>();
  const names = new Map<string, string | null>();
  if (memberIds.length > 0) {
    const { data: passes } = await sb
      .from("delegate_passes")
      .select("user_id")
      .in("user_id", memberIds)
      .eq("state", "ACTIVE");
    passHolders = new Set((passes ?? []).map((p) => p.user_id));

    const { data: profiles } = await sb
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", memberIds);
    for (const p of profiles ?? []) names.set(p.user_id, p.display_name);
  }

  return {
    id: draft.id,
    eventName: event?.name ?? "",
    teamName: draft.team_name,
    status: draft.status,
    minTeamSize: event?.min_team_size ?? 1,
    maxTeamSize: event?.max_team_size ?? 1,
    members: (members ?? []).map((m) => ({
      userId: m.user_id,
      displayName: names.get(m.user_id) ?? null,
      role: m.role,
      status: m.status,
      hasBasePass: passHolders.has(m.user_id),
    })),
    inviteCode,
  };
}

/** List the caller's team drafts for the dashboard. */
export async function listTeamDraftsForUser(userId: string): Promise<TeamDraftRead[]> {
  const sb = createServiceRoleClient();
  const { data: memberships } = await sb
    .from("team_draft_members")
    .select("team_draft_id")
    .eq("user_id", userId)
    .in("status", ["INVITED", "ACCEPTED"])
    .limit(50);
  const ids = (memberships ?? []).map((m) => m.team_draft_id);
  if (ids.length === 0) return [];

  const drafts: TeamDraftRead[] = [];
  for (const id of ids) {
    try {
      drafts.push(await readTeamDraft(id, null));
    } catch {
      // Skip drafts that vanished mid-read.
    }
  }
  return drafts;
}
