import { useState, useMemo, useEffect } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, Pill, Page, Tabs, Metrics, Loading, Empty, LoadError, moneyExact, niceTime, todayStr, CITIES, cityName,
  shortDate, shortDateTime, isExpired, whenBucket, dateExpiry, EV_CATS, toCents, stampCity, DEFAULT_CITY, DAY, confirmDanger, promptReason } from "./ui.js?v=__V__";
import { useLoader, paged, sendModerate, sendInvite, COLS, showError } from "./db.js?v=__V__";
import { CommunityModal, InviteModal, BanModal } from "./modals.js?v=__V__";
import { PAGE } from "./routes.js?v=__V__";

/* Data — the owner's god view. Every announcement, event and member across
   ALL communities in one giant grid: metric chips up top, then an
   Airtable-style table — sticky header, sortable columns, search, community
   filter, "+ New" row creation, and EVERY column editable in place: text,
   dates, money, and select-pickers for community, author and member
   (RLS is the real permission gate; this page is only offered to owners).
   Every tab pages through its table, so the metric chips count everything. */

const isoToLocal = (iso) => {
  if (!iso) return "";
  const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const localToIso = (v) => (v ? new Date(v).toISOString() : null);

// value codecs per column type: display, prefill the input, parse it back
const T = {
  text:   { fmt: (v) => (v ?? "—"), toIn: (v) => v ?? "", parse: (v) => (v.trim() || null), input: "text" },
  money:  { fmt: (v) => (v ? moneyExact(v) : "—"), toIn: (v) => (v ? v / 100 : ""), parse: toCents, input: "number" },
  date:   { fmt: shortDate, toIn: (v) => v || "", parse: (v) => v || null, input: "date" },
  time:   { fmt: (v) => (v ? niceTime(v) : "—"), toIn: (v) => v || "", parse: (v) => v || null, input: "time" },
  dt:     { fmt: shortDateTime, toIn: isoToLocal, parse: localToIso, input: "datetime-local" },
  select: { fmt: (v) => (v ?? "—"), toIn: (v) => v ?? "", parse: (v) => v || null },
};

// option builders for the select-pickers
const commOpts = (ctx, noneLabel) => [
  ...(noneLabel ? [{ v: "", l: noneLabel }] : []),
  ...ctx.communities.map((c) => ({ v: c.id, l: c.name })),
];
const profOpts = (ctx) => ctx.profiles.map((p) => ({ v: p.id, l: p.display_name || p.id.slice(0, 6) }));
const commName = (ctx, id, noneLabel) => (id ? (ctx.communities.find((c) => c.id === id)?.name || "?") : noneLabel);
const profName = (ctx, id) => (id ? (ctx.profiles.find((p) => p.id === id)?.display_name || id.slice(0, 6)) : "—");
const profCell = (ctx, id) => { const p = ctx.profiles.find((x) => x.id === id);
  return html`<span class="who">${p && html`<${Avatar} profile=${p} size="sm" />`}${p?.display_name || (id ? id.slice(0, 6) : "—")}</span>`; };
const all = (build) => paged((from, to) => build().range(from, to));
const withinDays = (iso, n) => iso > new Date(Date.now() - n * DAY).toISOString();

// Ban from ALL of Collide — People and Memberships share one button
const banAction = (getId, getName) => (r, api) => html`<button class="btn sm danger" onClick=${async () => {
  const who = getName(r) || "this user";
  const reason = promptReason(`Ban ${who} from ALL of Collide?\n\nThey are signed out, can't sign back in, lose every membership, and can't be re-invited. Type a reason to confirm:`);
  if (reason === null || !reason.trim()) return;
  const res = await sendModerate(api.client, { action: "ban", profile_id: getId(r), reason: reason.trim() });
  if (res.error) showError(api.flash, "Ban", res.error); else { api.flash(`Banned ${who} 🔨`); api.reload(); }
}}>Ban</button>`;

const SCHEMAS = {
  communities: {
    table: "communities",
    newLabel: "+ New community",
    modalCreate: true,   // name/city/etc chosen up front; owner membership seeded
    load: (client) => all(() => client.from("communities").select("*").order("created_at")),
    match: (q, r) => q.eq("id", r.id),
    metrics: (rows) => [
      ["total", rows.length],
      ["active", rows.filter((r) => !r.archived_at).length],
      ["archived", rows.filter((r) => r.archived_at).length],
      ["cities", new Set(rows.filter((r) => !r.archived_at).map((r) => r.city || DEFAULT_CITY)).size],
    ],
    cols: [
      { key: "emoji", label: "", type: "text", edit: true },
      { key: "name", label: "Community", type: "text", edit: true, wide: true },
      { key: "city", label: "City", type: "select", edit: true,
        options: () => CITIES.map(([v, l]) => ({ v, l })), get: (r) => cityName(r.city || DEFAULT_CITY) },
      { key: "description", label: "Description", type: "text", edit: true },
      { key: "membership_price_cents", label: "Price/mo", type: "money", edit: true },
      { key: "created_at", label: "Created", type: "dt" },
      { key: "archived_at", label: "Status", get: (r) => (r.archived_at ? "archived" : "active"),
        cell: (r) => r.archived_at
          ? html`<${Pill} tone="warn">🗂 archived ${shortDate(r.archived_at)}</${Pill}>`
          : html`<${Pill} tone="ok">active</${Pill}>` },
    ],
    rowAction: (r, api) => html`<button class="btn sm ghost" onClick=${async () => {
      const val = r.archived_at ? null : new Date().toISOString();
      if (!r.archived_at && !confirmDanger(`Archive "${r.name}"? It disappears from members' apps (POIs and announcements included) until restored. Staff keep console access.`)) return;
      const { error } = await api.client.from("communities").update({ archived_at: val }).eq("id", r.id);
      if (error) showError(api.flash, "Archive", error); else { api.flash(val ? "Archived — hidden from the app 🗂" : "Restored — live again ✓"); api.reload(); }
    }}>${r.archived_at ? "Restore" : "Archive"}</button>`,
  },
  announcements: {
    table: "announcements",
    newLabel: "+ New announcement",
    load: (client) => all(() => client.from("announcements")
      .select("*, author:profiles!announcements_author_id_fkey(id,display_name,avatar_url)")
      .order("created_at", { ascending: false })),
    match: (q, r) => q.eq("id", r.id),
    create: (client, ctx) => client.from("announcements").insert({
      body: "New announcement ✏️ (click to edit)",
      community_id: null, city: DEFAULT_CITY,
      expires_at: new Date(Date.now() + 48 * 36e5).toISOString(),
    }),
    // the city follows the community — members only see their city's posts
    derive: (key, val, ctx) => (key === "community_id" ? { city: stampCity(ctx.communities, val) } : {}),
    metrics: (rows) => [
      ["total", rows.length],
      ["live", rows.filter((r) => !isExpired(r.expires_at)).length],
      ["expired", rows.filter((r) => isExpired(r.expires_at)).length],
      ["global", rows.filter((r) => !r.community_id).length],
    ],
    cols: [
      { key: "body", label: "Announcement", type: "text", edit: true, wide: true },
      { key: "community_id", label: "Community", type: "select", edit: true,
        options: (ctx) => commOpts(ctx, "🌍 Global"), get: (r, ctx) => commName(ctx, r.community_id, "🌍 Global") },
      { key: "author_id", label: "Author", type: "select", edit: true, join: true,
        options: profOpts, get: (r) => r.author?.display_name || "—" },
      { key: "created_at", label: "Posted", type: "dt", edit: true },
      { key: "expires_at", label: "Expires", type: "dt", edit: true },
    ],
  },
  events: {
    table: "activities",
    newLabel: "+ New event",
    load: (client) => all(() => client.from("activities").select("*").order("created_at", { ascending: false })),
    match: (q, r) => q.eq("id", r.id),
    create: (client, ctx) => client.from("activities").insert({
      title: "New event ✏️ (click to edit)",
      community_id: ctx.communities[0]?.id ?? null,
      city: ctx.communities[0]?.city || DEFAULT_CITY,
      host_id: ctx.session.user.id,
      date: todayStr(), category: "other", visibility: "public",
      when_bucket: "today", expires_at: dateExpiry(todayStr()),
    }),
    // keep the app-native mirror fields in sync when the admin edits inline
    derive: (key, val, ctx) => {
      if (key === "community_id") return val ? { city: stampCity(ctx.communities, val) } : {};
      if (key === "date") return val ? { when_bucket: whenBucket(val), expires_at: dateExpiry(val) } : { when_bucket: null };
      if (key === "starts_at") return { at_time: val ? niceTime(val) : null };
      if (key === "location") return { place: val };
      return {};
    },
    metrics: (rows) => [
      ["total", rows.length],
      ["upcoming", rows.filter((r) => r.date ? r.date >= todayStr() : !isExpired(r.expires_at)).length],
      ["past", rows.filter((r) => r.date ? r.date < todayStr() : isExpired(r.expires_at)).length],
      ["ticketed", rows.filter((r) => r.price_cents > 0).length],
    ],
    cols: [
      { key: "title", label: "Event", type: "text", edit: true, wide: true },
      { key: "community_id", label: "Community", type: "select", edit: true,
        options: (ctx) => commOpts(ctx, "— none"), get: (r, ctx) => commName(ctx, r.community_id, "— none") },
      { key: "date", label: "Date", type: "date", edit: true },
      { key: "starts_at", label: "Time", type: "time", edit: true },
      { key: "location", label: "Location", type: "text", edit: true },
      { key: "category", label: "Category", type: "select", edit: true, options: () => EV_CATS.map((c) => ({ v: c, l: c })) },
      { key: "price_cents", label: "Price", type: "money", edit: true },
      { key: "capacity", label: "Cap", type: "text", edit: true },
    ],
  },
  people: {
    // ONE row per user — memberships are a different tab. This is where
    // "how many people do we actually have" gets answered without double
    // counting anyone who's in several communities.
    table: "profiles",
    newLabel: null,   // people arrive via invites, not row creation
    load: (client) => all(() => client.from("profiles")
      .select(COLS.profile + ",connect_code, memberships:community_members(community_id,status)")
      .order("created_at", { ascending: false })),
    match: (q, r) => q.eq("id", r.id),
    metrics: (rows) => [
      ["people", rows.length],
      ["in a community", rows.filter((r) => (r.memberships || []).some((m) => m.status === "member")).length],
      ["multi-community", rows.filter((r) => (r.memberships || []).filter((m) => m.status === "member").length > 1).length],
      ["unattached", rows.filter((r) => !(r.memberships || []).length).length],
    ],
    cols: [
      { key: "display_name", label: "Person", type: "text", edit: true, wide: true,
        cell: (r) => html`<span class="who"><${Avatar} profile=${r} size="sm" /> <b>${r.display_name || "—"}</b></span> ` },
      { key: "memberships", label: "Communities",
        get: (r) => (r.memberships || []).filter((m) => m.status === "member").length,
        cell: (r, ctx) => (r.memberships || []).length
          ? html`<span class="u-row u-wrap" style="gap:4px">
              ${(r.memberships || []).map((m) => html`<${Pill} title=${m.status}>${commName(ctx, m.community_id, "?")}</${Pill}>`)}
            </span>`
          : html`<span class="muted">—</span>` },
      { key: "home_city", label: "Home city", type: "select", edit: true,
        options: () => CITIES.map(([v, l]) => ({ v, l })), get: (r) => (r.home_city ? cityName(r.home_city) : "—") },
      { key: "phone", label: "Phone", type: "text", edit: true },
      { key: "connect_code", label: "Connect code" },
      { key: "created_at", label: "Joined Collide", type: "dt" },
    ],
    rowAction: banAction((r) => r.id, (r) => r.display_name),
    noDelete: true,   // removing an account goes through ban/remove, not row delete
  },
  members: {
    table: "community_members",
    newLabel: "+ Add member",
    modalCreate: true,   // composite key — pick person & community first
    load: (client) => all(() => client.from("community_members")
      .select("*, profile:profiles!community_members_profile_id_fkey(id,display_name,avatar_url)")
      .order("joined_at", { ascending: false })),
    match: (q, r) => q.eq("community_id", r.community_id).eq("profile_id", r.profile_id),
    metrics: (rows) => [
      ["people", new Set(rows.map((r) => r.profile_id)).size],   // unique — one person can hold several memberships
      ["memberships", rows.length],
      ["pending", rows.filter((r) => r.status === "pending").length],
      ["communities", new Set(rows.map((r) => r.community_id)).size],
    ],
    cols: [
      { key: "profile_id", label: "Member", type: "select", edit: true, wide: true, join: true,
        options: profOpts, get: (r) => r.profile?.display_name || "—",
        cell: (r) => html`<span class="who"><${Avatar} profile=${r.profile} size="sm" /> <b>${r.profile?.display_name || "—"}</b></span> ` },
      { key: "community_id", label: "Community", type: "select", edit: true,
        options: (ctx) => commOpts(ctx), get: (r, ctx) => commName(ctx, r.community_id, "?") },
      { key: "status", label: "Status", type: "select", edit: true, options: () => [{ v: "member", l: "member" }, { v: "pending", l: "pending" }],
        cell: (r) => html`<${Pill}>${r.status}</${Pill}>` },
      { key: "joined_at", label: "Joined", type: "dt", edit: true },
    ],
    rowAction: banAction((r) => r.profile_id, (r) => r.profile?.display_name),
  },
  // Who holds a facilitator key (staff) and whether their public listing (the
  // app's `facilitators` table) is live. The DB keeps the two in step — a staff
  // key spawns an inactive listing stub, dropping the key retires it — so this
  // is one roster, not two. Pulling a key is the only write here.
  facilitators: {
    table: "staff",
    newLabel: null,   // keys are granted from Dashboard → Members → Facilitators (invite flow)
    load: (client) => client.from("facilitator_roster").select("*").order("staff_since", { ascending: false }),
    match: (q, r) => q.eq("id", r.staff_id),
    noDelete: true,
    metrics: (rows) => [
      ["keys", rows.length],
      ["signed in", rows.filter((r) => r.profile_id).length],
      ["listed", rows.filter((r) => r.listing_active).length],
      ["all-community", rows.filter((r) => !r.community_id).length],
    ],
    cols: [
      { key: "email", label: "Facilitator", wide: true,
        cell: (r) => html`<span class="who">
          ${r.profile_id && html`<${Avatar} profile=${{ display_name: r.display_name, avatar_url: r.avatar_url }} size="sm" />`}
          <span><b>${r.display_name || r.email}</b>${r.display_name && html`<div class="tiny muted">${r.email}</div>`}</span></span>` },
      { key: "community_id", label: "Community", get: (r, ctx) => commName(ctx, r.community_id, "all communities") },
      { key: "profile_id", label: "Account", get: (r) => (r.profile_id ? "signed in" : "not yet"),
        cell: (r) => (r.profile_id ? html`<${Pill} tone="ok">signed in</${Pill}>` : html`<${Pill} tone="warn">never signed in</${Pill}>`) },
      { key: "listing_active", label: "Public listing", get: (r) => (r.listing_active ? "live" : r.has_listing ? "draft" : "none"),
        cell: (r) => r.listing_active ? html`<${Pill} tone="brand">live</${Pill}>`
          : r.community_id ? html`<${Pill} tone="neutral">${r.has_listing ? "draft — they fill it in from the app" : "none"}</${Pill}>`
          : html`<span class="muted tiny">n/a (all-community key)</span>` },
      { key: "headline", label: "Headline", get: (r) => r.headline || "—" },
      { key: "staff_since", label: "Key since", type: "dt" },
    ],
    rowAction: (r, api) => html`<button class="btn sm danger" onClick=${async () => {
      if (!confirmDanger(`Remove ${r.display_name || r.email}'s facilitator key${r.community_id ? "" : " (all communities)"}? Their public listing is retired with it.`)) return;
      const { error } = await api.client.from("staff").delete().eq("id", r.staff_id).neq("role", "owner");
      if (error) showError(api.flash, "Remove key", error); else { api.flash("Key removed"); api.reload(); }
    }}>Remove key</button>`,
  },

  // Circles = the app's friend graph. Read-only: for support ("why can't I
  // see X") and abuse cases ("who is this person connected to").
  circles: {
    table: "connections",
    newLabel: null,
    load: (client) => all(() => client.from("connections").select("*").order("created_at", { ascending: false })),
    match: (q, r) => q.eq("a", r.a).eq("b", r.b),
    noDelete: true,
    metrics: (rows) => [
      ["connections", rows.filter((r) => r.status === "accepted").length],
      ["pending", rows.filter((r) => r.status === "pending").length],
      ["people connected", new Set(rows.filter((r) => r.status === "accepted").flatMap((r) => [r.a, r.b])).size],
      ["this month", rows.filter((r) => withinDays(r.created_at, 30)).length],
    ],
    cols: [
      { key: "a", label: "Person", wide: true, get: (r, ctx) => profName(ctx, r.a), cell: (r, ctx) => profCell(ctx, r.a) },
      { key: "b", label: "Connected to", wide: true, get: (r, ctx) => profName(ctx, r.b), cell: (r, ctx) => profCell(ctx, r.b) },
      { key: "requested_by", label: "Asked by", get: (r, ctx) => (r.requested_by === r.a ? "←" : r.requested_by === r.b ? "→" : "?") + " " + profName(ctx, r.requested_by) },
      { key: "status", label: "Status", get: (r) => r.status, cell: (r) => html`<${Pill}>${r.status || "—"}</${Pill}>` },
      { key: "created_at", label: "Since", type: "dt" },
    ],
  },

  // DM threads (one per announcement reply). Bodies are NOT shown here — that
  // is Moderation's job, where each message can be hidden or removed; this is
  // the thread-level index for support: who talked to whom, about what, when.
  dms: {
    table: "dm_threads",
    newLabel: null,
    load: async (client) => {
      const res = await all(() => client.from("dm_threads")
        .select("*, announcement:announcements(body,community_id), messages:dm_messages(count)")
        .order("created_at", { ascending: false }));
      return { ...res, data: (res.data || []).map((r) => ({ ...r, community_id: r.announcement?.community_id ?? null, msg_count: r.messages?.[0]?.count ?? 0 })) };
    },
    match: (q, r) => q.eq("id", r.id),
    noDelete: true,
    metrics: (rows) => [
      ["threads", rows.length],
      ["open", rows.filter((r) => r.status !== "closed").length],
      ["messages", rows.reduce((a, r) => a + (r.msg_count || 0), 0)],
      ["this week", rows.filter((r) => withinDays(r.created_at, 7)).length],
    ],
    cols: [
      { key: "starter_id", label: "Started by", get: (r, ctx) => profName(ctx, r.starter_id), cell: (r, ctx) => profCell(ctx, r.starter_id) },
      { key: "owner_id", label: "With", get: (r, ctx) => profName(ctx, r.owner_id), cell: (r, ctx) => profCell(ctx, r.owner_id) },
      { key: "announcement_id", label: "About", wide: true, get: (r) => r.announcement?.body || "—",
        cell: (r) => html`<span class="muted">${(r.announcement?.body || "—").slice(0, 90)}</span>` },
      { key: "community_id", label: "Community", get: (r, ctx) => commName(ctx, r.community_id, "—") },
      { key: "msg_count", label: "Msgs" },
      { key: "status", label: "Status", get: (r) => r.status || "open",
        cell: (r) => html`<${Pill} tone=${r.status === "closed" ? "neutral" : "ok"}>${r.status || "open"}${r.closed_at ? html` <span class="tiny muted">${shortDateTime(r.closed_at)}</span>` : ""}</${Pill}>` },
      { key: "created_at", label: "Started", type: "dt" },
    ],
    rowAction: (r, api) => html`<button class="btn sm ghost" onClick=${() => api.go("mod?kind=dm_messages&q=" + r.id)}>Messages</button>`,
  },

  invites: {
    table: "invites",
    newLabel: null,   // invites are sent from the member/facilitator modals
    load: (client) => all(() => client.from("invites").select("*").order("sent_at", { ascending: false })),
    match: (q, r) => q.eq("id", r.id),
    // revoking an unaccepted facilitator invite also pulls their staff key
    afterDelete: async (client, r) => {
      if (r.kind === "facilitator" && !r.accepted_at) {
        let q = client.from("staff").delete().eq("email", r.email).neq("role", "owner");
        q = r.community_id === null ? q.is("community_id", null) : q.eq("community_id", r.community_id);
        await q;
      }
    },
    metrics: (rows) => [
      ["sent", rows.length],
      ["accepted", rows.filter((r) => r.accepted_at).length],
      ["awaiting", rows.filter((r) => !r.accepted_at).length],
      ["accept rate", rows.length ? Math.round(rows.filter((r) => r.accepted_at).length / rows.length * 100) + "%" : "—"],
    ],
    cols: [
      { key: "email", label: "Invited", wide: true },
      { key: "kind", label: "Kind", get: (r) => r.kind, cell: (r) => html`<${Pill} tone=${r.kind === "facilitator" ? "brand" : "neutral"}>${r.kind}</${Pill}>` },
      { key: "community_id", label: "Community",
        get: (r, ctx) => commName(ctx, r.community_id, r.kind === "facilitator" ? "all communities" : "—") },
      { key: "invited_by", label: "Invited by" },
      { key: "sent_at", label: "Sent", get: (r) => r.sent_at,
        cell: (r) => html`${shortDateTime(r.sent_at)}${r.attempts > 1 && html` <span class="muted tiny">·×${r.attempts}</span>`}` },
      { key: "accepted_at", label: "Status", get: (r) => r.accepted_at || "",
        cell: (r) => r.accepted_at
          ? html`<${Pill} tone="ok">accepted ${shortDate(r.accepted_at)}</${Pill}>`
          : html`<${Pill} tone="warn">awaiting</${Pill}>` },
    ],
    rowAction: (r, api) => !r.accepted_at && html`<button class="btn sm ghost" onClick=${async () => {
      const res = await sendInvite(api.client, { email: r.email, kind: r.kind, community_id: r.community_id });
      if (res.error) showError(api.flash, "Resend", res.error); else { api.flash("Invite re-sent 💌"); api.reload(); }
    }}>Resend</button>`,
  },
  bans: {
    table: "bans",
    newLabel: "+ Ban by email",
    modalCreate: true,
    load: (client) => all(() => client.from("bans").select("*").order("created_at", { ascending: false })),
    match: (q, r) => q.eq("id", r.id),
    noDelete: true,   // lifting a ban goes through the moderate function, not row delete
    metrics: (rows) => [
      ["banned", rows.length],
      ["this month", rows.filter((r) => withinDays(r.created_at, 30)).length],
    ],
    cols: [
      { key: "email", label: "Banned", wide: true },
      { key: "reason", label: "Reason", get: (r) => r.reason || "—" },
      { key: "banned_by", label: "By" },
      { key: "created_at", label: "When", type: "dt" },
    ],
    rowAction: (r, api) => html`<button class="btn sm ghost" onClick=${async () => {
      if (!confirmDanger(`Lift the ban on ${r.email}? They can sign in and be invited again (memberships are not restored).`)) return;
      const res = await sendModerate(api.client, { action: "unban", email: r.email });
      if (res.error) showError(api.flash, "Unban", res.error); else { api.flash(`Unbanned ${r.email} ✓`); api.reload(); }
    }}>Unban</button>`,
  },
};

function EditCell({ row, col, ctx, onSave }) {
  const t = T[col.type || "text"];
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState("");
  const shown = col.cell ? col.cell(row, ctx) : (col.get ? col.get(row, ctx) : t.fmt(row[col.key]));
  if (!col.edit) return html`<div class="cellv">${shown}</div>`;
  if (!editing) {
    return html`<div class="cellv" onClick=${() => { setV(t.toIn(row[col.key])); setEditing(true); }}>${shown}</div>`;
  }
  if (col.type === "select") {
    const opts = col.options(ctx);
    // picks commit instantly — airtable feel
    return html`<select value=${v}
      onChange=${(e) => { setEditing(false); const val = e.target.value || null; if (val !== row[col.key]) onSave(col.key, val); }}
      onBlur=${() => setEditing(false)}
      onKeyDown=${(e) => { if (e.key === "Escape") setEditing(false); }}
      ref=${(el) => el && setTimeout(() => el.focus(), 0)}>
      ${!opts.some((o) => o.v === (v ?? "")) && html`<option value=${v}>—</option>`}
      ${opts.map((o) => html`<option value=${o.v}>${o.l}</option>`)}
    </select>`;
  }
  const commit = () => {
    setEditing(false);
    const val = t.parse(String(v));
    if (val !== row[col.key]) onSave(col.key, val);
  };
  const keys = (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); };
  return html`<input type=${t.input} step=${col.type === "money" ? "0.01" : undefined} value=${v}
    onInput=${(e) => setV(e.target.value)} onBlur=${commit} onKeyDown=${keys}
    ref=${(el) => el && setTimeout(() => { el.focus(); if (el.select) el.select(); }, 0)} />`;
}

export function DataPage({ client, communities, session, flash, sub, go }) {
  const tab = PAGE.data.tabs.some(([k]) => k === sub) ? sub : "communities";
  const S = SCHEMAS[tab];
  const [q, setQ] = useState("");
  const [comm, setComm] = useState("");
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const [adding, setAdding] = useState(false);

  // one profile roster powers the author/member pickers on every tab
  const { data: profiles } = useLoader(() => all(() => client.from("profiles").select(COLS.profileMin).order("display_name")), [client], { flash, where: "People roster" });
  const { data: rows, error, reload, setData } = useLoader(() => S.load(client), [client, tab], { flash, where: "Data · " + tab });
  useEffect(() => { setSort({ key: null, dir: 1 }); setQ(""); }, [tab]);

  const ctx = { communities, profiles: profiles || [], session };
  const api = { client, flash, reload, go };

  const save = async (row, key, val) => {
    const patch = { [key]: val, ...(S.derive ? S.derive(key, val, ctx) : {}) };
    const { error: e } = await S.match(client.from(S.table).update(patch), row);
    if (e) { showError(flash, "Save", e); return; }
    const col = S.cols.find((c) => c.key === key);
    if (col?.join) reload();   // joined display (author/member name) needs a refetch
    else setData((rs) => rs.map((r) => (r === row ? { ...r, ...patch } : r)));
    flash("Saved ✓");
  };
  const del = async (row) => {
    const name = row.title || row.body?.slice(0, 40) || row.profile?.display_name || "this row";
    if (!confirmDanger(`Delete "${name}"? This removes it from the live app.`)) return;
    const { error: e } = await S.match(client.from(S.table).delete(), row);
    if (e) { showError(flash, "Delete", e); return; }
    if (S.afterDelete) await S.afterDelete(client, row);
    setData((rs) => rs.filter((r) => r !== row));
    flash("Deleted");
  };
  const addNew = async () => {
    if (S.modalCreate) { setAdding(true); return; }
    const { error: e } = await S.create(client, ctx);
    if (e) { showError(flash, "Add row", e); return; }
    flash("Row added — edit it inline ✏️");
    reload();
  };

  const filtered = useMemo(() => {
    let out = rows || [];
    const commKey = tab === "communities" ? "id" : "community_id";
    if (tab === "people") {
      if (comm === "global") out = out.filter((r) => !(r.memberships || []).length);
      else if (comm) out = out.filter((r) => (r.memberships || []).some((m) => m.community_id === comm));
    } else if (comm === "global") out = out.filter((r) => !r[commKey]);
    else if (comm) out = out.filter((r) => r[commKey] === comm);
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      out = out.filter((r) => JSON.stringify(r).toLowerCase().includes(n) ||
        (commName(ctx, r.community_id, "global") || "").toLowerCase().includes(n));
    }
    if (sort.key) {
      const col = S.cols.find((c) => c.key === sort.key);
      const gv = (r) => (col.get ? col.get(r, ctx) : r[col.key]);
      out = [...out].sort((a, b) => {
        const x = gv(a), y = gv(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
      });
    }
    return out;
  }, [rows, q, comm, sort, tab, communities, profiles]);

  const metrics = useMemo(() => S.metrics(rows || []), [rows, tab]);

  return html`<${Page} title="Data" sub="every community, live tables — you have full permissions here">
    <${Tabs} page="data" current=${tab} go=${go} />

    <div class="dt-metrics">
      <${Metrics} size="sm" loading=${rows === null} items=${metrics} />
      <div class="u-grow"></div>
      ${S.newLabel && html`<button class="btn sm" onClick=${addNew}>${S.newLabel}</button>`}
      <input class="dt-search" placeholder="Search ${tab}…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <select class="commselect" value=${comm} onChange=${(e) => setComm(e.target.value)}>
        <option value="">All communities</option>
        ${tab === "announcements" && html`<option value="global">🌍 Global only</option>`}
        ${communities.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
      </select>
    </div>

    ${error && html`<${LoadError} what=${tab} error=${error} onRetry=${reload} />`}
    <div class="dt-wrap">
      <table class="dt">
        <thead><tr>
          ${S.cols.map((c) => html`<th class=${c.wide ? "wide" : ""} aria-sort=${sort.key === c.key ? (sort.dir > 0 ? "ascending" : "descending") : undefined}
            onClick=${() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : 1 }))}>
            ${c.label}${sort.key === c.key ? (sort.dir > 0 ? " ↑" : " ↓") : ""}</th>`)}
          <th style="width:40px"></th>
        </tr></thead>
        <tbody>
          ${filtered.map((r) => html`<tr>
            ${S.cols.map((c) => html`<td class=${"editable" + (c.wide ? " wide" : "")}>
              <${EditCell} row=${r} col=${c} ctx=${ctx} onSave=${(k, v) => save(r, k, v)} />
            </td>`)}
            <td><div class="rowactions" style="padding-right:4px;gap:4px">
              ${S.rowAction && S.rowAction(r, api)}
              ${!S.noDelete && html`<button class="dt-del" title="Delete" aria-label="Delete row" onClick=${() => del(r)}>✕</button>`}
            </div></td>
          </tr>`)}
        </tbody>
      </table>
      ${rows === null && html`<${Loading} />`}
      ${rows !== null && filtered.length === 0 && html`<${Empty} bare>No rows${q || comm ? " match" : ""}.</${Empty}>`}
    </div>
    <p class="tiny muted" style="margin-top:8px">${filtered.length} row${filtered.length === 1 ? "" : "s"}${S.cols.some((c) => c.edit)
      ? " · every cell is editable — click one; changes go live in the app instantly."
      : " · read-only view" + (tab === "dms" ? " — message bodies live in Moderation, where they can be hidden or removed." : ".")}</p>

    ${adding && (tab === "communities"
      ? html`<${CommunityModal} client=${client} session=${session} flash=${flash} onClose=${() => setAdding(false)} />`
      : tab === "bans"
      ? html`<${BanModal} client=${client} flash=${flash} onClose=${() => setAdding(false)} onSaved=${() => { setAdding(false); reload(); }} />`
      : html`<${InviteModal} client=${client} communities=${communities} profiles=${profiles || []} flash=${flash}
          onClose=${() => setAdding(false)} onSaved=${() => { setAdding(false); reload(); }} />`)}
  </${Page}>`;
}
