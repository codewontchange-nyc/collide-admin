import { useState, useEffect, useMemo, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, moneyExact, niceTime, todayStr } from "./ui.js?v=4";

/* Data — the owner's god view. Every announcement, event and member across
   ALL communities in one giant grid: metric chips up top, then an
   Airtable-style table — sticky header, sortable columns, search, community
   filter, click any highlighted cell to edit it in place (RLS is the real
   permission gate; this page is only offered to owners). */

const TABS = [["announcements", "Announcements"], ["events", "Events"], ["members", "Members"]];

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

const expired = (iso) => !!iso && new Date(iso).getTime() < Date.now();

const SCHEMAS = {
  announcements: {
    table: "announcements",
    load: (client) => client.from("announcements")
      .select("*, author:profiles!announcements_author_id_fkey(id,display_name,avatar_url)")
      .order("created_at", { ascending: false }).limit(1000),
    match: (q, r) => q.eq("id", r.id),
    metrics: (rows) => [
      ["total", rows.length],
      ["live", rows.filter((r) => !expired(r.expires_at)).length],
      ["expired", rows.filter((r) => expired(r.expires_at)).length],
      ["global", rows.filter((r) => !r.community_id).length],
    ],
    cols: [
      { key: "body", label: "Announcement", type: "text", edit: true, wide: true },
      { key: "community_id", label: "Community", comm: true },
      { key: "author", label: "Author", get: (r) => r.author?.display_name || "—" },
      { key: "created_at", label: "Posted", type: "dt" },
      { key: "expires_at", label: "Expires", type: "dt", edit: true },
    ],
  },
  events: {
    table: "activities",
    load: (client) => client.from("activities").select("*").order("created_at", { ascending: false }).limit(1000),
    match: (q, r) => q.eq("id", r.id),
    // keep the app-native mirror fields in sync when the admin edits inline
    derive: (key, val) => {
      if (key === "date") return val
        ? { when_bucket: whenBucket(val), expires_at: new Date(new Date(val + "T23:59:00").getTime() + 864e5).toISOString() }
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
      { key: "community_id", label: "Community", comm: true },
      { key: "date", label: "Date", type: "date", edit: true },
      { key: "starts_at", label: "Time", type: "time", edit: true },
      { key: "location", label: "Location", type: "text", edit: true },
      { key: "category", label: "Category", type: "select", edit: true, options: EV_CATS },
      { key: "price_cents", label: "Price", type: "money", edit: true },
      { key: "capacity", label: "Cap", type: "text", edit: true },
    ],
  },
  members: {
    table: "community_members",
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
      { key: "profile", label: "Member", wide: true,
        get: (r) => r.profile?.display_name || "—",
        cell: (r) => html`<span style="display:inline-flex;align-items:center;gap:8px"><${Avatar} profile=${r.profile} size="sm" /> <b>${r.profile?.display_name || "—"}</b></span> ` },
      { key: "community_id", label: "Community", comm: true },
      { key: "status", label: "Status", type: "select", edit: true, options: ["member", "pending"],
        cell: (r) => html`<span class=${"pillstat " + r.status}>${r.status}</span>` },
      { key: "joined_at", label: "Joined", type: "dt" },
    ],
  },
};

function EditCell({ row, col, onSave }) {
  const t = T[col.type || "text"];
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState("");
  const shown = col.cell ? col.cell(row) : t.fmt(col.get ? col.get(row) : row[col.key]);
  if (!editing) {
    return html`<div class="cellv" onClick=${() => { setV(t.toIn(row[col.key])); setEditing(true); }}>${shown}</div>`;
  }
  const commit = () => {
    setEditing(false);
    const val = t.parse(String(v));
    if (val !== row[col.key]) onSave(col.key, val);
  };
  const keys = (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); };
  if (col.type === "select") {
    return html`<select autofocus value=${v} onChange=${(e) => { setV(e.target.value); }} onBlur=${commit} onKeyDown=${keys}
      ref=${(el) => el && setTimeout(() => el.focus(), 0)}>
      ${col.options.map((o) => html`<option value=${o}>${o}</option>`)}
    </select>`;
  }
  return html`<input type=${t.input} step=${col.type === "money" ? "0.01" : undefined} value=${v}
    onInput=${(e) => setV(e.target.value)} onBlur=${commit} onKeyDown=${keys}
    ref=${(el) => el && setTimeout(() => { el.focus(); if (el.select) el.select(); }, 0)} />`;
}

