import { useState, useEffect, useMemo, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, Modal, moneyExact, niceTime, todayStr, CITIES, cityName } from "./ui.js?v=26";

/* Data — the owner's god view. Every announcement, event and member across
   ALL communities in one giant grid: metric chips up top, then an
   Airtable-style table — sticky header, sortable columns, search, community
   filter, "+ New" row creation, and EVERY column editable in place: text,
   dates, money, and select-pickers for community, author and member
   (RLS is the real permission gate; this page is only offered to owners). */

const TABS = [["communities", "Communities"], ["announcements", "Announcements"], ["events", "Events"], ["members", "Members"], ["invites", "Invites"], ["bans", "Bans"]];

const short = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }); }
  catch { return iso; }
};
const shortDT = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return iso; }
};
const isoToLocal = (iso) => {
  if (!iso) return "";
  const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const localToIso = (v) => (v ? new Date(v).toISOString() : null);

// value codecs per column type: display, prefill the input, parse it back
const T = {
  text:   { fmt: (v) => (v ?? "—"), toIn: (v) => v ?? "", parse: (v) => (v.trim() || null), input: "text" },
  money:  { fmt: (v) => (v ? moneyExact(v) : "—"), toIn: (v) => (v ? v / 100 : ""), parse: (v) => Math.round(parseFloat(v || "0") * 100) || 0, input: "number" },
  date:   { fmt: short, toIn: (v) => v || "", parse: (v) => v || null, input: "date" },
  time:   { fmt: (v) => (v ? niceTime(v) : "—"), toIn: (v) => v || "", parse: (v) => v || null, input: "time" },
  dt:     { fmt: shortDT, toIn: isoToLocal, parse: localToIso, input: "datetime-local" },
  select: { fmt: (v) => (v ?? "—"), toIn: (v) => v ?? "", parse: (v) => v || null },
};

// same taxonomy as the app's Plan-something sheet
const EV_CATS = ["food", "coffee", "drinks", "active", "walk", "chill", "other"];
const whenBucket = (dateStr) => {
  const days = Math.round((new Date(dateStr + "T00:00:00") - new Date(new Date().toDateString())) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  const dow = new Date(dateStr + "T00:00:00").getDay();
  if (days <= 7) return (dow === 0 || dow >= 5) ? "this_weekend" : "this_week";
  if (days <= 14) return "next_week";
  return "someday";
};
const dateExpiry = (dateStr) => new Date(new Date(dateStr + "T23:59:00").getTime() + 864e5).toISOString();

const expired = (iso) => !!iso && new Date(iso).getTime() < Date.now();

// option builders for the select-pickers
const commOpts = (ctx, noneLabel) => [
  ...(noneLabel ? [{ v: "", l: noneLabel }] : []),
  ...ctx.communities.map((c) => ({ v: c.id, l: c.name })),
];
const profOpts = (ctx) => ctx.profiles.map((p) => ({ v: p.id, l: p.display_name || p.id.slice(0, 6) }));
const commName = (ctx, id, noneLabel) => (id ? (ctx.communities.find((c) => c.id === id)?.name || "?") : noneLabel);

const SCHEMAS = {
  communities: {
    table: "communities",
    newLabel: "+ New community",
    modalCreate: true,   // name/city/etc chosen up front; owner membership seeded
    load: (client) => client.from("communities").select("*").order("created_at"),
    match: (q, r) => q.eq("id", r.id),
    metrics: (rows) => [
      ["total", rows.length],
      ["active", rows.filter((r) => !r.archived_at).length],
      ["archived", rows.filter((r) => r.archived_at).length],
      ["cities", new Set(rows.filter((r) => !r.archived_at).map((r) => r.city || "nyc")).size],
    ],
    cols: [
      { key: "emoji", label: "", type: "text", edit: true },
      { key: "name", label: "Community", type: "text", edit: true, wide: true },
      { key: "city", label: "City", type: "select", edit: true,
        options: () => CITIES.map(([v, l]) => ({ v, l })), get: (r) => cityName(r.city || "nyc") },
      { key: "description", label: "Description", type: "text", edit: true },
      { key: "membership_price_cents", label: "Price/mo", type: "money", edit: true },
      { key: "created_at", label: "Created", type: "dt" },
      { key: "archived_at", label: "Status", get: (r) => (r.archived_at ? "archived" : "active"),
        cell: (r) => r.archived_at
          ? html`<span class="pillstat pending">🗂 archived ${short(r.archived_at)}</span>`
          : html`<span class="pillstat member">active</span>` },
    ],
    rowAction: (r, api) => html`<button class="btn small ghost" onClick=${async () => {
      const val = r.archived_at ? null : new Date().toISOString();
      if (!r.archived_at && !confirm(`Archive "${r.name}"? It disappears from members' apps (POIs and announcements included) until restored. Staff keep console access.`)) return;
      const { error } = await api.client.from("communities").update({ archived_at: val }).eq("id", r.id);
      api.flash(error ? error.message : (val ? "Archived — hidden from the app 🗂" : "Restored — live again ✓"));
      if (!error) api.reload();
    }}>${r.archived_at ? "Restore" : "Archive"}</button>`,
  },
  announcements: {
    table: "announcements",
    newLabel: "+ New announcement",
    load: (client) => client.from("announcements")
      .select("*, author:profiles!announcements_author_id_fkey(id,display_name,avatar_url)")
      .order("created_at", { ascending: false }).limit(1000),
    match: (q, r) => q.eq("id", r.id),
    create: (client, ctx) => client.from("announcements").insert({
      body: "New announcement ✏️ (click to edit)",
      community_id: null,
      expires_at: new Date(Date.now() + 48 * 36e5).toISOString(),
    }),
    derive: (key, val, ctx) => (key === "community_id" && val
      ? { city: ctx.communities.find((c) => c.id === val)?.city || "nyc" } : {}),
    metrics: (rows) => [
      ["total", rows.length],
      ["live", rows.filter((r) => !expired(r.expires_at)).length],
      ["expired", rows.filter((r) => expired(r.expires_at)).length],
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
    load: (client) => client.from("activities").select("*").order("created_at", { ascending: false }).limit(1000),
    match: (q, r) => q.eq("id", r.id),
    create: (client, ctx) => client.from("activities").insert({
      title: "New event ✏️ (click to edit)",
      community_id: ctx.communities[0]?.id ?? null,
      city: ctx.communities[0]?.city || "nyc",
      host_id: ctx.session.user.id,
      date: todayStr(), category: "other", visibility: "public",
      when_bucket: "today", expires_at: dateExpiry(todayStr()),
    }),
    // keep the app-native mirror fields in sync when the admin edits inline
    derive: (key, val, ctx) => {
      if (key === "community_id") return val
        ? { city: ctx.communities.find((c) => c.id === val)?.city || "nyc" }
        : {};
      if (key === "date") return val
        ? { when_bucket: whenBucket(val), expires_at: dateExpiry(val) }
        : { when_bucket: null };
      if (key === "starts_at") return { at_time: val ? niceTime(val) : null };
      if (key === "location") return { place: val };
      return {};
    },
    metrics: (rows) => [
      ["total", rows.length],
      ["upcoming", rows.filter((r) => r.date ? r.date >= todayStr() : !expired(r.expires_at)).length],
      ["past", rows.filter((r) => r.date ? r.date < todayStr() : expired(r.expires_at)).length],
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
  members: {
    table: "community_members",
    newLabel: "+ Add member",
    modalCreate: true,   // composite key — pick person & community first
    load: (client) => client.from("community_members")
      .select("*, profile:profiles!community_members_profile_id_fkey(id,display_name,avatar_url)")
      .order("joined_at", { ascending: false }).limit(2000),
    match: (q, r) => q.eq("community_id", r.community_id).eq("profile_id", r.profile_id),
    metrics: (rows) => [
      ["total", rows.length],
      ["active", rows.filter((r) => r.status === "member").length],
      ["pending", rows.filter((r) => r.status === "pending").length],
      ["communities", new Set(rows.map((r) => r.community_id)).size],
    ],
    cols: [
      { key: "profile_id", label: "Member", type: "select", edit: true, wide: true, join: true,
        options: profOpts, get: (r) => r.profile?.display_name || "—",
        cell: (r) => html`<span style="display:inline-flex;align-items:center;gap:8px"><${Avatar} profile=${r.profile} size="sm" /> <b>${r.profile?.display_name || "—"}</b></span> ` },
      { key: "community_id", label: "Community", type: "select", edit: true,
        options: (ctx) => commOpts(ctx), get: (r, ctx) => commName(ctx, r.community_id, "?") },
      { key: "status", label: "Status", type: "select", edit: true, options: () => [{ v: "member", l: "member" }, { v: "pending", l: "pending" }],
        cell: (r) => html`<span class=${"pillstat " + r.status}>${r.status}</span>` },
      { key: "joined_at", label: "Joined", type: "dt", edit: true },
    ],
    rowAction: (r, api) => html`<button class="btn small danger" onClick=${async () => {
      const who = r.profile?.display_name || "this user";
      const reason = prompt(`Ban ${who} from ALL of Collide?\n\nThey are signed out, can't sign back in, lose every membership, and can't be re-invited. Type a reason to confirm:`);
      if (reason === null || !reason.trim()) return;
      const res = await sendModerate(api.client, { action: "ban", profile_id: r.profile_id, reason: reason.trim() });
      api.flash(res.error || `Banned ${who} 🔨`);
      if (!res.error) api.reload();
    }}>Ban</button>`,
  },
  invites: {
    table: "invites",
    newLabel: null,   // invites are sent from the member/facilitator modals
    load: (client) => client.from("invites").select("*").order("sent_at", { ascending: false }).limit(1000),
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
      { key: "kind", label: "Kind", get: (r) => r.kind,
        cell: (r) => html`<span class=${"pillstat " + (r.kind === "facilitator" ? "facilitator" : "")}>${r.kind}</span>` },
      { key: "community_id", label: "Community",
        get: (r, ctx) => commName(ctx, r.community_id, r.kind === "facilitator" ? "all communities" : "—") },
      { key: "invited_by", label: "Invited by" },
      { key: "sent_at", label: "Sent", get: (r) => r.sent_at,
        cell: (r) => html`${shortDT(r.sent_at)}${r.attempts > 1 && html` <span class="muted tiny">·×${r.attempts}</span>`}` },
      { key: "accepted_at", label: "Status", get: (r) => r.accepted_at || "",
        cell: (r) => r.accepted_at
          ? html`<span class="pillstat member">accepted ${short(r.accepted_at)}</span>`
          : html`<span class="pillstat pending">awaiting</span>` },
    ],
    rowAction: (r, api) => !r.accepted_at && html`<button class="btn small ghost" onClick=${async () => {
      const res = await sendInvite(api.client, { email: r.email, kind: r.kind, community_id: r.community_id });
      api.flash(res.error || "Invite re-sent 💌");
      if (!res.error) api.reload();
    }}>Resend</button>`,
  },
  bans: {
    table: "bans",
    newLabel: "+ Ban by email",
    modalCreate: true,
    load: (client) => client.from("bans").select("*").order("created_at", { ascending: false }).limit(500),
    match: (q, r) => q.eq("id", r.id),
    noDelete: true,   // lifting a ban goes through the moderate function, not row delete
    metrics: (rows) => [
      ["banned", rows.length],
      ["this month", rows.filter((r) => r.created_at > new Date(Date.now() - 30 * 864e5).toISOString()).length],
    ],
    cols: [
      { key: "email", label: "Banned", wide: true },
      { key: "reason", label: "Reason", get: (r) => r.reason || "—" },
      { key: "banned_by", label: "By" },
      { key: "created_at", label: "When", type: "dt" },
    ],
    rowAction: (r, api) => html`<button class="btn small ghost" onClick=${async () => {
      if (!confirm(`Lift the ban on ${r.email}? They can sign in and be invited again (memberships are not restored).`)) return;
      const res = await sendModerate(api.client, { action: "unban", email: r.email });
      api.flash(res.error || `Unbanned ${r.email} ✓`);
      if (!res.error) api.reload();
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

/* owner-only moderation via the moderate edge function */
export async function sendModerate(client, body) {
  const { data, error } = await client.functions.invoke("moderate", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep generic */ }
    return { error: msg };
  }
  return data || { ok: true };
}

/* invoke the invite edge function (service-role emails + membership) and
   surface its real error message instead of the generic FunctionsHttpError */
export async function sendInvite(client, body) {
  const { data, error } = await client.functions.invoke("invite", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep generic */ }
    return { error: msg };
  }
  return data || { ok: true };
}

/* ban an address that isn't sitting in a members row */
function BanModal({ client, flash, onClose, onSaved }) {
  const [f, setF] = useState({ email: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const res = await sendModerate(client, { action: "ban", email: f.email.trim(), reason: f.reason.trim() || null });
    setBusy(false);
    if (res.error) { flash(res.error); return; }
    flash(`Banned ${f.email.trim()} 🔨`);
    onSaved();
  };
  return html`<${Modal} title="Ban a user" onClose=${onClose}>
    <form onSubmit=${save}>
      <div class="field"><label>Email</label>
        <input type="email" required placeholder="them@email.com" value=${f.email} onInput=${set("email")} /></div>
      <div class="field"><label>Reason</label>
        <input value=${f.reason} onInput=${set("reason")} placeholder="Why — kept for the record" /></div>
      <p class="tiny muted">They're signed out everywhere, can't sign back in, lose all memberships, and can't be re-invited until unbanned.</p>
      <div class="actions">
        <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn danger" disabled=${busy}>${busy ? "Banning…" : "Ban user"}</button>
      </div>
    </form>
  </${Modal}>`;
}

/* new community from the god view — same seeding as Settings: the creator
   becomes owner and lands in the roster; reload refreshes the pickers */
function AddCommunityModal({ client, ctx, flash, onClose }) {
  const [f, setF] = useState({ name: "", emoji: "", city: "nyc", description: "", price: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await client.from("communities").insert({
      name: f.name.trim(),
      emoji: f.emoji.trim() || null,
      city: f.city,
      description: f.description.trim() || null,
      membership_price_cents: Math.round((parseFloat(f.price) || 0) * 100),
      owner_id: ctx.session.user.id,
    }).select().single();
    if (error) { setBusy(false); flash(error.message); return; }
    // put the creator in the roster too
    await client.from("community_members").insert({ community_id: data.id, profile_id: ctx.session.user.id, status: "member" }).then(() => {});
    flash("Community created 🎉");
    setTimeout(() => location.reload(), 600);   // refresh pickers everywhere
  };
  return html`<${Modal} title="New community" onClose=${onClose}>
    <form onSubmit=${save}>
      <div class="fieldrow">
        <div class="field" style="flex:0 0 90px"><label>Emoji</label><input value=${f.emoji} onInput=${set("emoji")} placeholder="🏘️" /></div>
        <div class="field"><label>Name</label><input required value=${f.name} onInput=${set("name")} placeholder="Oyster Expedition" /></div>
      </div>
      <div class="fieldrow">
        <div class="field"><label>City</label>
          <select value=${f.city} onChange=${set("city")}>
            ${CITIES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
          </select></div>
        <div class="field"><label>Membership $ / month</label>
          <input type="number" min="0" step="0.01" value=${f.price} onInput=${set("price")} placeholder="0" /></div>
      </div>
      <div class="field"><label>Description</label><input value=${f.description} onInput=${set("description")} placeholder="What this crew is about" /></div>
      <div class="actions">
        <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn" disabled=${busy}>${busy ? "Creating…" : "Create community"}</button>
      </div>
    </form>
  </${Modal}>`;
}

/* members need person+community chosen before the row can exist (composite
   key). Two paths: invite somebody new by email (sends the branded magic-link
   invite + attaches them), or add an existing profile directly. */
function AddMemberModal({ client, ctx, flash, onClose, onSaved }) {
  const [mode, setMode] = useState("email");
  const [f, setF] = useState({ email: "", profile_id: "", community_id: ctx.communities[0]?.id || "", status: "member" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    if (!f.community_id) { flash("Pick a community"); return; }
    setBusy(true);
    if (mode === "email") {
      const r = await sendInvite(client, { email: f.email, kind: "member", community_id: f.community_id });
      setBusy(false);
      if (r.error) { flash(r.error); return; }
      flash(r.existing ? "They already had an account — added, sign-in link sent 💌" : "Invite sent 💌");
      onSaved();
      return;
    }
    if (!f.profile_id) { setBusy(false); flash("Pick a person"); return; }
    const { error } = await client.from("community_members").insert({
      community_id: f.community_id, profile_id: f.profile_id, status: f.status, joined_at: new Date().toISOString() });
    setBusy(false);
    if (error) { flash(error.message.includes("duplicate") ? "They're already in that community" : error.message); return; }
    flash("Member added ✓"); onSaved();
  };
  return html`<${Modal} title="Add member" onClose=${onClose}>
    <div class="subnav" style="margin-bottom:14px">
      <button class=${mode === "email" ? "on" : ""} onClick=${() => setMode("email")}>✉️ Invite by email</button>
      <button class=${mode === "existing" ? "on" : ""} onClick=${() => setMode("existing")}>Add existing person</button>
    </div>
    <form onSubmit=${save}>
      ${mode === "email"
        ? html`<div class="field"><label>Email</label>
            <input type="email" required placeholder="them@email.com" value=${f.email} onInput=${set("email")} />
            <p class="tiny muted" style="margin:6px 0 0">They'll get a branded invite with a magic sign-in link that opens the app in this community.</p>
          </div>`
        : html`<div class="field"><label>Person</label>
            <select required value=${f.profile_id} onChange=${set("profile_id")}>
              <option value="">Choose…</option>
              ${profOpts(ctx).map((o) => html`<option value=${o.v}>${o.l}</option>`)}
            </select></div>`}
      <div class="fieldrow">
        <div class="field"><label>Community</label>
          <select required value=${f.community_id} onChange=${set("community_id")}>
            ${ctx.communities.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
          </select></div>
        ${mode === "existing" && html`<div class="field"><label>Status</label>
          <select value=${f.status} onChange=${set("status")}>
            <option value="member">member</option><option value="pending">pending</option>
          </select></div>`}
      </div>
      <div class="actions">
        <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn" disabled=${busy}>${busy ? "Sending…" : (mode === "email" ? "Send invite" : "Add member")}</button>
      </div>
    </form>
  </${Modal}>`;
}

export function DataPage({ client, communities, session, flash, sub }) {
  const tab = TABS.some(([k]) => k === sub) ? sub : "communities";
  const S = SCHEMAS[tab];
  const [rows, setRows] = useState(null);   // null = loading
  const [profiles, setProfiles] = useState([]);
  const [q, setQ] = useState("");
  const [comm, setComm] = useState("");
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const [adding, setAdding] = useState(false);

  const ctx = { communities, profiles, session };

  // one profile roster powers the author/member pickers on every tab
  useEffect(() => {
    let live = true;
    client.from("profiles").select("id,display_name,avatar_url").order("display_name").limit(2000)
      .then(({ data }) => { if (live) setProfiles(data || []); });
    return () => { live = false; };
  }, [client]);

  const load = useCallback(async () => {
    const { data, error } = await S.load(client);
    if (error) flash(error.message);
    setRows(data || []);
  }, [client, tab]);
  useEffect(() => { setRows(null); setSort({ key: null, dir: 1 }); setQ(""); load(); }, [load]);

  const save = async (row, key, val) => {
    const patch = { [key]: val, ...(S.derive ? S.derive(key, val, ctx) : {}) };
    const { error } = await S.match(client.from(S.table).update(patch), row);
    if (error) { flash(error.message); return; }
    const col = S.cols.find((c) => c.key === key);
    if (col?.join) load();   // joined display (author/member name) needs a refetch
    else setRows((rs) => rs.map((r) => (r === row ? { ...r, ...patch } : r)));
    flash("Saved ✓");
  };
  const del = async (row) => {
    const name = row.title || row.body?.slice(0, 40) || row.profile?.display_name || "this row";
    if (!confirm(`Delete "${name}"? This removes it from the live app.`)) return;
    const { error } = await S.match(client.from(S.table).delete(), row);
    if (error) { flash(error.message); return; }
    if (S.afterDelete) await S.afterDelete(client, row);
    setRows((rs) => rs.filter((r) => r !== row));
    flash("Deleted");
  };
  const addNew = async () => {
    if (S.modalCreate) { setAdding(true); return; }
    const { error } = await S.create(client, ctx);
    if (error) { flash(error.message); return; }
    flash("Row added — edit it inline ✏️");
    load();
  };

  const filtered = useMemo(() => {
    let out = rows || [];
    const commKey = tab === "communities" ? "id" : "community_id";
    if (comm === "global") out = out.filter((r) => !r[commKey]);
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

  return html`<div class="page" style="max-width:none">
    <div class="pagehead">
      <h2>Data <span class="muted" style="font:400 13px var(--body)">every community, live tables — you have full permissions here</span></h2>
    </div>
    <div class="subnav" style="margin-bottom:12px">
      ${TABS.map(([k, label]) => html`<button class=${tab === k ? "on" : ""} onClick=${() => { location.hash = "/data/" + k; }}>${label}</button>`)}
    </div>

    <div class="dt-metrics">
      ${metrics.map(([l, n]) => html`<div class="metric"><div class="n">${rows === null ? "…" : n}</div><div class="l">${l}</div></div>`)}
      <div style="flex:1"></div>
      ${S.newLabel && html`<button class="btn small" onClick=${addNew}>${S.newLabel}</button>`}
      <input class="dt-search" placeholder="Search ${tab}…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <select class="commselect" value=${comm} onChange=${(e) => setComm(e.target.value)}>
        <option value="">All communities</option>
        ${tab === "announcements" && html`<option value="global">🌍 Global only</option>`}
        ${communities.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
      </select>
    </div>

    <div class="dt-wrap">
      <table class="dt">
        <thead><tr>
          ${S.cols.map((c) => html`<th class=${c.wide ? "wide" : ""}
            onClick=${() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : 1 }))}>
            ${c.label}${sort.key === c.key ? (sort.dir > 0 ? " ↑" : " ↓") : ""}</th>`)}
          <th style="width:40px"></th>
        </tr></thead>
        <tbody>
          ${filtered.map((r) => html`<tr>
            ${S.cols.map((c) => html`<td class=${"editable" + (c.wide ? " wide" : "")}>
              <${EditCell} row=${r} col=${c} ctx=${ctx} onSave=${(k, v) => save(r, k, v)} />
            </td>`)}
            <td><div style="display:flex;gap:4px;align-items:center;justify-content:flex-end;padding-right:4px">
              ${S.rowAction && S.rowAction(r, { client, flash, reload: load })}
              ${!S.noDelete && html`<button class="dt-del" title="Delete" onClick=${() => del(r)}>✕</button>`}
            </div></td>
          </tr>`)}
        </tbody>
      </table>
      ${rows === null && html`<div class="empty" style="border:0">Loading…</div>`}
      ${rows !== null && filtered.length === 0 && html`<div class="empty" style="border:0">No rows${q || comm ? " match" : ""}.</div>`}
    </div>
    <p class="tiny muted" style="margin-top:8px">${filtered.length} row${filtered.length === 1 ? "" : "s"} · every cell is editable — click one; changes go live in the app instantly.</p>

    ${adding && (tab === "communities"
      ? html`<${AddCommunityModal} client=${client} ctx=${ctx} flash=${flash} onClose=${() => setAdding(false)} />`
      : tab === "bans"
      ? html`<${BanModal} client=${client} flash=${flash}
          onClose=${() => setAdding(false)} onSaved=${() => { setAdding(false); load(); }} />`
      : html`<${AddMemberModal} client=${client} ctx=${ctx} flash=${flash}
          onClose=${() => setAdding(false)} onSaved=${() => { setAdding(false); load(); }} />`)}
  </div>`;
}
