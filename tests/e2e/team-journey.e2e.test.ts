import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_ID as CAPTAIN_ID,
  EVENT_ID,
  MEMBER_ID,
  TEAM_ID,
  rateLimiter,
  resetWorld,
  sb,
  userSb,
} from "./helpers/mocks";
import {
  ctx,
  del,
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

import { GET as listTeamsRoute, POST as createTeamRoute } from "@/app/api/teams/route";
import { POST as joinTeamRoute } from "@/app/api/teams/join/route";
import { POST as rotateInviteRoute } from "@/app/api/teams/[id]/invitations/route";
import { POST as readyTeamRoute } from "@/app/api/teams/[id]/ready/route";
import { DELETE as removeMemberRoute } from "@/app/api/teams/[id]/members/[userId]/route";

const EVENT = { name: "Hackathon", min_team_size: 2, max_team_size: 4 };

function seedFestival(): void {
  // Active festival comes from the resetWorld default.
}

/** requireUser prelude consumed by every mutation; limiter stays permissive. */
function seedGuards(_actor: string): void {
  seedFestival();
}

function seedActivePass(): void {
  // No-op: base pass is no longer required for team operations
}

function seedReadDraft(
  status: string,
  members: Array<{ userId: string; role: string; status: string }>,
  passHolders: string[]
): void {
  sb.onTable("team_drafts", {
    data: { id: TEAM_ID, team_name: "Debuggers", status, event_id: EVENT_ID, events: EVENT },
    error: null,
  });
  sb.onTable("team_draft_members", {
    data: members.map((m) => ({ user_id: m.userId, role: m.role, status: m.status })),
    error: null,
  });
  sb.onTable("delegate_passes", {
    data: passHolders.map((u) => ({ user_id: u })),
    error: null,
  });
  sb.onTable("profiles", {
    data: [{ user_id: CAPTAIN_ID, display_name: "Captain" }],
    error: null,
  });
}

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.advanceTimersByTime(31_000);
  resetWorld({ actor: { id: CAPTAIN_ID, email: "captain@example.com", confirmed: true } });
});