export function DataPage({ client, communities, flash, sub }) {
  const tab = TABS.some(([k]) => k === sub) ? sub : "announcements";
  const S = SCHEMAS[tab];
  const [rows, setRows] = useState(null);   // null = loading
  const [q, setQ] = useState("");
  const [comm, setComm] = useState("");
  const [sort, setSort] = useState({ key: null, dir: 1 });

  const cname = (id) => (id ? (communities.find((c) => c.id === id)?.name || "?") : "🌍 Global");

  const load = useCallback(async () => {
    const { data, error } = await S.load(client);
    if (error) flash(error.message);
    setRows(data || []);
  }, [client, tab]);
  useEffect(() => { setRows(null); setSort({ key: null, dir: 1 }); load(); }, [load]);

  const save = async (row, key, val) => {
    const patch = { [key]: val, ...(S.derive ? S.derive(key, val) : {}) };
    const { error } = await S.match(client.from(S.table).update(patch), row);
    if (error) { flash(error.message); return; }
    setRows((rs) => rs.map((r) => (r === row ? { ...r, ...patch } : r)));
    flash("Saved ✓");
  };
  const del = async (row) => {
    const name = row.title || row.body?.slice(0, 40) || row.profile?.display_name || "this row";
    if (!confirm(`Delete "${name}"? This removes it from the live app.`)) return;
    const { error } = await S.match(client.from(S.table).delete(), row);
    if (error) { flash(error.message); return; }
    setRows((rs) => rs.filter((r) => r !== row));
    flash("Deleted");
  };

  const filtered = useMemo(() => {
    let out = rows || [];
    if (comm === "global") out = out.filter((r) => !r.community_id);
    else if (comm) out = out.filter((r) => r.community_id === comm);
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      out = out.filter((r) => JSON.stringify(r).toLowerCase().includes(n) || cname(r.community_id).toLowerCase().includes(n));
    }
    if (sort.key) {
      const col = S.cols.find((c) => c.key === sort.key);
      const gv = (r) => col.comm ? cname(r.community_id) : (col.get ? col.get(r) : r[col.key]);
      out = [...out].sort((a, b) => {
        const x = gv(a), y = gv(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
      });
    }
    return out;
  }, [rows, q, comm, sort, tab, communities]);

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
            ${S.cols.map((c) => html`<td class=${(c.edit ? "editable" : "") + (c.wide ? " wide" : "")}>
              ${c.comm
                ? html`<div class="cellv">${cname(r.community_id)}</div>`
                : c.edit
                ? html`<${EditCell} row=${r} col=${c} onSave=${(k, v) => save(r, k, v)} />`
                : html`<div class="cellv">${c.cell ? c.cell(r) : T[c.type || "text"].fmt(c.get ? c.get(r) : r[c.key])}</div>`}
            </td>`)}
            <td><button class="dt-del" title="Delete" onClick=${() => del(r)}>✕</button></td>
          </tr>`)}
        </tbody>
      </table>
      ${rows === null && html`<div class="empty" style="border:0">Loading…</div>`}
      ${rows !== null && filtered.length === 0 && html`<div class="empty" style="border:0">No rows${q || comm ? " match" : ""}.</div>`}
    </div>
    <p class="tiny muted" style="margin-top:8px">${filtered.length} row${filtered.length === 1 ? "" : "s"} · click a highlighted cell to edit — changes go live in the app instantly.</p>
  </div>`;
}
