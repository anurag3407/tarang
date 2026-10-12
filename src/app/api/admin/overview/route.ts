import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminRead } from "@/lib/admin-route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { env } from "@/lib/env";
import { formatPaise } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/overview — Mission Control Dashboard Hub.
 *
 * Scoped to requesting festival. Supports both:
 * 1. Initial dashboard payload (global metrics, telemetry, and initial page for each dataset).
 * 2. Dedicated paginated tab querying when ?tab=orders|passes|registrations|groups is passed.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await guardAdminRead(req, "admin.access");
    const sb = createServiceRoleClient();
    const e = env();

    const tab = req.nextUrl.searchParams.get("tab");
    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1") || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(req.nextUrl.searchParams.get("pageSize") ?? "25") || 25)
    );
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const cleanQ = q.replace(/[,()"\\]/g, " ").trim();
    const filter = req.nextUrl.searchParams.get("filter");
    const eventId = req.nextUrl.searchParams.get("eventId");

    // Helper to resolve profiles & emails concurrently for a list of user IDs
    async function resolveProfilesAndEmails(userIds: string[]) {
      const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
      if (uniqueIds.length === 0) {
        return {
          profileMap: new Map<string, { display_name: string | null; phone_e164: string | null; college_name: string | null; public_member_code?: string | null }>(),
          emailMap: new Map<string, string>(),
        };
      }

      const { data: profiles } = await sb
        .from("profiles")
        .select("user_id, display_name, phone_e164, college_name, public_member_code")
        .in("user_id", uniqueIds);

      const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));
      const emailMap = new Map<string, string>();

      await Promise.all(
        uniqueIds.map(async (uid) => {
          try {
            const { data: u } = await sb.auth.admin.getUserById(uid);
            if (u?.user?.email) emailMap.set(uid, u.user.email);
          } catch {
            // ignore
          }
        })
      );

      return { profileMap, emailMap };
    }

    // -------------------------------------------------------------
    // TAB: ORDERS
    // -------------------------------------------------------------
    if (tab === "orders") {
      let query = sb
        .from("orders")
        .select(
          `
          id, public_order_code, purchaser_user_id, amount_paise, currency,
          kind, checkout_state, fulfilled_at, created_at
        `,
          { count: "exact" }
        )
        .eq("festival_id", ctx.festivalId)
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (filter === "DELEGATE") {
        query = query.eq("kind", "BASE_PASS").gte("amount_paise", 50000);
      } else if (filter === "BASIC") {
        query = query.eq("kind", "BASE_PASS").lt("amount_paise", 50000);
      } else if (filter === "EVENT") {
        query = query.eq("kind", "EVENT");
      } else if (filter === "REFUNDED") {
        query = query.eq("checkout_state", "REFUNDED");
      } else if (filter === "PENDING") {
        query = query.not("checkout_state", "in", "(\"FULFILLED\",\"REFUNDED\")");
      }

      if (cleanQ) {
        const { data: matchedProfiles } = await sb
          .from("profiles")
          .select("user_id")
          .or(`display_name.ilike.%${cleanQ}%,phone_e164.ilike.%${cleanQ}%,college_name.ilike.%${cleanQ}%`)
          .limit(25);
        const userIds = (matchedProfiles ?? []).map((p) => p.user_id);

        const { data: matchedPayments } = await sb
          .from("payments")
          .select("local_order_id")
          .ilike("razorpay_payment_id", `%${cleanQ}%`)
          .limit(25);
        const orderIds = (matchedPayments ?? []).map((p) => p.local_order_id);

        const clauses: string[] = [`public_order_code.ilike.%${cleanQ}%`];
        if (userIds.length > 0) clauses.push(`purchaser_user_id.in.(${userIds.join(",")})`);
        if (orderIds.length > 0) clauses.push(`id.in.(${orderIds.join(",")})`);
        query = query.or(clauses.join(","));
      }

      const { data: rawOrders, count, error } = await query;
      if (error) return apiError(req, "INTERNAL", error.message);

      const userIds = (rawOrders ?? []).map((o) => o.purchaser_user_id);
      const { profileMap, emailMap } = await resolveProfilesAndEmails(userIds);

      const orderIds = (rawOrders ?? []).map((o) => o.id);
      const { data: syncItems } =
        orderIds.length > 0
          ? await sb.from("sheets_sync_items").select("entity_id, sync_state").in("entity_id", orderIds)
          : { data: [] };
      const syncMap = new Map((syncItems ?? []).map((s) => [s.entity_id, s.sync_state]));

      const { data: orderPayments } =
        orderIds.length > 0
          ? await sb
              .from("payments")
              .select("local_order_id, razorpay_payment_id")
              .in("local_order_id", orderIds)
          : { data: [] };
      const paymentMap = new Map((orderPayments ?? []).map((p) => [p.local_order_id, p.razorpay_payment_id]));

      const { data: emailJobs } = await sb
        .from("email_jobs")
        .select("logical_key, state, resend_email_id")
        .order("created_at", { ascending: false })
        .limit(100);
      const emailJobMap = new Map((emailJobs ?? []).map((j) => [j.logical_key, j]));

      const items = (rawOrders ?? []).map((o) => {
        const profile = profileMap.get(o.purchaser_user_id);
        const email = emailMap.get(o.purchaser_user_id) || "—";
        const syncState = syncMap.get(o.id) || "NOT_SYNCED";
        const emailJob = emailJobMap.get(`order-confirmation:${o.id}`);
        const isDelegate = o.kind === "BASE_PASS" && Number(o.amount_paise) >= 50000;
        const isBasic = o.kind === "BASE_PASS" && !isDelegate;

        let tierLabel = "Event Entry";
        if (isDelegate) tierLabel = `VIP Delegate Pass (${formatPaise(Number(o.amount_paise))})`;
        else if (isBasic) tierLabel = `Basic Card (${formatPaise(Number(o.amount_paise))})`;

        return {
          id: o.id,
          publicOrderCode: o.public_order_code,
          paymentId: paymentMap.get(o.id) || null,
          amountPaise: Number(o.amount_paise),
          currency: o.currency,
          kind: o.kind,
          tierLabel,
          isDelegate,
          isBasic,
          checkoutState: o.checkout_state,
          createdAt: o.created_at,
          fulfilledAt: o.fulfilled_at,
          purchaser: {
            name: profile?.display_name || "Participant",
            phone: profile?.phone_e164 || "—",
            college: profile?.college_name || "—",
            email,
          },
          sheetsSyncState: syncState,
          emailStatus: emailJob?.state || "PENDING",
        };
      });

      const total = count ?? 0;
      return apiSuccess(req, {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    }

    // -------------------------------------------------------------
    // TAB: PASSES (CARDS)
    // -------------------------------------------------------------
    if (tab === "passes") {
      let query = sb
        .from("delegate_passes")
        .select(
          `
          id, public_pass_code, user_id, state, activated_at, created_at, expires_at,
          pass_products ( id, name, slug, is_base_pass )
        `,
          { count: "exact" }
        )
        .eq("festival_id", ctx.festivalId)
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (filter && filter !== "ALL") {
        query = query.eq("state", filter);
      }

      if (cleanQ) {
        const { data: matchedProfiles } = await sb
          .from("profiles")
          .select("user_id")
          .or(`display_name.ilike.%${cleanQ}%,phone_e164.ilike.%${cleanQ}%,college_name.ilike.%${cleanQ}%`)
          .limit(25);
        const userIds = (matchedProfiles ?? []).map((p) => p.user_id);
        const clauses = [`public_pass_code.ilike.%${cleanQ}%`];
        if (userIds.length > 0) clauses.push(`user_id.in.(${userIds.join(",")})`);
        query = query.or(clauses.join(","));
      }

      const { data: rawPasses, count, error } = await query;
      if (error) return apiError(req, "INTERNAL", error.message);

      const passHolderIds = (rawPasses ?? []).map((p) => p.user_id);
      const { profileMap, emailMap } = await resolveProfilesAndEmails(passHolderIds);

      const items = (rawPasses ?? []).map((p) => {
        const prod = Array.isArray(p.pass_products) ? p.pass_products[0] : p.pass_products;
        const profile = profileMap.get(p.user_id);
        const email = emailMap.get(p.user_id) || "—";
        const isDelegate = prod?.slug === "vip-delegate-pass" || !prod?.is_base_pass;

        return {
          id: p.id,
          publicPassCode: p.public_pass_code,
          productName: prod?.name || (isDelegate ? "VIP Delegate Pass" : "Basic Pass"),
          productSlug: prod?.slug || "pass",
          isDelegate,
          state: p.state,
          activatedAt: p.activated_at,
          createdAt: p.created_at,
          expiresAt: p.expires_at,
          hasQr: isDelegate && p.state === "ACTIVE",
          holder: {
            name: profile?.display_name || "Participant",
            phone: profile?.phone_e164 || "—",
            college: profile?.college_name || "—",
            email,
          },
        };
      });

      const total = count ?? 0;
      return apiSuccess(req, {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    }

    // -------------------------------------------------------------
    // TAB: EVENT REGISTRATIONS
    // -------------------------------------------------------------
    if (tab === "registrations") {
      let query = sb
        .from("registrations")
        .select(
          `
          id, public_registration_code, registration_mode, team_name, capacity_units,
          state, confirmed_at, created_at, owner_user_id,
          events!inner (
            id, name, slug, festival_id,
            categories ( name ),
            venues ( name )
          ),
          order_lines (
            id, line_amount_paise,
            orders ( id, public_order_code, checkout_state )
          ),
          registration_members ( role, user_id )
        `,
          { count: "exact" }
        )
        .eq("events.festival_id", ctx.festivalId)
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (eventId) {
        query = query.eq("event_id", eventId);
      }

      if (filter && filter !== "ALL") {
        query = query.eq("state", filter);
      }

      if (cleanQ) {
        const { data: matchedProfiles } = await sb
          .from("profiles")
          .select("user_id")
          .or(`display_name.ilike.%${cleanQ}%,phone_e164.ilike.%${cleanQ}%,college_name.ilike.%${cleanQ}%`)
          .limit(25);
        const matchedUserIds = (matchedProfiles ?? []).map((p) => p.user_id);
        if (matchedUserIds.length > 0) {
          query = query.or(
            `public_registration_code.ilike.%${cleanQ}%,team_name.ilike.%${cleanQ}%,owner_user_id.in.(${matchedUserIds.join(",")})`
          );
        } else {
          query = query.or(
            `public_registration_code.ilike.%${cleanQ}%,team_name.ilike.%${cleanQ}%`
          );
        }
      }

      const { data: rawRegs, count, error } = await query;
      if (error) return apiError(req, "INTERNAL", error.message);

      const userIds = new Set<string>();
      for (const r of rawRegs ?? []) {
        if (r.owner_user_id) userIds.add(r.owner_user_id);
        for (const m of r.registration_members ?? []) {
          if (m.user_id) userIds.add(m.user_id);
        }
      }

      const { profileMap, emailMap } = await resolveProfilesAndEmails(Array.from(userIds));

      const items = (rawRegs ?? []).map((r) => {
        const ev = Array.isArray(r.events) ? r.events[0] : r.events;
        const cat = ev?.categories ? (Array.isArray(ev.categories) ? ev.categories[0] : ev.categories) : null;
        const ven = ev?.venues ? (Array.isArray(ev.venues) ? ev.venues[0] : ev.venues) : null;
        const ol = Array.isArray(r.order_lines) ? r.order_lines[0] : r.order_lines;
        const ord = ol?.orders ? (Array.isArray(ol.orders) ? ol.orders[0] : ol.orders) : null;

        const ownerProfile = profileMap.get(r.owner_user_id);
        const ownerEmail = emailMap.get(r.owner_user_id) || "—";

        const members = (r.registration_members ?? []).map((m: { role: string; user_id: string }) => {
          const p = profileMap.get(m.user_id);
          const email = emailMap.get(m.user_id) || "—";
          return {
            role: m.role,
            userId: m.user_id,
            name: p?.display_name || "Participant",
            phone: p?.phone_e164 || "—",
            college: p?.college_name || "—",
            memberCode: p?.public_member_code || "",
            email,
          };
        });

        return {
          id: r.id,
          publicRegistrationCode: r.public_registration_code,
          registrationMode: r.registration_mode,
          teamName: r.team_name,
          capacityUnits: r.capacity_units,
          state: r.state,
          confirmedAt: r.confirmed_at,
          createdAt: r.created_at,
          event: {
            id: ev?.id,
            name: ev?.name || "Event",
            slug: ev?.slug || "",
            categoryName: cat?.name || "General",
            venueName: ven?.name || "TBD",
          },
          order: ord
            ? {
                id: ord.id,
                publicOrderCode: ord.public_order_code,
                checkoutState: ord.checkout_state,
                amountPaise: Number(ol?.line_amount_paise || 0),
              }
            : null,
          registrant: {
            name: ownerProfile?.display_name || "Participant",
            phone: ownerProfile?.phone_e164 || "—",
            college: ownerProfile?.college_name || "—",
            email: ownerEmail,
          },
          members,
        };
      });

      const total = count ?? 0;
      return apiSuccess(req, {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    }

    // -------------------------------------------------------------
    // TAB: GROUPS (CAMPUS AMBASSADORS)
    // -------------------------------------------------------------
    if (tab === "groups") {
      let query = sb
        .from("group_entries")
        .select(
          "id, public_entry_code, lead_name, email, phone, college, group_size, notes, created_at",
          { count: "exact" }
        )
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (cleanQ) {
        query = query.or(
          `public_entry_code.ilike.%${cleanQ}%,lead_name.ilike.%${cleanQ}%,email.ilike.%${cleanQ}%,phone.ilike.%${cleanQ}%,college.ilike.%${cleanQ}%`
        );
      }

      const { data: rawGroupEntries, count, error } = await query;
      if (error) return apiError(req, "INTERNAL", error.message);

      const items = (rawGroupEntries ?? []).map((g) => ({
        id: g.id,
        entryCode: g.public_entry_code,
        leadName: g.lead_name,
        email: g.email,
        phone: g.phone,
        college: g.college || "—",
        groupSize: g.group_size,
        notes: g.notes || "",
        createdAt: g.created_at,
      }));

      const total = count ?? 0;
      return apiSuccess(req, {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    }

    // =============================================================
    // DEFAULT: FULL DASHBOARD INITIAL PAYLOAD
    // Computes ACCURATE GLOBAL METRICS across all records in the DB,
    // and returns page 1 of each dataset with pagination metadata.
    // =============================================================

    // 1. Exact counts and revenue sums across all festival records
    const [
      { count: totalOrdersCount },
      { count: fulfilledOrdersCount },
      { count: refundedOrdersCount },
      { count: pendingOrdersCount },
      { data: allFulfilledOrders },
      { data: allActivePasses },
      { count: registrationsCount },
      { count: usersCount },
      { count: scansCount },
      { count: openQuestionsCount },
      { count: noticesCount },
      { count: eventsCount },
      { count: groupEntriesCount },
      { data: festival },
    ] = await Promise.all([
      sb.from("orders").select("id", { count: "exact", head: true }).eq("festival_id", ctx.festivalId),
      sb.from("orders").select("id", { count: "exact", head: true }).eq("festival_id", ctx.festivalId).eq("checkout_state", "FULFILLED"),
      sb.from("orders").select("id", { count: "exact", head: true }).eq("festival_id", ctx.festivalId).eq("checkout_state", "REFUNDED"),
      sb.from("orders").select("id", { count: "exact", head: true }).eq("festival_id", ctx.festivalId).not("checkout_state", "in", "(\"FULFILLED\",\"REFUNDED\")"),
      sb.from("orders").select("amount_paise, kind").eq("festival_id", ctx.festivalId).eq("checkout_state", "FULFILLED"),
      sb.from("delegate_passes").select("id, pass_products ( slug, is_base_pass )").eq("festival_id", ctx.festivalId).eq("state", "ACTIVE"),
      sb.from("registrations").select("id, events!inner(festival_id)", { count: "exact", head: true }).eq("events.festival_id", ctx.festivalId),
      sb.from("profiles").select("user_id", { count: "exact", head: true }),
      sb.from("scan_attempts").select("id", { count: "exact", head: true }),
      sb.from("support_questions").select("id", { count: "exact", head: true }).eq("status", "OPEN"),
      sb.from("notices").select("id", { count: "exact", head: true }).eq("festival_id", ctx.festivalId),
      sb.from("events").select("id", { count: "exact", head: true }).eq("festival_id", ctx.festivalId),
      sb.from("group_entries").select("id", { count: "exact", head: true }),
      sb.from("festivals").select("slug, name, starts_at, ends_at").eq("id", ctx.festivalId).maybeSingle(),
    ]);

    // Calculate complete gross revenue
    let grossRevenuePaise = 0;
    let basicPassRevenuePaise = 0;
    let delegatePassRevenuePaise = 0;
    let eventsRevenuePaise = 0;

    for (const o of allFulfilledOrders ?? []) {
      const amt = Number(o.amount_paise || 0);
      grossRevenuePaise += amt;
      if (o.kind === "BASE_PASS") {
        if (amt >= 50000) {
          delegatePassRevenuePaise += amt;
        } else {
          basicPassRevenuePaise += amt;
        }
      } else if (o.kind === "EVENT") {
        eventsRevenuePaise += amt;
      }
    }

    // Calculate complete active pass counts
    let basicPassesCount = 0;
    let delegatePassesCount = 0;
    for (const p of allActivePasses ?? []) {
      const prod = Array.isArray(p.pass_products) ? p.pass_products[0] : p.pass_products;
      const isDelegate = prod?.slug === "vip-delegate-pass" || !prod?.is_base_pass;
      if (isDelegate) delegatePassesCount++;
      else basicPassesCount++;
    }

    // 2. Fetch page 1 of Orders
    const initialPageSize = 25;
    const { data: rawOrders } = await sb
      .from("orders")
      .select(`
        id, public_order_code, purchaser_user_id, amount_paise, currency,
        kind, checkout_state, fulfilled_at, created_at
      `)
      .eq("festival_id", ctx.festivalId)
      .order("created_at", { ascending: false })
      .range(0, initialPageSize - 1);

    // 3. Fetch page 1 of Passes
    const { data: rawPasses } = await sb
      .from("delegate_passes")
      .select(`
        id, public_pass_code, user_id, state, activated_at, created_at, expires_at,
        pass_products ( id, name, slug, is_base_pass )
      `)
      .eq("festival_id", ctx.festivalId)
      .order("created_at", { ascending: false })
      .range(0, initialPageSize - 1);

    // 4. Fetch page 1 of Registrations
    const { data: rawRegs } = await sb
      .from("registrations")
      .select(`
        id, public_registration_code, registration_mode, team_name, capacity_units,
        state, confirmed_at, created_at, owner_user_id,
        events!inner (
          id, name, slug, festival_id,
          categories ( name ),
          venues ( name )
        ),
        order_lines (
          id, line_amount_paise,
          orders ( id, public_order_code, checkout_state )
        ),
        registration_members ( role, user_id )
      `)
      .eq("events.festival_id", ctx.festivalId)
      .order("created_at", { ascending: false })
      .range(0, initialPageSize - 1);

    // 5. Fetch page 1 of Group Entries
    const { data: rawGroupEntries } = await sb
      .from("group_entries")
      .select("id, public_entry_code, lead_name, email, phone, college, group_size, notes, created_at")
      .order("created_at", { ascending: false })
      .range(0, initialPageSize - 1);

    // 6. Gather all user IDs across page 1 results to resolve profiles & emails in one batch
    const allPageUserIds = new Set<string>();
    for (const o of rawOrders ?? []) if (o.purchaser_user_id) allPageUserIds.add(o.purchaser_user_id);
    for (const p of rawPasses ?? []) if (p.user_id) allPageUserIds.add(p.user_id);
    for (const r of rawRegs ?? []) {
      if (r.owner_user_id) allPageUserIds.add(r.owner_user_id);
      for (const m of r.registration_members ?? []) if (m.user_id) allPageUserIds.add(m.user_id);
    }

    const { profileMap, emailMap } = await resolveProfilesAndEmails(Array.from(allPageUserIds));

    // Sheets sync & payments for page 1 orders
    const orderIds = (rawOrders ?? []).map((o) => o.id);
    const { data: syncItems } =
      orderIds.length > 0
        ? await sb.from("sheets_sync_items").select("entity_id, sync_state").in("entity_id", orderIds)
        : { data: [] };
    const syncMap = new Map((syncItems ?? []).map((s) => [s.entity_id, s.sync_state]));

    const { data: orderPayments } =
      orderIds.length > 0
        ? await sb
            .from("payments")
            .select("local_order_id, razorpay_payment_id")
            .in("local_order_id", orderIds)
        : { data: [] };
    const paymentMap = new Map((orderPayments ?? []).map((p) => [p.local_order_id, p.razorpay_payment_id]));

    const { data: emailJobs } = await sb
      .from("email_jobs")
      .select("logical_key, state, resend_email_id")
      .order("created_at", { ascending: false })
      .limit(100);
    const emailJobMap = new Map((emailJobs ?? []).map((j) => [j.logical_key, j]));

    // Format formatted orders
    const orders = (rawOrders ?? []).map((o) => {
      const profile = profileMap.get(o.purchaser_user_id);
      const email = emailMap.get(o.purchaser_user_id) || "—";
      const syncState = syncMap.get(o.id) || "NOT_SYNCED";
      const emailJob = emailJobMap.get(`order-confirmation:${o.id}`);
      const isDelegate = o.kind === "BASE_PASS" && Number(o.amount_paise) >= 50000;
      const isBasic = o.kind === "BASE_PASS" && !isDelegate;

      let tierLabel = "Event Entry";
      if (isDelegate) tierLabel = `VIP Delegate Pass (${formatPaise(Number(o.amount_paise))})`;
      else if (isBasic) tierLabel = `Basic Card (${formatPaise(Number(o.amount_paise))})`;

      return {
        id: o.id,
        publicOrderCode: o.public_order_code,
        paymentId: paymentMap.get(o.id) || null,
        amountPaise: Number(o.amount_paise),
        currency: o.currency,
        kind: o.kind,
        tierLabel,
        isDelegate,
        isBasic,
        checkoutState: o.checkout_state,
        createdAt: o.created_at,
        fulfilledAt: o.fulfilled_at,
        purchaser: {
          name: profile?.display_name || "Participant",
          phone: profile?.phone_e164 || "—",
          college: profile?.college_name || "—",
          email,
        },
        sheetsSyncState: syncState,
        emailStatus: emailJob?.state || "PENDING",
      };
    });

    // Format formatted passes
    const passes = (rawPasses ?? []).map((p) => {
      const prod = Array.isArray(p.pass_products) ? p.pass_products[0] : p.pass_products;
      const profile = profileMap.get(p.user_id);
      const email = emailMap.get(p.user_id) || "—";
      const isDelegate = prod?.slug === "vip-delegate-pass" || !prod?.is_base_pass;

      return {
        id: p.id,
        publicPassCode: p.public_pass_code,
        productName: prod?.name || (isDelegate ? "VIP Delegate Pass" : "Basic Pass"),
        productSlug: prod?.slug || "pass",
        isDelegate,
        state: p.state,
        activatedAt: p.activated_at,
        createdAt: p.created_at,
        expiresAt: p.expires_at,
        hasQr: isDelegate && p.state === "ACTIVE",
        holder: {
          name: profile?.display_name || "Participant",
          phone: profile?.phone_e164 || "—",
          college: profile?.college_name || "—",
          email,
        },
      };
    });

    // Format formatted registrations
    const registrations = (rawRegs ?? []).map((r) => {
      const ev = Array.isArray(r.events) ? r.events[0] : r.events;
      const cat = ev?.categories ? (Array.isArray(ev.categories) ? ev.categories[0] : ev.categories) : null;
      const ven = ev?.venues ? (Array.isArray(ev.venues) ? ev.venues[0] : ev.venues) : null;
      const ol = Array.isArray(r.order_lines) ? r.order_lines[0] : r.order_lines;
      const ord = ol?.orders ? (Array.isArray(ol.orders) ? ol.orders[0] : ol.orders) : null;

      const ownerProfile = profileMap.get(r.owner_user_id);
      const ownerEmail = emailMap.get(r.owner_user_id) || "—";

      const members = (r.registration_members ?? []).map((m: { role: string; user_id: string }) => {
        const p = profileMap.get(m.user_id);
        const email = emailMap.get(m.user_id) || "—";
        return {
          role: m.role,
          userId: m.user_id,
          name: p?.display_name || "Participant",
          phone: p?.phone_e164 || "—",
          college: p?.college_name || "—",
          memberCode: p?.public_member_code || "",
          email,
        };
      });

      return {
        id: r.id,
        publicRegistrationCode: r.public_registration_code,
        registrationMode: r.registration_mode,
        teamName: r.team_name,
        capacityUnits: r.capacity_units,
        state: r.state,
        confirmedAt: r.confirmed_at,
        createdAt: r.created_at,
        event: {
          id: ev?.id,
          name: ev?.name || "Event",
          slug: ev?.slug || "",
          categoryName: cat?.name || "General",
          venueName: ven?.name || "TBD",
        },
        order: ord
          ? {
              id: ord.id,
              publicOrderCode: ord.public_order_code,
              checkoutState: ord.checkout_state,
              amountPaise: Number(ol?.line_amount_paise || 0),
            }
          : null,
        registrant: {
          name: ownerProfile?.display_name || "Participant",
          phone: ownerProfile?.phone_e164 || "—",
          college: ownerProfile?.college_name || "—",
          email: ownerEmail,
        },
        members,
      };
    });

    // Format formatted group entries
    const groupEntries = (rawGroupEntries ?? []).map((g) => ({
      id: g.id,
      entryCode: g.public_entry_code,
      leadName: g.lead_name,
      email: g.email,
      phone: g.phone,
      college: g.college || "—",
      groupSize: g.group_size,
      notes: g.notes || "",
      createdAt: g.created_at,
    }));

    const totalOrders = totalOrdersCount ?? 0;
    const totalPasses = (basicPassesCount + delegatePassesCount) || (rawPasses?.length ?? 0);
    const totalRegistrations = registrationsCount ?? 0;
    const totalGroupEntries = groupEntriesCount ?? 0;

    return apiSuccess(req, {
      metrics: {
        grossRevenuePaise,
        basicPassRevenuePaise,
        delegatePassRevenuePaise,
        eventsRevenuePaise,
        totalOrdersCount: totalOrders,
        fulfilledOrdersCount: fulfilledOrdersCount ?? 0,
        pendingOrdersCount: pendingOrdersCount ?? 0,
        refundedOrdersCount: refundedOrdersCount ?? 0,
        basicPassesCount,
        delegatePassesCount,
        registrationsCount: totalRegistrations,
        usersCount: usersCount ?? 0,
        scansCount: scansCount ?? 0,
        openQuestionsCount: openQuestionsCount ?? 0,
        noticesCount: noticesCount ?? 0,
        eventsCount: eventsCount ?? 0,
        groupEntriesCount: totalGroupEntries,
      },
      orders,
      ordersPagination: {
        page: 1,
        pageSize: initialPageSize,
        total: totalOrders,
        totalPages: Math.max(1, Math.ceil(totalOrders / initialPageSize)),
      },
      passes,
      passesPagination: {
        page: 1,
        pageSize: initialPageSize,
        total: totalPasses,
        totalPages: Math.max(1, Math.ceil(totalPasses / initialPageSize)),
      },
      registrations,
      registrationsPagination: {
        page: 1,
        pageSize: initialPageSize,
        total: totalRegistrations,
        totalPages: Math.max(1, Math.ceil(totalRegistrations / initialPageSize)),
      },
      groupEntries,
      groupEntriesPagination: {
        page: 1,
        pageSize: initialPageSize,
        total: totalGroupEntries,
        totalPages: Math.max(1, Math.ceil(totalGroupEntries / initialPageSize)),
      },
      telemetry: {
        database: { status: "ONLINE", provider: "Supabase PostgreSQL" },
        googleSheets: {
          enabled: e.GOOGLE_SHEETS_ENABLED,
          configured: Boolean(e.GOOGLE_SERVICE_ACCOUNT_JSON || e.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64),
          basicSpreadsheetId: e.GOOGLE_SHEETS_BASIC_PASS_ID || null,
          delegateSpreadsheetId: e.GOOGLE_SHEETS_DELEGATE_PASS_ID || null,
          eventsSpreadsheetId: e.GOOGLE_SHEETS_EVENTS_ID || null,
          merchandiseSpreadsheetId: e.GOOGLE_SHEETS_MERCHANDISE_ID || null,
          groupEntrySpreadsheetId: e.GOOGLE_SHEETS_GROUP_ENTRY_ID || null,
        },
        resendEmail: {
          enabled: Boolean(e.RESEND_API_KEY),
          fromEmail: e.EMAIL_FROM,
        },
        festival: {
          slug: festival?.slug ?? "unknown",
          name: festival?.name ?? "TARANG",
          dates:
            festival?.starts_at && festival?.ends_at
              ? `${new Intl.DateTimeFormat("en-IN", {
                  day: "numeric",
                  month: "short",
                  timeZone: "Asia/Kolkata",
                }).format(new Date(festival.starts_at))}–${new Intl.DateTimeFormat("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "Asia/Kolkata",
                }).format(new Date(festival.ends_at))}`
              : "TBD",
          venue: "NIT Patna",
        },
      },
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