describe("POST /api/teams (plan §12.4)", () => {
  it("creates a draft with the captain enrolled and a hashed invite code", async () => {
    seedGuards(CAPTAIN_ID);
    seedActivePass();
    sb.onTable("events", {
      data: { ...EVENT, registration_mode: "TEAM", status: "PUBLISHED" },
      error: null,
    });
    sb.onTable("team_drafts", { data: null, error: null }); // no open draft
    sb.onTable("team_drafts", { data: { id: TEAM_ID }, error: null }); // insert
    sb.onTable("team_draft_members", { data: null, error: null }); // captain row
    seedReadDraft("DRAFT", [{ userId: CAPTAIN_ID, role: "CAPTAIN", status: "ACCEPTED" }], [CAPTAIN_ID]);

    const res = await createTeamRoute(
      post("/api/teams", { body: { eventId: EVENT_ID, teamName: "Debuggers" } })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.team).toMatchObject({
      id: TEAM_ID,
      eventName: "Hackathon",
      status: "DRAFT",
      minTeamSize: 2,
      maxTeamSize: 4,
    });

    const insert = sb.callsFor("team_drafts").find((c) => c.action === "insert")!;
    const storedHash = (insert.payload as Record<string, unknown>).join_code_hash as string;
    expect(storedHash).toHaveLength(64);
    // The plaintext code is only in the response, never persisted.
    const returnedCode = body.data.team.inviteCode as string;
    expect(returnedCode.length).toBeGreaterThanOrEqual(16);
    expect(storedHash).toBe(createHash("sha256").update(returnedCode).digest("hex"));
    expect(rateLimiter.calls[0]).toMatchObject({ cls: "team", identifier: `user:${CAPTAIN_ID}` });
  });

  it("409s when the captain already has an open team for the event", async () => {
    seedGuards(CAPTAIN_ID);
    seedActivePass();
    sb.onTable("events", { data: { ...EVENT, registration_mode: "TEAM", status: "PUBLISHED" }, error: null });
    sb.onTable("team_drafts", { data: { id: "existing" }, error: null });

    const res = await createTeamRoute(
      post("/api/teams", { body: { eventId: EVENT_ID, teamName: "Debuggers" } })
    );
    expect(res.status).toBe(409);
    expectErrEnvelope(await json(res), "CONFLICT");
  });

  it.each([
    ["not published", { ...EVENT, registration_mode: "TEAM", status: "DRAFT" }, "NOT_FOUND"],
    ["individual event", { ...EVENT, registration_mode: "INDIVIDUAL", status: "PUBLISHED" }, "VALIDATION_FAILED"],
  ] as const)("rejects a %s with %s", async (_name, eventRow, code) => {
    seedGuards(CAPTAIN_ID);
    seedActivePass();
    sb.onTable("events", { data: eventRow, error: null });

    const res = await createTeamRoute(
      post("/api/teams", { body: { eventId: EVENT_ID, teamName: "Debuggers" } })
    );
    const expectedStatus = { NOT_FOUND: 404, VALIDATION_FAILED: 422 }[code];
    expect(res.status).toBe(expectedStatus);
    expectErrEnvelope(await json(res), code);
  });

  it("creates a draft even without an active delegate pass", async () => {
    seedGuards(CAPTAIN_ID);
    sb.onTable("events", {
      data: { ...EVENT, registration_mode: "TEAM", status: "PUBLISHED" },
      error: null,
    });
    sb.onTable("team_drafts", { data: null, error: null }); // no open draft
    sb.onTable("team_drafts", { data: { id: TEAM_ID }, error: null }); // insert
    sb.onTable("team_draft_members", { data: null, error: null }); // captain row
    seedReadDraft("DRAFT", [{ userId: CAPTAIN_ID, role: "CAPTAIN", status: "ACCEPTED" }], []);

    const res = await createTeamRoute(
      post("/api/teams", { body: { eventId: EVENT_ID, teamName: "Debuggers" } })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
  });

  it("422s invalid payloads (short name / unknown fields)", async () => {
    seedGuards(CAPTAIN_ID);

    for (const bad of [
      { eventId: EVENT_ID, teamName: "x" },
      { eventId: EVENT_ID, teamName: "ok", rogue: 1 },
    ]) {
      const res = await createTeamRoute(post("/api/teams", { body: bad }));
      expect(res.status).toBe(422);
      expectErrEnvelope(await json(res), "VALIDATION_FAILED");
    }
  });
});

describe("POST /api/teams/join (plan §12.4)", () => {
  function joinAs(code: string) {
    userSb.setActor({ id: MEMBER_ID, email: "member@example.com", confirmed: true });
    return joinTeamRoute(post("/api/teams/join", { body: { inviteCode: code } }));
  }
  const joinAsMember = joinAs;

  it("joins a DRAFT team via the invite-code hash", async () => {
    const code = "e2e-invite-code-abcdef0123456789";
    seedFestival();
    seedActivePass();
    sb.onTable("team_drafts", {
      data: { id: TEAM_ID, event_id: EVENT_ID, status: "DRAFT", captain_user_id: CAPTAIN_ID },
      error: null,
    });
    sb.onTable("events", { data: { max_team_size: 4 }, error: null });
    sb.onTable("team_draft_members", { data: null, error: null, count: 1 }); // head-count
    sb.onTable("team_draft_members", { data: null, error: null }); // insert
    seedReadDraft(
      "DRAFT",
      [
        { userId: CAPTAIN_ID, role: "CAPTAIN", status: "ACCEPTED" },
        { userId: MEMBER_ID, role: "MEMBER", status: "ACCEPTED" },
      ],
      [CAPTAIN_ID]
    );

    const res = await joinAsMember(code);
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);

    // Lookup was keyed on SHA-256 of the presented code.
    const lookup = sb.callsFor("team_drafts")[0];
    expect(lookup.filters["join_code_hash"]).toBe(createHash("sha256").update(code).digest("hex"));

    const insert = sb.callsFor("team_draft_members").find((c) => c.action === "insert")!;
    expect(insert.payload).toMatchObject({ user_id: MEMBER_ID, role: "MEMBER", status: "ACCEPTED" });
  });

  it("404s an invalid invite code", async () => {
    seedFestival();
    seedActivePass();
    sb.onTable("team_drafts", { data: null, error: null });

    const res = await joinAs("wrong-code-0000000000"); // >=16 chars
    expect(res.status).toBe(404);
    expectErrEnvelope(await json(res), "NOT_FOUND");
  });

  it("409s INSUFFICIENT_CAPACITY on a full team", async () => {
    seedFestival();
    seedActivePass();
    sb.onTable("team_drafts", {
      data: { id: TEAM_ID, event_id: EVENT_ID, status: "DRAFT", captain_user_id: CAPTAIN_ID },
      error: null,
    });
    sb.onTable("events", { data: { max_team_size: 4 }, error: null });
    sb.onTable("team_draft_members", { data: null, error: null, count: 4 });

    const res = await joinAs("some-code-00000000000");
    expect(res.status).toBe(409);
    expectErrEnvelope(await json(res), "INSUFFICIENT_CAPACITY");
  });

  it("409s CONFLICT when the member is already on the team (23505)", async () => {
    seedFestival();
    seedActivePass();
    sb.onTable("team_drafts", {
      data: { id: TEAM_ID, event_id: EVENT_ID, status: "DRAFT", captain_user_id: CAPTAIN_ID },
      error: null,
    });
    sb.onTable("events", { data: { max_team_size: 4 }, error: null });
    sb.onTable("team_draft_members", { data: null, error: null, count: 1 });
    sb.onTable("team_draft_members", {
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const res = await joinAs("some-code-00000000000");
    expect(res.status).toBe(409);
    const body = await json(res);
    expectErrEnvelope(body, "CONFLICT");
    expect(body.message).toMatch(/already in this team/i);
    expect(JSON.stringify(body)).not.toContain("23505"); // internals never leak
  });

  it("409s TEAM_LOCKED once checkout has locked the roster", async () => {
    seedFestival();
    seedActivePass();
    sb.onTable("team_drafts", {
      data: { id: TEAM_ID, event_id: EVENT_ID, status: "LOCKED_FOR_CHECKOUT", captain_user_id: CAPTAIN_ID },
      error: null,
    });

    const res = await joinAs("some-code-00000000000");
    expect(res.status).toBe(409);
    expectErrEnvelope(await json(res), "TEAM_LOCKED");
  });
});

describe("POST /api/teams/:id/invitations", () => {
  it("rotates the invite code and returns the new plaintext once", async () => {
    seedFestival();
    sb.onTable("team_drafts", {
      data: { id: TEAM_ID, captain_user_id: CAPTAIN_ID, status: "DRAFT" },
      error: null,
    });
    sb.onTable("team_drafts", { data: null, error: null }); // update

    const res = await rotateInviteRoute(
      post(`/api/teams/${TEAM_ID}/invitations`, { body: {} }),
      ctx({ id: TEAM_ID })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect((body.data.inviteCode as string).length).toBeGreaterThanOrEqual(16);

    const update = sb.callsFor("team_drafts").find((c) => c.action === "update")!;
    expect(update.payload).toHaveProperty("join_code_hash");
  });

  it("403s a non-captain", async () => {
    seedFestival();
    userSb.setActor({ id: MEMBER_ID, email: "member@example.com", confirmed: true });
    sb.onTable("team_drafts", {
      data: { id: TEAM_ID, captain_user_id: CAPTAIN_ID, status: "DRAFT" },
      error: null,
    });

    const res = await rotateInviteRoute(
      post(`/api/teams/${TEAM_ID}/invitations`, { body: {} }),
      ctx({ id: TEAM_ID })
    );
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
  });

  it("409s TEAM_LOCKED after checkout lock", async () => {
    seedFestival();
    sb.onTable("team_drafts", {
      data: { id: TEAM_ID, captain_user_id: CAPTAIN_ID, status: "CONFIRMED" },
      error: null,
    });

    const res = await rotateInviteRoute(
      post(`/api/teams/${TEAM_ID}/invitations`, { body: {} }),
      ctx({ id: TEAM_ID })
    );
    expect(res.status).toBe(409);
    expectErrEnvelope(await json(res), "TEAM_LOCKED");
  });
});

describe("POST /api/teams/:id/ready (plan §12.4)", () => {
  function readyWith(
    members: Array<{ userId: string; role: string; status: string }>,
    passHolders: string[]
  ) {
    sb.onTable("team_drafts", {
      data: { id: TEAM_ID, captain_user_id: CAPTAIN_ID, event_id: EVENT_ID, status: "DRAFT" },
      error: null,
    });
    sb.onTable("events", { data: { min_team_size: 2, max_team_size: 4 }, error: null });
    sb.onTable("team_draft_members", { data: members, error: null });
    if (members.length >= 2 && members.length <= 4) {
      sb.onTable("team_drafts", { data: null, error: null }); // READY update
      seedReadDraft("READY", members, passHolders);
    }
  }

  it("marks READY when size check passes", async () => {
    seedFestival();
    readyWith(
      [
        { userId: CAPTAIN_ID, role: "CAPTAIN", status: "ACCEPTED" },
        { userId: MEMBER_ID, role: "MEMBER", status: "ACCEPTED" },
      ],
      [CAPTAIN_ID, MEMBER_ID]
    );

    const res = await readyTeamRoute(post(`/api/teams/${TEAM_ID}/ready`, { body: {} }), ctx({ id: TEAM_ID }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.team.status).toBe("READY");
  });

  it("refuses to ready an understaffed team", async () => {
    seedFestival();
    readyWith([{ userId: CAPTAIN_ID, role: "CAPTAIN", status: "ACCEPTED" }], [CAPTAIN_ID]);

    const res = await readyTeamRoute(post(`/api/teams/${TEAM_ID}/ready`, { body: {} }), ctx({ id: TEAM_ID }));
    expect(res.status).toBe(409);
    const body = await json(res);
    expectErrEnvelope(body, "TEAM_NOT_READY");
    expect(body.message).toContain("at least 2");
  });

  it("marks READY even when members do not hold active base passes", async () => {
    seedFestival();
    readyWith(
      [
        { userId: CAPTAIN_ID, role: "CAPTAIN", status: "ACCEPTED" },
        { userId: MEMBER_ID, role: "MEMBER", status: "ACCEPTED" },
      ],
      [] // zero passes
    );

    const res = await readyTeamRoute(post(`/api/teams/${TEAM_ID}/ready`, { body: {} }), ctx({ id: TEAM_ID }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.team.status).toBe("READY");
  });

  it("403s a non-captain trying to ready the team", async () => {
    seedFestival();
    userSb.setActor({ id: MEMBER_ID, email: "member@example.com", confirmed: true });
    sb.onTable("team_drafts", {
      data: { id: TEAM_ID, captain_user_id: CAPTAIN_ID, event_id: EVENT_ID, status: "DRAFT" },
      error: null,
    });

    const res = await readyTeamRoute(post(`/api/teams/${TEAM_ID}/ready`, { body: {} }), ctx({ id: TEAM_ID }));
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
  });
});

describe("DELETE /api/teams/:id/members/:userId (plan §12.4)", () => {
  it("lets the captain remove a member before checkout", async () => {
    seedFestival();
    sb.onTable("team_drafts", {
      data: { id: TEAM_ID, captain_user_id: CAPTAIN_ID, status: "DRAFT" },
      error: null,
    });
    sb.onTable("team_draft_members", { data: null, error: null }); // REMOVED update

    const res = await removeMemberRoute(
      del(`/api/teams/${TEAM_ID}/members/${MEMBER_ID}`, { body: {} }),
      ctx({ id: TEAM_ID, userId: MEMBER_ID })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.removed).toBe(MEMBER_ID);

    const update = sb.callsFor("team_draft_members").find((c) => c.action === "update")!;
    expect(update.payload).toEqual({ status: "REMOVED" });
    expect(update.filters["user_id"]).toBe(MEMBER_ID);
  });

  it("blocks the captain from removing themselves", async () => {
    seedFestival();
    sb.onTable("team_drafts", {
      data: { id: TEAM_ID, captain_user_id: CAPTAIN_ID, status: "DRAFT" },
      error: null,
    });

    const res = await removeMemberRoute(
      del(`/api/teams/${TEAM_ID}/members/${CAPTAIN_ID}`, { body: {} }),
      ctx({ id: TEAM_ID, userId: CAPTAIN_ID })
    );
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
    expect(sb.callsFor("team_draft_members")).toHaveLength(0);
  });

  it("blocks removals after the roster is locked", async () => {
    seedFestival();
    sb.onTable("team_drafts", {
      data: { id: TEAM_ID, captain_user_id: CAPTAIN_ID, status: "LOCKED_FOR_CHECKOUT" },
      error: null,
    });

    const res = await removeMemberRoute(
      del(`/api/teams/${TEAM_ID}/members/${MEMBER_ID}`, { body: {} }),
      ctx({ id: TEAM_ID, userId: MEMBER_ID })
    );
    expect(res.status).toBe(409);
    expectErrEnvelope(await json(res), "TEAM_LOCKED");
  });
});

describe("GET /api/teams (dashboard list)", () => {
  it("lists drafts the caller belongs to", async () => {
    seedFestival();
    sb.onTable("team_draft_members", { data: [{ team_draft_id: TEAM_ID }], error: null });
    seedReadDraft("READY", [{ userId: CAPTAIN_ID, role: "CAPTAIN", status: "ACCEPTED" }], [CAPTAIN_ID]);

    const res = await listTeamsRoute(get("/api/teams"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    const teams = body.data.teams as Array<{ id: string; inviteCode: string | null }>;
    expect(teams[0].id).toBe(TEAM_ID);
    expect(teams[0].inviteCode).toBeNull(); // codes are never re-served in lists
  });

  it("returns an empty list without memberships", async () => {
    seedFestival();
    sb.onTable("team_draft_members", { data: [], error: null });

    const res = await listTeamsRoute(get("/api/teams"));
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.teams).toEqual([]);
  });
});
