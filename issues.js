import { useState, useEffect, useMemo, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, cityName } from "./ui.js?v=23";

/* Issues — the app's telemetry (client_errors) reported for humans:
   summary metrics, then errors grouped sentry-style by normalized message +
   source (count, affected users, first/last seen, cities, versions). Click a
   group for the raw occurrences with stacks. Owners can clear handled
   groups. Staff-visible (RLS scopes reads to staff already). */

const WINDOWS = [["24h", 1], ["7d", 7], ["30d", 30], ["all", 3650]];

const ago = (iso) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
// collapse ids/numbers/uuids so "load failed for event 123" groups as one issue
const normalize = (msg) =>
  (msg || "(no message)")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "‹id›")
    .replace(/\d+/g, "‹n›")
    .slice(0, 160);

export function IssuesPage({ client, isOwner, flash }) {
  const [rows, setRows] = useState(null);
  const [profiles, setProfiles] = useState(new Map());
  const [win, setWin] = useState("7d");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);   // group key

  const load = useCallback(async () => {
    setRows(null);
    const days = WINDOWS.find(([k]) => k === win)?.[1] || 7;
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const { data, error } = await client.from("client_errors").select("*")
      .gte("created_at", since).order("created_at", { ascending: false }).limit(2000);
    if (error) { flash(error.message); setRows([]); return; }
    setRows(data || []);
    const ids = [...new Set((data || []).map((r) => r.profile_id).filter(Boolean))];
    if (ids.length) {
      const { data: profs } = await client.from("profiles").select("id,display_name,avatar_url").in("id", ids);
      setProfiles(new Map((profs || []).map((p) => [p.id, p])));
    }
  }, [client, win]);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const r of rows || []) {
      const key = (r.source || "app") + "|" + normalize(r.message);
      let g = map.get(key);
      if (!g) { g = { key, message: normalize(r.message), sample: r.message, source: r.source || "app",
        count: 0, users: new Set(), cities: new Set(), vers: new Set(), first: r.created_at, last: r.created_at, rows: [] }; map.set(key, g); }
      g.count++;
      if (r.profile_id) g.users.add(r.profile_id);
      if (r.city) g.cities.add(r.city);
      if (r.ver) g.vers.add(r.ver);
      if (r.created_at < g.first) g.first = r.created_at;
      if (r.created_at > g.last) g.last = r.created_at;
      if (g.rows.length < 25) g.rows.push(r);
    }
    let out = [...map.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      out = out.filter((g) => (g.sample || "").toLowerCase().includes(n) || g.source.toLowerCase().includes(n));
    }
    return out;
  }, [rows, q]);

  const day = new Date(Date.now() - 864e5).toISOString();
  const metrics = [
    ["errors", (rows || []).length],
    ["last 24h", (rows || []).filter((r) => r.created_at > day).length],
    ["issues", groups.length],
    ["users hit", new Set((rows || []).map((r) => r.profile_id).filter(Boolean)).size],
  ];

  const clearGroup = async (g) => {
    if (!confirm(`Clear "${g.message}" — ${g.count} occurrence${g.count === 1 ? "" : "s"}? This deletes the log rows.`)) return;
    const { error } = await client.from("client_errors").delete().in("id", (rows || [])
      .filter((r) => (r.source || "app") + "|" + normalize(r.message) === g.key).map((r) => r.id));
    if (error) flash(error.message); else { flash("Cleared ✓"); load(); }
  };

  return html`<div class="page" style="max-width:1080px">
    <div class="pagehead">
      <h2>Issues <span class="muted" style="font:400 13px var(--body)">app telemetry — every client error, grouped</span></h2>
      <button class="btn small ghost" onClick=${load}>↻ refresh</button>
    </div>

    <div class="dt-metrics">
      ${metrics.map(([l, n]) => html`<div class="metric"><div class="n">${rows === null ? "…" : n}</div><div class="l">${l}</div></div>`)}
      <div style="flex:1"></div>
      <input class="dt-search" placeholder="Search errors…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="subnav" style="margin:0">
        ${WINDOWS.map(([k]) => html`<button class=${win === k ? "on" : ""} onClick=${() => setWin(k)}>${k}</button>`)}
      </div>
    </div>

    ${rows === null ? html`<div class="empty" style="border:0">Loading…</div>`
      : groups.length === 0 ? html`<div class="empty">No errors in this window — quiet skies 🕊️</div>`
      : groups.map((g) => html`<div class="card iss-group" key=${g.key}>
        <div class="iss-head" onClick=${() => setOpen(open === g.key ? null : g.key)}>
          <span class="iss-count">${g.count}</span>
          <div style="flex:1;min-width:0">
            <div class="iss-msg">${g.sample || g.message}</div>
            <div class="iss-meta">
              <span class="pillstat">${g.source}</span>
              ${g.users.size > 0 && html`<span>${g.users.size} user${g.users.size === 1 ? "" : "s"}</span>`}
              ${[...g.cities].map((c) => html`<span class="citychip" style="margin:0">${cityName(c)}</span>`)}
              ${[...g.vers].slice(0, 3).map((v) => html`<span class="pillstat">${v}</span>`)}
              <span>first ${ago(g.first)} · last <b>${ago(g.last)}</b></span>
            </div>
          </div>
          ${isOwner && html`<button class="btn small ghost" onClick=${(e) => { e.stopPropagation(); clearGroup(g); }}>Clear</button>`}
          <span class="muted">${open === g.key ? "▾" : "▸"}</span>
        </div>
        ${open === g.key && html`<div class="iss-rows">
          ${g.rows.map((r) => html`<div class="iss-row" key=${r.id}>
            <div class="iss-rowmeta">
              ${r.profile_id
                ? html`<${Avatar} profile=${profiles.get(r.profile_id) || { display_name: "?" }} size="sm" />
                  <b>${profiles.get(r.profile_id)?.display_name || "unknown user"}</b>`
                : html`<span class="muted">anonymous</span>`}
              <span class="muted">${ago(r.created_at)}</span>
              ${r.city && html`<span class="citychip" style="margin:0">${cityName(r.city)}</span>`}
              ${r.ver && html`<span class="pillstat">${r.ver}</span>`}
              ${r.url && html`<span class="muted tiny" style="overflow:hidden;text-overflow:ellipsis;max-width:280px">${r.url}</span>`}
            </div>
            ${r.stack && html`<pre class="iss-stack">${r.stack}</pre>`}
            ${r.ua && html`<div class="tiny" style="color:var(--faint)">${r.ua}</div>`}
          </div>`)}
          ${g.count > g.rows.length && html`<div class="tiny muted" style="padding:6px 0">+ ${g.count - g.rows.length} more occurrence${g.count - g.rows.length === 1 ? "" : "s"} in this window</div>`}
        </div>`}
      </div>`)}
    ${rows !== null && rows.length >= 2000 && html`<p class="tiny muted">Showing the most recent 2,000 — narrow the window for full accuracy.</p>`}
  </div>`;
}
